import * as fs from "fs";
import * as path from "path";
import { createHash } from "crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "child_process";
import * as vscode from "vscode";
import {
  getMonitorReporters,
  getPlotExporters,
  getWidgetRuntimeCommands,
  parseInterfacePreview,
  type MonitorReporter,
  type PlotExporter
} from "./classicInterface";
import { getConfiguredJvmArgs, resolveNetLogoClassPath } from "./netlogoInstallation";
import { parseNetLogoModel } from "./modelFormat";
import { parsePlotCsv, type ParsedPlotCsv } from "./plotCsv";

export interface NetLogoRunResult {
  readonly command: string;
  readonly ticks: string | null;
  readonly monitorValues: readonly MonitorValue[];
  readonly plotValues: readonly PlotValue[];
  readonly viewImageDataUri: string | null;
  readonly view3DState: View3DState | null;
}

export interface MonitorValue {
  readonly widgetId: string;
  readonly label: string;
  readonly source: string;
  readonly value: string;
}

export interface PlotValue {
  readonly widgetId: string;
  readonly label: string;
  readonly plotName: string;
  readonly data: ParsedPlotCsv;
}

export interface View3DState {
  readonly bounds: View3DBounds;
  readonly observer?: Observer3DValue;
  readonly turtleCount?: number;
  readonly linkCount?: number;
  readonly patchCount?: number;
  readonly drawingLineCount?: number;
  readonly drawingData?: ArrayBuffer;
  readonly turtles: readonly Turtle3DValue[];
  readonly links: readonly Link3DValue[];
  readonly patches: readonly Patch3DValue[];
  readonly drawingLines: readonly DrawingLine3DValue[];
}

export interface View3DBounds {
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
  readonly minZ: number;
  readonly maxZ: number;
}

export interface Rgb3DValue {
  readonly red: number;
  readonly green: number;
  readonly blue: number;
}

export interface Observer3DValue {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface Turtle3DValue {
  readonly who: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly color?: number;
  readonly colorRgb?: Rgb3DValue;
  readonly alpha?: number;
  readonly heading: number;
  readonly pitch: number;
  readonly size: number;
  readonly penMode?: string;
  readonly penSize?: number;
  readonly shape?: string;
  readonly label?: string;
  readonly labelColor?: number;
  readonly labelColorRgb?: Rgb3DValue;
  readonly labelAlpha?: number;
}

export interface Link3DValue {
  readonly end1: number;
  readonly end2: number;
  readonly color?: number;
  readonly colorRgb?: Rgb3DValue;
  readonly alpha?: number;
  readonly thickness: number;
  readonly directed?: boolean;
  readonly shape?: string;
  readonly label?: string;
  readonly labelColor?: number;
  readonly labelColorRgb?: Rgb3DValue;
  readonly labelAlpha?: number;
}

export interface Patch3DValue {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly color?: number;
  readonly colorRgb?: Rgb3DValue;
  readonly alpha?: number;
}

export interface DrawingLine3DValue {
  readonly x0: number;
  readonly y0: number;
  readonly z0: number;
  readonly x1: number;
  readonly y1: number;
  readonly z1: number;
  readonly width: number;
  readonly color?: number;
  readonly colorRgb?: Rgb3DValue;
  readonly alpha?: number;
  readonly heading?: number;
  readonly pitch?: number;
  readonly length?: number;
}

export interface NetLogoRunOptions {
  readonly showProgress?: boolean;
}

const DEFAULT_COMMAND_TIMEOUT_MS = 60_000;
const DRAWING_3D_RENDER_LIMIT = 160_000;

export function formatNetLogoErrorMessage(error: unknown): string {
  const message = stripJavaStackTrace((error instanceof Error ? error.message : String(error)).trim());
  if (/Unable to open model with current format/i.test(message)) {
    return "Unable to run model with current format. Configure a NetLogo version that can open this model.";
  }

  const firstLine = message.split(/\r?\n/, 1)[0]?.trim() || message;
  const withoutFailurePrefix = firstLine.replace(/^NetLogo (?:command|report|run) failed:\s*/i, "");
  const exceptionMatch = withoutFailurePrefix.match(/^(?:org\.nlogo|java\.lang|scala)\.[\w.$]+:\s*(.+)$/);
  const concise = stripJavaStackTrace(exceptionMatch?.[1]?.trim() || withoutFailurePrefix);
  return concise.length > 280 ? `${concise.slice(0, 277)}...` : concise;
}

function stripJavaStackTrace(message: string): string {
  return message
    .replace(/\r?\n\s*at\s+[A-Za-z_$][\w.$]*\([^)]*\)/g, "")
    .replace(/\s+at\s+[A-Za-z_$][\w.$]*\([^)]*\).*$/s, "")
    .trim();
}

export class NetLogoRunner implements vscode.Disposable {
  private readonly sessions = new Map<string, NetLogoSession>();

  public constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly output: vscode.OutputChannel
  ) {
  }

  public async run(
    resource: vscode.Uri | undefined,
    command: string,
    options: NetLogoRunOptions = {}
  ): Promise<NetLogoRunResult | undefined> {
    const uri = await this.resolveResource(resource);
    if (!uri) {
      return undefined;
    }

    if (uri.scheme !== "file") {
      void vscode.window.showErrorMessage("NetLogo headless runs require a local file.");
      return undefined;
    }

    await saveDocumentIfDirty(uri);

    const config = vscode.workspace.getConfiguration("netlogo", uri);
    const installation = resolveNetLogoClassPath({
      configuredClassPath: config.get<string[]>("classPath", []),
      home: config.get<string>("home", ""),
      autoDetect: config.get<boolean>("autoDetect", true)
    });
    if (!installation) {
      void vscode.window.showErrorMessage("Configure NetLogo before running a model.", "Configure").then(selection => {
        if (selection === "Configure") {
          void vscode.commands.executeCommand("netlogo.configure");
        }
      });
      return undefined;
    }
    const classPath = installation.classPath;

    const javaPath = config.get<string>("javaPath", "java");
    const javacPath = config.get<string>("javacPath", "javac");
    const jvmArgs = [...installation.jvmArgs, ...getConfiguredJvmArgs(config.get<string[]>("jvmArgs", []))];
    const verboseOutput = config.get<boolean>("verboseOutput", false);
    const commandTimeoutMs = normalizeCommandTimeoutMs(config.get<number>("commandTimeoutMs", DEFAULT_COMMAND_TIMEOUT_MS));
    const isThreeDModel = uri.fsPath.toLowerCase().endsWith(".nlogo3d");

    let activeSession: NetLogoSession | undefined;
    const runTask = async (token?: vscode.CancellationToken): Promise<NetLogoRunResult> => {
      if (token?.isCancellationRequested) {
        throw new Error("NetLogo run cancelled.");
      }
      const classesDir = await this.ensureBridgeCompiled(javacPath, classPath, verboseOutput, commandTimeoutMs);
      const runtimeClassPath = [classesDir, ...classPath].join(path.delimiter);
      const session = this.getSession(uri.fsPath, javaPath, jvmArgs, runtimeClassPath, isThreeDModel, verboseOutput, commandTimeoutMs);
      activeSession = session;
      const cancellation = token?.onCancellationRequested(() => {
        session.dispose();
      });
      const runtimeState = await this.getRuntimeState(uri);
      try {
        if (runtimeState.commands.length > 0) {
          this.logVerbose(verboseOutput, `Syncing ${runtimeState.commands.length} Interface value${runtimeState.commands.length === 1 ? "" : "s"}.`);
          for (const runtimeCommand of runtimeState.commands) {
            await session.run(runtimeCommand);
          }
        }
        await session.run(command);
        const ticks = await this.tryReportTicks(session);
        const monitorValues: MonitorValue[] = [];
        for (const monitor of runtimeState.monitors) {
          const value = await this.tryReportMonitor(session, monitor, verboseOutput);
          monitorValues.push({
            ...monitor,
            value
          });
        }
        const viewImageDataUri = runtimeState.hasView && !isThreeDModel
          ? await this.tryExportView(session)
          : undefined;
        const view3DState = isThreeDModel && runtimeState.hasView
          ? await this.tryReportView3D(session, verboseOutput)
          : undefined;
        const plotValues: PlotValue[] = [];
        for (const plot of runtimeState.plots) {
          const csv = await this.tryExportPlot(session, plot);
          if (csv !== undefined) {
            plotValues.push({
              ...plot,
              data: parsePlotCsv(csv)
            });
          }
        }
        return {
          command,
          ticks,
          monitorValues,
          plotValues,
          viewImageDataUri: viewImageDataUri ?? null,
          view3DState: view3DState ?? null
        };
      } finally {
        cancellation?.dispose();
      }
    };

    if (options.showProgress === false) {
      return runTask();
    }

    return vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `NetLogo: ${command}`,
        cancellable: true
      },
      (_progress, token) => runTask(token).catch(error => {
        if (token.isCancellationRequested) {
          activeSession?.dispose();
        }
        throw error;
      })
    );
  }

  public dispose(): void {
    for (const session of this.sessions.values()) {
      session.dispose();
    }
    this.sessions.clear();
  }

  public invalidate(resource: vscode.Uri): void {
    const modelPath = resource.fsPath;
    for (const session of [...this.sessions.values()]) {
      if (session.matchesModelPath(modelPath)) {
        session.dispose();
      }
    }
  }

  private async resolveResource(resource: vscode.Uri | undefined): Promise<vscode.Uri | undefined> {
    if (resource instanceof vscode.Uri) {
      return resource;
    }

    const activeDocument = vscode.window.activeTextEditor?.document;
    if (activeDocument && isNetLogoPath(activeDocument.uri.fsPath)) {
      return activeDocument.uri;
    }

    const selected = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: false,
      filters: {
        "NetLogo models": ["nlogo", "nlogox", "nlogo3d"]
      }
    });

    return selected?.[0];
  }

  private async ensureBridgeCompiled(
    javacPath: string,
    classPath: readonly string[],
    verboseOutput: boolean,
    commandTimeoutMs: number
  ): Promise<string> {
    const storageDir = this.context.globalStorageUri.fsPath;
    const classesDir = path.join(storageDir, "netlogo-bridge");
    const sourcePath = vscode.Uri.joinPath(this.context.extensionUri, "resources", "java", "NetLogoCommandBridge.java").fsPath;
    const classFile = path.join(classesDir, "NetLogoCommandBridge.class");
    const hashFile = path.join(classesDir, "NetLogoCommandBridge.sha256");
    const sourceHash = fileSha256(sourcePath);

    fs.mkdirSync(classesDir, { recursive: true });

    if (isFresh(classFile, sourcePath) && readTextFile(hashFile) === sourceHash) {
      return classesDir;
    }

    await this.spawnLogged(javacPath, ["-cp", classPath.join(path.delimiter), "-d", classesDir, sourcePath], verboseOutput, commandTimeoutMs);
    fs.writeFileSync(hashFile, sourceHash, "utf8");
    return classesDir;
  }

  private async spawnLogged(command: string, args: readonly string[], verboseOutput: boolean, commandTimeoutMs: number): Promise<void> {
    this.logVerbose(verboseOutput, `$ ${command} ${args.map(quoteForLog).join(" ")}`);

    await new Promise<void>((resolve, reject) => {
      let stdout = "";
      let stderr = "";
      const child = spawn(command, [...args], {
        stdio: ["ignore", "pipe", "pipe"]
      });
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error(`${command} timed out after ${formatDuration(commandTimeoutMs)}.`));
      }, commandTimeoutMs);

      child.stdout.on("data", chunk => {
        const text = chunk.toString();
        stdout += text;
        this.appendVerbose(verboseOutput, text);
      });

      child.stderr.on("data", chunk => {
        const text = chunk.toString();
        stderr += text;
        this.appendVerbose(verboseOutput, text);
      });

      child.on("error", error => {
        clearTimeout(timer);
        reject(error);
      });

      child.on("close", code => {
        clearTimeout(timer);
        if (code === 0) {
          resolve();
        } else {
          const diagnostic = processDiagnostic(stdout, stderr);
          reject(new Error(`${command} exited with code ${code ?? "unknown"}${diagnostic ? `: ${diagnostic}` : ""}`));
        }
      });
    }).catch(error => {
      this.output.appendLine(`NetLogo bridge compile failed: ${error instanceof Error ? error.message : String(error)}`);
      void vscode.window.showErrorMessage(`NetLogo run failed: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    });
  }

  private getSession(
    modelPath: string,
    javaPath: string,
    jvmArgs: readonly string[],
    runtimeClassPath: string,
    isThreeDModel: boolean,
    verboseOutput: boolean,
    commandTimeoutMs: number
  ): NetLogoSession {
    const key = JSON.stringify({ modelPath, javaPath, jvmArgs, runtimeClassPath, isThreeDModel });
    const existing = this.sessions.get(key);
    if (existing && !existing.isDisposed) {
      existing.setVerboseOutput(verboseOutput);
      return existing;
    }

    const session = new NetLogoSession(javaPath, jvmArgs, runtimeClassPath, modelPath, isThreeDModel, this.output, verboseOutput, commandTimeoutMs, () => {
      this.sessions.delete(key);
    });
    this.sessions.set(key, session);
    return session;
  }

  private logVerbose(verboseOutput: boolean, line: string): void {
    if (verboseOutput) {
      this.output.appendLine(line);
    }
  }

  private appendVerbose(verboseOutput: boolean, text: string): void {
    if (verboseOutput) {
      this.output.append(text);
    }
  }

  private async getRuntimeState(uri: vscode.Uri): Promise<RuntimeState> {
    const text = await readDocumentText(uri);
    const model = parseNetLogoModel(text, uri.fsPath);
    const preview = parseInterfacePreview(model.interfaceSource, model.format);
    return {
      commands: getWidgetRuntimeCommands(preview.widgets),
      monitors: getMonitorReporters(preview.widgets),
      plots: getPlotExporters(preview.widgets),
      hasView: preview.widgets.some(widget => widget.kind === "view")
    };
  }

  private async tryExportView(session: NetLogoSession): Promise<string | undefined> {
    const exportDir = path.join(this.context.globalStorageUri.fsPath, "view-exports");
    fs.mkdirSync(exportDir, { recursive: true });
    const exportPath = path.join(exportDir, `view-${Date.now()}-${Math.random().toString(16).slice(2)}.png`);

    try {
      const base64Png = await session.exportView(exportPath);
      return base64Png ? `data:image/png;base64,${base64Png}` : undefined;
    } catch (error) {
      this.output.appendLine(`View export failed: ${error instanceof Error ? error.message : String(error)}`);
      return undefined;
    } finally {
      deleteTemporaryExport(exportPath);
    }
  }

  private async tryReportTicks(session: NetLogoSession): Promise<string | null> {
    try {
      return await session.report("ticks", { showError: false });
    } catch {
      return null;
    }
  }

  private async tryReportMonitor(session: NetLogoSession, monitor: MonitorReporter, verboseOutput: boolean): Promise<string> {
    try {
      return await session.report(monitor.source, { showError: false });
    } catch (error) {
      const message = formatNetLogoErrorMessage(error);
      this.logVerbose(verboseOutput, `Monitor report failed (${monitor.label}): ${message}`);
      return `Error: ${message}`;
    }
  }

  private async tryReportView3D(session: NetLogoSession, verboseOutput: boolean): Promise<View3DState | undefined> {
    try {
      const boundsText = await session.report("list min-pxcor max-pxcor min-pycor max-pycor min-pzcor max-pzcor", { showError: false });
      const bounds = parseView3DBounds(boundsText);
      if (!bounds) {
        return undefined;
      }

      const turtleCount = await this.tryReport3DCount(session, "count turtles", "turtles", verboseOutput);
      const linkCount = await this.tryReport3DCount(session, "count links", "links", verboseOutput);
      const patchCount = await this.tryReport3DCount(session, "count patches with [pcolor != black]", "patches", verboseOutput);
      const turtlesText = await this.tryReport3DList(
        session,
        "[ (word who \"|\" xcor \"|\" ycor \"|\" zcor \"|\" color \"|\" (item 0 (extract-rgb color)) \"|\" (item 1 (extract-rgb color)) \"|\" (item 2 (extract-rgb color)) \"|\" heading \"|\" pitch \"|\" size \"|\" shape \"|\" label \"|\" label-color \"|\" (item 0 (extract-rgb label-color)) \"|\" (item 1 (extract-rgb label-color)) \"|\" (item 2 (extract-rgb label-color)) \"|\" pen-mode \"|\" pen-size) ] of turtles",
        "turtles",
        verboseOutput
      );
      const linksText = await this.tryReport3DList(
        session,
        "[ (word [who] of end1 \"|\" [who] of end2 \"|\" color \"|\" (item 0 (extract-rgb color)) \"|\" (item 1 (extract-rgb color)) \"|\" (item 2 (extract-rgb color)) \"|\" thickness \"|\" (is-directed-link? self) \"|\" shape \"|\" label \"|\" label-color \"|\" (item 0 (extract-rgb label-color)) \"|\" (item 1 (extract-rgb label-color)) \"|\" (item 2 (extract-rgb label-color))) ] of links",
        "links",
        verboseOutput
      );
      const patchesText = await this.tryReport3DList(
        session,
        "[ (word pxcor \"|\" pycor \"|\" pzcor \"|\" pcolor \"|\" (item 0 (extract-rgb pcolor)) \"|\" (item 1 (extract-rgb pcolor)) \"|\" (item 2 (extract-rgb pcolor))) ] of sublist (sort patches with [pcolor != black]) 0 (min (list 5000 count patches with [pcolor != black]))",
        "patches",
        verboseOutput
      );
      const observer = await this.tryReportView3DObserver(session, verboseOutput);
      const drawingLinesReport = await this.tryReportDrawing3D(session, verboseOutput);

      return {
        bounds,
        observer,
        turtleCount,
        linkCount,
        patchCount,
        drawingLineCount: drawingLinesReport.totalCount,
        drawingData: drawingLinesReport.data,
        turtles: parseNetLogoDelimitedList(turtlesText).map(parseTurtle3DValue).filter((value): value is Turtle3DValue => value !== undefined),
        links: parseNetLogoDelimitedList(linksText).map(parseLink3DValue).filter((value): value is Link3DValue => value !== undefined),
        patches: parseNetLogoDelimitedList(patchesText).map(parsePatch3DValue).filter((value): value is Patch3DValue => value !== undefined),
        drawingLines: []
      };
    } catch (error) {
      this.logVerbose(verboseOutput, `3D view state failed: ${formatNetLogoErrorMessage(error)}`);
      return undefined;
    }
  }

  private async tryReportView3DObserver(session: NetLogoSession, verboseOutput: boolean): Promise<Observer3DValue | undefined> {
    try {
      return parseView3DObserver(await session.report("list __oxcor __oycor __ozcor", { showError: false }));
    } catch (error) {
      this.logVerbose(verboseOutput, `3D observer report failed: ${formatNetLogoErrorMessage(error)}`);
      return undefined;
    }
  }

  private async tryReportDrawing3D(session: NetLogoSession, verboseOutput: boolean): Promise<Drawing3DReport> {
    const exportDir = path.join(this.context.globalStorageUri.fsPath, "drawing-3d-exports");
    fs.mkdirSync(exportDir, { recursive: true });
    const exportPath = path.join(exportDir, `drawing-3d-${Date.now()}-${Math.random().toString(16).slice(2)}.bin`);

    try {
      await session.exportDrawing3DBinary(exportPath);
      const data = fs.readFileSync(exportPath);
      return {
        data: exactArrayBuffer(data),
        totalCount: parseDrawing3DBinaryCount(data)
      };
    } catch (error) {
      this.logVerbose(verboseOutput, `3D drawing report failed: ${formatNetLogoErrorMessage(error)}`);
      return { data: undefined, totalCount: undefined };
    } finally {
      try {
        fs.unlinkSync(exportPath);
      } catch {
        // Drawing exports are temporary; a failed cleanup should not hide the real result.
      }
    }
  }

  private async tryReport3DList(
    session: NetLogoSession,
    reporter: string,
    label: string,
    verboseOutput: boolean
  ): Promise<string> {
    const exportDir = path.join(this.context.globalStorageUri.fsPath, "report-3d-exports");
    fs.mkdirSync(exportDir, { recursive: true });
    const exportPath = path.join(exportDir, `${label}-3d-${Date.now()}-${Math.random().toString(16).slice(2)}.txt`);

    try {
      await session.exportReport(reporter, exportPath);
      return readTextFile(exportPath) ?? "[]";
    } catch (error) {
      this.logVerbose(verboseOutput, `3D ${label} report failed: ${formatNetLogoErrorMessage(error)}`);
      return "[]";
    } finally {
      try {
        fs.unlinkSync(exportPath);
      } catch {
        // 3D report exports are temporary; a failed cleanup should not hide the real result.
      }
    }
  }

  private async tryReport3DCount(
    session: NetLogoSession,
    reporter: string,
    label: string,
    verboseOutput: boolean
  ): Promise<number | undefined> {
    try {
      return parseCount(await session.report(reporter, { showError: false }));
    } catch (error) {
      this.logVerbose(verboseOutput, `3D ${label} count failed: ${formatNetLogoErrorMessage(error)}`);
      return undefined;
    }
  }

  private async tryExportPlot(session: NetLogoSession, plot: PlotExporter): Promise<string | undefined> {
    const exportDir = path.join(this.context.globalStorageUri.fsPath, "plot-exports");
    fs.mkdirSync(exportDir, { recursive: true });
    const exportPath = path.join(exportDir, `plot-${Date.now()}-${Math.random().toString(16).slice(2)}.csv`);

    try {
      const base64Csv = await session.exportPlot(plot.plotName, exportPath);
      return Buffer.from(base64Csv, "base64").toString("utf8");
    } catch (error) {
      this.output.appendLine(`Plot export failed (${plot.plotName}): ${error instanceof Error ? error.message : String(error)}`);
      return undefined;
    } finally {
      deleteTemporaryExport(exportPath);
    }
  }

}

class NetLogoSession implements vscode.Disposable {
  private static readonly readyMarker = "__NETLOGO_READY__";
  private static readonly okMarker = "__NETLOGO_OK__";
  private static readonly errorMarker = "__NETLOGO_ERROR__";
  private static readonly reportMarker = "__NETLOGO_REPORT__";
  private static readonly viewMarker = "__NETLOGO_VIEW__";
  private static readonly plotMarker = "__NETLOGO_PLOT__";
  private static readonly drawing3DMarker = "__NETLOGO_DRAWING_3D__";

  private readonly child: ChildProcessWithoutNullStreams;

  private stdoutBuffer = "";
  private stderrBuffer = "";
  private pending: PendingCommand | undefined;
  private commandChain = Promise.resolve();
  private readonly ready: Promise<void>;
  private resolveReady: (() => void) | undefined;
  private rejectReady: ((error: Error) => void) | undefined;
  private verboseOutput = false;

  public isDisposed = false;

  public constructor(
    private readonly javaPath: string,
    private readonly jvmArgs: readonly string[],
    private readonly runtimeClassPath: string,
    private readonly modelPath: string,
    private readonly isThreeDModel: boolean,
    private readonly output: vscode.OutputChannel,
    verboseOutput: boolean,
    private readonly commandTimeoutMs: number,
    private readonly onDispose: () => void
  ) {
    this.verboseOutput = verboseOutput;
    const bridgeArgs = this.bridgeModelArgs();
    this.child = spawn(this.javaPath, [...this.jvmArgs, "-cp", this.runtimeClassPath, "NetLogoCommandBridge", ...bridgeArgs], {
      stdio: ["pipe", "pipe", "pipe"]
    });
    const argsForLog = [...this.jvmArgs, "-cp", this.runtimeClassPath, "NetLogoCommandBridge", ...bridgeArgs];
    this.logVerbose(`$ ${this.javaPath} ${argsForLog.map(quoteForLog).join(" ")}`);

    this.ready = new Promise<void>((resolve, reject) => {
      const readyTimer = setTimeout(() => {
        const error = new Error(`NetLogo session did not become ready within ${formatDuration(this.commandTimeoutMs)}.`);
        reject(error);
        this.dispose();
      }, this.commandTimeoutMs);
      this.resolveReady = () => {
        clearTimeout(readyTimer);
        resolve();
      };
      this.rejectReady = (error: Error) => {
        clearTimeout(readyTimer);
        reject(error);
      };
    });

    this.child.stdout.on("data", chunk => {
      this.handleStdout(chunk.toString());
    });

    this.child.stderr.on("data", chunk => {
      const text = chunk.toString();
      this.stderrBuffer += text;
      this.appendVerbose(text);
    });

    this.child.on("error", error => {
      this.failPending(error);
      this.rejectReady?.(error);
      this.dispose();
    });

    this.child.on("close", code => {
      const error = new Error(`NetLogo session exited with code ${code ?? "unknown"}${this.stderrBuffer ? `: ${this.stderrBuffer.trim()}` : ""}`);
      this.failPending(error);
      this.rejectReady?.(error);
      this.dispose();
    });
  }

  private bridgeModelArgs(): readonly string[] {
    return this.isThreeDModel ? ["--3d", this.modelPath] : [this.modelPath];
  }

  public async run(command: string): Promise<void> {
    this.commandChain = this.commandChain.catch(() => undefined).then(() => this.runNow(command));
    return this.commandChain;
  }

  public setVerboseOutput(verboseOutput: boolean): void {
    this.verboseOutput = verboseOutput;
  }

  public matchesModelPath(candidatePath: string): boolean {
    return path.resolve(candidatePath) === path.resolve(this.modelPath);
  }

  public async report(reporter: string, options: NetLogoReportOptions = {}): Promise<string> {
    const next = this.commandChain.catch(() => undefined).then(() => this.reportNow(reporter, options));
    this.commandChain = next.then(() => undefined);
    return next;
  }

  public async exportView(filePath: string): Promise<string> {
    const next = this.commandChain.catch(() => undefined).then(() => this.exportViewNow(filePath));
    this.commandChain = next.then(() => undefined);
    return next;
  }

  public async exportPlot(plotName: string, filePath: string): Promise<string> {
    const next = this.commandChain.catch(() => undefined).then(() => this.exportPlotNow(plotName, filePath));
    this.commandChain = next.then(() => undefined);
    return next;
  }

  public async exportReport(reporter: string, filePath: string): Promise<void> {
    const next = this.commandChain.catch(() => undefined).then(() => this.exportReportNow(reporter, filePath));
    this.commandChain = next.then(() => undefined);
    return next;
  }

  public async reportDrawing3D(): Promise<string> {
    const next = this.commandChain.catch(() => undefined).then(() => this.reportDrawing3DNow());
    this.commandChain = next.then(() => undefined);
    return next;
  }

  public async exportDrawing3D(filePath: string, maxLines: number): Promise<void> {
    const next = this.commandChain.catch(() => undefined).then(() => this.exportDrawing3DNow(filePath, maxLines));
    this.commandChain = next.then(() => undefined);
    return next;
  }

  public async exportDrawing3DBinary(filePath: string): Promise<void> {
    const next = this.commandChain.catch(() => undefined).then(() => this.exportDrawing3DBinaryNow(filePath));
    this.commandChain = next.then(() => undefined);
    return next;
  }

  public dispose(): void {
    if (this.isDisposed) {
      return;
    }

    this.isDisposed = true;
    this.onDispose();
    if (!this.child.killed) {
      this.child.kill();
    }
  }

  private async runNow(command: string): Promise<void> {
    if (this.isDisposed) {
      throw new Error("NetLogo session is already closed.");
    }

    await this.ready;
    this.logVerbose(`netlogo> ${command}`);

    await this.createPending<void>(`command ${command}`, () => {
      this.child.stdin.write(`COMMAND ${Buffer.from(command, "utf8").toString("base64")}\n`, "utf8", error => {
        if (error) {
          this.failPending(error);
        }
      });
    }).catch(error => {
      const message = formatNetLogoErrorMessage(error);
      void vscode.window.showErrorMessage(`NetLogo run failed: ${message}`);
      throw new Error(message);
    });
  }

  private async reportNow(reporter: string, options: NetLogoReportOptions): Promise<string> {
    if (this.isDisposed) {
      throw new Error("NetLogo session is already closed.");
    }

    await this.ready;
    this.logVerbose(`netlogo:report> ${reporter}`);

    return this.createPending<string>(`report ${reporter}`, () => {
      this.child.stdin.write(`REPORT ${Buffer.from(reporter, "utf8").toString("base64")}\n`, "utf8", error => {
        if (error) {
          this.failPending(error);
        }
      });
    }).catch(error => {
      if (options.showError !== false) {
        void vscode.window.showErrorMessage(`NetLogo report failed: ${formatNetLogoErrorMessage(error)}`);
      }
      throw error;
    });
  }

  private async exportViewNow(filePath: string): Promise<string> {
    if (this.isDisposed) {
      throw new Error("NetLogo session is already closed.");
    }

    await this.ready;
    this.logVerbose("netlogo:export-view>");

    return this.createPending<string>("export view", () => {
      this.child.stdin.write(`EXPORT_VIEW ${Buffer.from(filePath, "utf8").toString("base64")}\n`, "utf8", error => {
        if (error) {
          this.failPending(error);
        }
      });
    });
  }

  private async exportPlotNow(plotName: string, filePath: string): Promise<string> {
    if (this.isDisposed) {
      throw new Error("NetLogo session is already closed.");
    }

    await this.ready;
    this.logVerbose(`netlogo:export-plot> ${plotName}`);

    return this.createPending<string>(`export plot ${plotName}`, () => {
      const encodedName = Buffer.from(plotName, "utf8").toString("base64");
      const encodedPath = Buffer.from(filePath, "utf8").toString("base64");
      this.child.stdin.write(`EXPORT_PLOT ${encodedName} ${encodedPath}\n`, "utf8", error => {
        if (error) {
          this.failPending(error);
        }
      });
    });
  }

  private async exportReportNow(reporter: string, filePath: string): Promise<void> {
    if (this.isDisposed) {
      throw new Error("NetLogo session is already closed.");
    }

    await this.ready;
    this.logVerbose(`netlogo:export-report> ${reporter}`);

    return this.createPending<void>("report export", () => {
      const encodedReporter = Buffer.from(reporter, "utf8").toString("base64");
      const encodedPath = Buffer.from(filePath, "utf8").toString("base64");
      this.child.stdin.write(`EXPORT_REPORT ${encodedReporter} ${encodedPath}\n`, "utf8", error => {
        if (error) {
          this.failPending(error);
        }
      });
    }, Math.max(this.commandTimeoutMs, 5 * 60_000));
  }

  private async reportDrawing3DNow(): Promise<string> {
    if (this.isDisposed) {
      throw new Error("NetLogo session is already closed.");
    }

    await this.ready;
    this.logVerbose("netlogo:drawing-3d>");

    return this.createPending<string>("3D drawing", () => {
      this.child.stdin.write("DRAWING_3D\n", "utf8", error => {
        if (error) {
          this.failPending(error);
        }
      });
    });
  }

  private async exportDrawing3DNow(filePath: string, maxLines: number): Promise<void> {
    if (this.isDisposed) {
      throw new Error("NetLogo session is already closed.");
    }

    await this.ready;
    this.logVerbose("netlogo:export-drawing-3d>");

    return this.createPending<void>("3D drawing export", () => {
      const encodedPath = Buffer.from(filePath, "utf8").toString("base64");
      const lineLimit = Math.max(1, Math.floor(Number(maxLines) || DRAWING_3D_RENDER_LIMIT));
      this.child.stdin.write(`EXPORT_DRAWING_3D ${encodedPath} ${lineLimit}\n`, "utf8", error => {
        if (error) {
          this.failPending(error);
        }
      });
    }, Math.max(this.commandTimeoutMs, 5 * 60_000));
  }

  private async exportDrawing3DBinaryNow(filePath: string): Promise<void> {
    if (this.isDisposed) {
      throw new Error("NetLogo session is already closed.");
    }

    await this.ready;
    this.logVerbose("netlogo:export-drawing-3d-binary>");

    return this.createPending<void>("binary 3D drawing export", () => {
      const encodedPath = Buffer.from(filePath, "utf8").toString("base64");
      this.child.stdin.write(`EXPORT_DRAWING_3D_BINARY ${encodedPath}\n`, "utf8", error => {
        if (error) {
          this.failPending(error);
        }
      });
    }, Math.max(this.commandTimeoutMs, 5 * 60_000));
  }

  private handleStdout(text: string): void {
    this.stdoutBuffer += text;
    const lines = this.stdoutBuffer.split(/\r?\n/);
    this.stdoutBuffer = lines.pop() ?? "";

    for (const line of lines) {
      this.handleStdoutLine(line);
    }
  }

  private handleStdoutLine(line: string): void {
    if (line === NetLogoSession.readyMarker) {
      this.resolveReady?.();
      this.logVerbose("NetLogo session ready.");
      return;
    }

    if (line === NetLogoSession.okMarker) {
      this.resolvePending("");
      this.logVerbose("OK");
      return;
    }

    if (line.startsWith(NetLogoSession.reportMarker)) {
      const encoded = line.slice(NetLogoSession.reportMarker.length);
      const value = Buffer.from(encoded, "base64").toString("utf8");
      this.resolvePending(value);
      this.logVerbose(`=> ${value}`);
      return;
    }

    if (line.startsWith(NetLogoSession.viewMarker)) {
      const value = line.slice(NetLogoSession.viewMarker.length);
      this.resolvePending(value);
      this.logVerbose("View exported.");
      return;
    }

    if (line.startsWith(NetLogoSession.plotMarker)) {
      const value = line.slice(NetLogoSession.plotMarker.length);
      this.resolvePending(value);
      this.logVerbose("Plot exported.");
      return;
    }

    if (line.startsWith(NetLogoSession.drawing3DMarker)) {
      const encoded = line.slice(NetLogoSession.drawing3DMarker.length);
      const value = Buffer.from(encoded, "base64").toString("utf8");
      this.resolvePending(value);
      this.logVerbose("3D drawing exported.");
      return;
    }

    if (line.startsWith(NetLogoSession.errorMarker)) {
      const encoded = line.slice(NetLogoSession.errorMarker.length);
      const message = Buffer.from(encoded, "base64").toString("utf8").trim();
      this.failPending(new Error(message || "NetLogo command failed."));
      return;
    }

    this.logVerbose(line);
  }

  private failPending(error: Error): void {
    if (this.pending?.timer) {
      clearTimeout(this.pending.timer);
    }
    this.pending?.reject(error);
    this.pending = undefined;
  }

  private resolvePending(value: string): void {
    if (this.pending?.timer) {
      clearTimeout(this.pending.timer);
    }
    this.pending?.resolve(value);
    this.pending = undefined;
  }

  private createPending<T>(
    label: string,
    write: (resolve: (value: T) => void, reject: (error: Error) => void) => void,
    timeoutMs = this.commandTimeoutMs
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        const error = new Error(`NetLogo ${label} timed out after ${formatDuration(timeoutMs)}.`);
        this.failPending(error);
        this.dispose();
      }, timeoutMs);
      const complete = (value: T): void => {
        clearTimeout(timer);
        resolve(value);
      };
      const fail = (error: Error): void => {
        clearTimeout(timer);
        reject(error);
      };
      this.pending = { resolve: value => complete(value as T), reject: fail, timer };
      write(complete, fail);
    });
  }

  private logVerbose(line: string): void {
    if (this.verboseOutput) {
      this.output.appendLine(line);
    }
  }

  private appendVerbose(text: string): void {
    if (this.verboseOutput) {
      this.output.append(text);
    }
  }
}

interface PendingCommand {
  readonly resolve: (value: string) => void;
  readonly reject: (error: Error) => void;
  readonly timer: NodeJS.Timeout;
}

interface NetLogoReportOptions {
  readonly showError?: boolean;
}

interface RuntimeState {
  readonly commands: readonly string[];
  readonly monitors: readonly MonitorReporter[];
  readonly plots: readonly PlotExporter[];
  readonly hasView: boolean;
}

interface Drawing3DReport {
  readonly data?: ArrayBuffer;
  readonly totalCount?: number;
}

function parseView3DBounds(value: string): View3DBounds | undefined {
  const numbers = parseNetLogoNumberList(value);
  if (numbers.length < 6) {
    return undefined;
  }

  return {
    minX: numbers[0],
    maxX: numbers[1],
    minY: numbers[2],
    maxY: numbers[3],
    minZ: numbers[4],
    maxZ: numbers[5]
  };
}

function parseView3DObserver(value: string): Observer3DValue | undefined {
  const numbers = parseNetLogoNumberList(value);
  if (numbers.length < 3) {
    return undefined;
  }

  return {
    x: numbers[0],
    y: numbers[1],
    z: numbers[2]
  };
}

function parseNetLogoNumberList(value: string): number[] {
  return value
    .replace(/^\s*\[/, "")
    .replace(/\]\s*$/, "")
    .split(/[\s,]+/)
    .map(part => Number(part))
    .filter(number => Number.isFinite(number));
}

function parseCount(value: string): number | undefined {
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function parseNetLogoDelimitedList(value: string): readonly string[] {
  const body = value.trim().replace(/^\[/, "").replace(/\]$/, "").trim();
  if (!body) {
    return [];
  }

  const entries: string[] = [];
  let index = 0;

  while (index < body.length) {
    while (index < body.length && /[\s,]/.test(body[index])) {
      index += 1;
    }

    if (index >= body.length) {
      break;
    }

    if (body[index] === "\"") {
      const parsed = parseQuotedNetLogoString(body, index);
      entries.push(parsed.value);
      index = parsed.end;
      continue;
    }

    let end = index;
    while (end < body.length && body[end] !== ",") {
      end += 1;
    }
    const chunk = body.slice(index, end).trim();
    if (chunk) {
      entries.push(...chunk.split(/\s+(?=-?\d+(?:\.\d+)?\|)/).map(part => part.trim()).filter(Boolean));
    }
    index = end + 1;
  }

  return entries;
}

function parseQuotedNetLogoString(source: string, start: number): { readonly value: string; readonly end: number } {
  let value = "";
  let index = start + 1;

  while (index < source.length) {
    const character = source[index];
    if (character === "\"") {
      if (source[index + 1] === "\"") {
        value += "\"";
        index += 2;
        continue;
      }
      return { value, end: index + 1 };
    }

    if (character === "\\" && index + 1 < source.length) {
      value += source[index + 1];
      index += 2;
      continue;
    }

    value += character;
    index += 1;
  }

  return { value, end: index };
}

export function parseTurtle3DValue(value: string): Turtle3DValue | undefined {
  const parts = value.split("|");
  const hasRgb = parts.length >= 17;
  const numericIndexes = hasRgb
    ? [0, 1, 2, 3, 8, 9, 10]
    : [0, 1, 2, 3, 4, 5, 6, 7];
  const numbers = numericIndexes.map(index => Number(parts[index]));
  if (numbers.some(part => !Number.isFinite(part))) {
    return undefined;
  }

  const shapeIndex = hasRgb ? 11 : 8;
  const labelIndex = hasRgb ? 12 : 9;
  const labelColorIndex = hasRgb ? 13 : 10;
  const penModeIndex = hasRgb ? 17 : 11;
  const penSizeIndex = hasRgb ? 18 : 12;
  const labelColor = Number(parts[labelColorIndex]);
  const penSize = Number(parts[penSizeIndex]);
  const color = Number(parts[4]);
  return {
    who: numbers[0],
    x: numbers[1],
    y: numbers[2],
    z: numbers[3],
    color: Number.isFinite(color) ? color : undefined,
    colorRgb: hasRgb ? parseRgb3DValue(parts, 5) : undefined,
    alpha: parseNetLogoColorAlpha(parts[4]),
    heading: numbers[hasRgb ? 4 : 5],
    pitch: numbers[hasRgb ? 5 : 6],
    size: numbers[hasRgb ? 6 : 7],
    penMode: parts[penModeIndex]?.trim() || undefined,
    penSize: Number.isFinite(penSize) ? penSize : undefined,
    shape: parts[shapeIndex]?.trim() || undefined,
    label: parts[labelIndex] ?? "",
    labelColor: Number.isFinite(labelColor) ? labelColor : undefined,
    labelColorRgb: hasRgb ? parseRgb3DValue(parts, 14) : undefined,
    labelAlpha: parseNetLogoColorAlpha(parts[labelColorIndex])
  };
}

export function parseLink3DValue(value: string): Link3DValue | undefined {
  const parts = value.split("|");
  const hasRgb = parts.length >= 14;
  const numericIndexes = hasRgb
    ? [0, 1, 6]
    : [0, 1, 2, 3];
  const numbers = numericIndexes.map(index => Number(parts[index]));
  if (numbers.some(part => !Number.isFinite(part))) {
    return undefined;
  }

  const directedIndex = hasRgb ? 7 : 4;
  const shapeIndex = hasRgb ? 8 : 5;
  const labelIndex = hasRgb ? 9 : 6;
  const labelColorIndex = hasRgb ? 10 : 7;
  const labelColor = Number(parts[labelColorIndex]);
  const color = Number(parts[2]);
  return {
    end1: numbers[0],
    end2: numbers[1],
    color: Number.isFinite(color) ? color : undefined,
    colorRgb: hasRgb ? parseRgb3DValue(parts, 3) : undefined,
    alpha: parseNetLogoColorAlpha(parts[2]),
    thickness: numbers[hasRgb ? 2 : 3],
    directed: /^(?:true|1)$/i.test(parts[directedIndex] ?? ""),
    shape: parts[shapeIndex]?.trim() || undefined,
    label: parts[labelIndex] ?? "",
    labelColor: Number.isFinite(labelColor) ? labelColor : undefined,
    labelColorRgb: hasRgb ? parseRgb3DValue(parts, 11) : undefined,
    labelAlpha: parseNetLogoColorAlpha(parts[labelColorIndex])
  };
}

export function parsePatch3DValue(value: string): Patch3DValue | undefined {
  const parts = value.split("|");
  const hasRgb = parts.length >= 7;
  const numbers = parts.slice(0, hasRgb ? 3 : 4).map(part => Number(part));
  if (numbers.length < (hasRgb ? 3 : 4) || numbers.some(part => !Number.isFinite(part))) {
    return undefined;
  }

  const color = Number(parts[3]);
  return {
    x: numbers[0],
    y: numbers[1],
    z: numbers[2],
    color: Number.isFinite(color) ? color : undefined,
    colorRgb: parseRgb3DValue(parts, 4),
    alpha: parseNetLogoColorAlpha(parts[3])
  };
}

function parseDrawingLine3DValues(value: string): readonly DrawingLine3DValue[] {
  return value
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => Boolean(line) && !line.startsWith("#"))
    .map(parseDrawingLine3DValue)
    .filter((line): line is DrawingLine3DValue => line !== undefined);
}

function parseDrawingLine3DCount(value: string): number | undefined {
  const firstLine = value.split(/\r?\n/, 1)[0]?.trim() ?? "";
  const match = firstLine.match(/^#\s*count=(\d+)/);
  if (!match) {
    return undefined;
  }
  return parseCount(match[1]);
}

export function parseDrawing3DBinaryCount(value: Buffer): number | undefined {
  const metadata = parseDrawing3DBinaryMetadata(value);
  return metadata?.originalCount;
}

export function parseDrawing3DBinaryMetadata(value: Buffer): {
  readonly originalCount: number;
  readonly recordCount: number;
  readonly recordSize: number;
} | undefined {
  if (value.length < 16 || value.readUInt32BE(0) !== 0x4e4c4433) {
    return undefined;
  }

  const version = value.readUInt32BE(4);
  const originalCount = value.readUInt32BE(8);
  const recordCount = version === 1 ? originalCount : value.length >= 20 ? value.readUInt32BE(12) : 0;
  const recordSize = version === 1 ? value.readUInt32BE(12) : value.length >= 20 ? value.readUInt32BE(16) : 0;
  const headerSize = version === 1 ? 16 : 20;
  if ((version !== 1 && version !== 2) || recordSize !== 32 || value.length < headerSize + recordCount * recordSize) {
    return undefined;
  }
  return { originalCount, recordCount, recordSize };
}

export function parseDrawingLine3DValue(value: string): DrawingLine3DValue | undefined {
  const parts = value.split("|");
  const hasRgb = parts.length >= 11;
  const requiredIndexes = hasRgb ? [0, 1, 2, 3, 4, 5, 6] : [0, 1, 2, 3, 4, 5, 6, 7];
  const numbers = requiredIndexes.map(index => Number(parts[index]));
  if (numbers.some(part => !Number.isFinite(part))) {
    return undefined;
  }

  const color = Number(parts[7]);
  return {
    x0: numbers[0],
    y0: numbers[1],
    z0: numbers[2],
    x1: numbers[3],
    y1: numbers[4],
    z1: numbers[5],
    width: numbers[6],
    color: Number.isFinite(color) ? color : undefined,
    colorRgb: parseRgb3DValue(parts, 8),
    alpha: parseNetLogoColorAlpha(parts[7]),
    heading: parseOptionalNumber(parts[11]),
    pitch: parseOptionalNumber(parts[12]),
    length: parseOptionalNumber(parts[13])
  };
}

function parseOptionalNumber(value: string | undefined): number | undefined {
  if (value === undefined || value === "") {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseRgb3DValue(parts: string[], start: number): Rgb3DValue | undefined {
  const channels = parts.slice(start, start + 3).map(part => Number(part));
  if (channels.length < 3 || channels.some(channel => !Number.isFinite(channel))) {
    return undefined;
  }

  return {
    red: clampRgbChannel(channels[0]),
    green: clampRgbChannel(channels[1]),
    blue: clampRgbChannel(channels[2])
  };
}

function parseNetLogoColorAlpha(value: string | undefined): number | undefined {
  const text = String(value ?? "").trim();
  if (!text) {
    return undefined;
  }
  if (!text.startsWith("[")) {
    return 255;
  }

  const channels = text.slice(1, -1).trim().split(/[\s,]+/).map(Number);
  return channels.length >= 4 && Number.isFinite(channels[3])
    ? clampRgbChannel(channels[3])
    : 255;
}

function clampRgbChannel(value: number): number {
  return Math.min(255, Math.max(0, Math.trunc(value)));
}

function isNetLogoPath(filePath: string): boolean {
  const lower = filePath.toLowerCase();
  return lower.endsWith(".nlogo") || lower.endsWith(".nlogox") || lower.endsWith(".nlogo3d");
}

function normalizeCommandTimeoutMs(value: number | undefined): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return DEFAULT_COMMAND_TIMEOUT_MS;
  }
  return Math.max(1_000, Math.min(30 * 60_000, Math.round(numeric)));
}

function formatDuration(milliseconds: number): string {
  if (milliseconds >= 60_000 && milliseconds % 60_000 === 0) {
    return `${milliseconds / 60_000} minute${milliseconds === 60_000 ? "" : "s"}`;
  }
  if (milliseconds >= 1_000 && milliseconds % 1_000 === 0) {
    return `${milliseconds / 1_000} second${milliseconds === 1_000 ? "" : "s"}`;
  }
  return `${milliseconds} ms`;
}

function processDiagnostic(stdout: string, stderr: string): string {
  const output = `${stderr}\n${stdout}`
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .join(" ");
  return output.length > 500 ? `${output.slice(0, 497)}...` : output;
}

function isFresh(targetPath: string, sourcePath: string): boolean {
  try {
    return fs.statSync(targetPath).mtimeMs >= fs.statSync(sourcePath).mtimeMs;
  } catch {
    return false;
  }
}

function fileSha256(filePath: string): string {
  return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function readTextFile(filePath: string): string | undefined {
  try {
    return fs.readFileSync(filePath, "utf8").trim();
  } catch {
    return undefined;
  }
}

function deleteTemporaryExport(exportPath: string): void {
  try {
    fs.unlinkSync(exportPath);
  } catch {
    // Export files are temporary; a failed cleanup should not hide the real result.
  }
}

function exactArrayBuffer(value: Buffer): ArrayBuffer {
  if (value.byteOffset === 0 && value.byteLength === value.buffer.byteLength && value.buffer instanceof ArrayBuffer) {
    return value.buffer;
  }
  return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer;
}

function quoteForLog(value: string): string {
  return /\s/.test(value) ? JSON.stringify(value) : value;
}

async function saveDocumentIfDirty(uri: vscode.Uri): Promise<void> {
  const document = vscode.workspace.textDocuments.find(candidate => candidate.uri.toString() === uri.toString());
  if (document?.isDirty) {
    const saved = await document.save();
    if (!saved) {
      throw new Error("NetLogo run cancelled because the model has unsaved changes that could not be saved.");
    }
  }
}

async function readDocumentText(uri: vscode.Uri): Promise<string> {
  const document = vscode.workspace.textDocuments.find(candidate => candidate.uri.toString() === uri.toString());
  if (document) {
    return document.getText();
  }

  return fs.promises.readFile(uri.fsPath, "utf8");
}
