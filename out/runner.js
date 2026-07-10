"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.NetLogoRunner = void 0;
exports.formatNetLogoErrorMessage = formatNetLogoErrorMessage;
exports.parseNetLogoDelimitedList = parseNetLogoDelimitedList;
exports.parseTurtle3DValue = parseTurtle3DValue;
exports.parseLink3DValue = parseLink3DValue;
exports.parsePatch3DValue = parsePatch3DValue;
exports.parseDrawing3DBinaryCount = parseDrawing3DBinaryCount;
exports.parseDrawing3DBinaryMetadata = parseDrawing3DBinaryMetadata;
exports.parseDrawingLine3DValue = parseDrawingLine3DValue;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const crypto_1 = require("crypto");
const child_process_1 = require("child_process");
const vscode = __importStar(require("vscode"));
const classicInterface_1 = require("./classicInterface");
const netlogoInstallation_1 = require("./netlogoInstallation");
const modelFormat_1 = require("./modelFormat");
const DEFAULT_COMMAND_TIMEOUT_MS = 60000;
const DRAWING_3D_RENDER_LIMIT = 160000;
function formatNetLogoErrorMessage(error) {
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
function stripJavaStackTrace(message) {
    return message
        .replace(/\r?\n\s*at\s+[A-Za-z_$][\w.$]*\([^)]*\)/g, "")
        .replace(/\s+at\s+[A-Za-z_$][\w.$]*\([^)]*\).*$/s, "")
        .trim();
}
class NetLogoRunner {
    constructor(context, output) {
        this.context = context;
        this.output = output;
        this.sessions = new Map();
    }
    async run(resource, command, options = {}) {
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
        const installation = (0, netlogoInstallation_1.resolveNetLogoClassPath)({
            configuredClassPath: config.get("classPath", []),
            home: config.get("home", ""),
            autoDetect: config.get("autoDetect", true)
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
        const javaPath = config.get("javaPath", "java");
        const javacPath = config.get("javacPath", "javac");
        const jvmArgs = [...installation.jvmArgs, ...(0, netlogoInstallation_1.getConfiguredJvmArgs)(config.get("jvmArgs", []))];
        const verboseOutput = config.get("verboseOutput", false);
        const commandTimeoutMs = normalizeCommandTimeoutMs(config.get("commandTimeoutMs", DEFAULT_COMMAND_TIMEOUT_MS));
        const isThreeDModel = uri.fsPath.toLowerCase().endsWith(".nlogo3d");
        let activeSession;
        const runTask = async (token) => {
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
                const monitorValues = [];
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
                const plotValues = [];
                for (const plot of runtimeState.plots) {
                    const csv = await this.tryExportPlot(session, plot);
                    if (csv !== undefined) {
                        plotValues.push({
                            ...plot,
                            csv
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
            }
            finally {
                cancellation?.dispose();
            }
        };
        if (options.showProgress === false) {
            return runTask();
        }
        return vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `NetLogo: ${command}`,
            cancellable: true
        }, (_progress, token) => runTask(token).catch(error => {
            if (token.isCancellationRequested) {
                activeSession?.dispose();
            }
            throw error;
        }));
    }
    dispose() {
        for (const session of this.sessions.values()) {
            session.dispose();
        }
        this.sessions.clear();
    }
    async resolveResource(resource) {
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
    async ensureBridgeCompiled(javacPath, classPath, verboseOutput, commandTimeoutMs) {
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
    async spawnLogged(command, args, verboseOutput, commandTimeoutMs) {
        this.logVerbose(verboseOutput, `$ ${command} ${args.map(quoteForLog).join(" ")}`);
        await new Promise((resolve, reject) => {
            let stdout = "";
            let stderr = "";
            const child = (0, child_process_1.spawn)(command, [...args], {
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
                }
                else {
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
    getSession(modelPath, javaPath, jvmArgs, runtimeClassPath, isThreeDModel, verboseOutput, commandTimeoutMs) {
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
    logVerbose(verboseOutput, line) {
        if (verboseOutput) {
            this.output.appendLine(line);
        }
    }
    appendVerbose(verboseOutput, text) {
        if (verboseOutput) {
            this.output.append(text);
        }
    }
    async getRuntimeState(uri) {
        const text = await readDocumentText(uri);
        const model = (0, modelFormat_1.parseNetLogoModel)(text, uri.fsPath);
        const preview = (0, classicInterface_1.parseInterfacePreview)(model.interfaceSource, model.format);
        return {
            commands: (0, classicInterface_1.getWidgetRuntimeCommands)(preview.widgets),
            monitors: (0, classicInterface_1.getMonitorReporters)(preview.widgets),
            plots: (0, classicInterface_1.getPlotExporters)(preview.widgets),
            hasView: preview.widgets.some(widget => widget.kind === "view")
        };
    }
    async tryExportView(session) {
        const exportDir = path.join(this.context.globalStorageUri.fsPath, "view-exports");
        fs.mkdirSync(exportDir, { recursive: true });
        const exportPath = path.join(exportDir, `view-${Date.now()}-${Math.random().toString(16).slice(2)}.png`);
        try {
            const base64Png = await session.exportView(exportPath);
            return base64Png ? `data:image/png;base64,${base64Png}` : undefined;
        }
        catch (error) {
            this.output.appendLine(`View export failed: ${error instanceof Error ? error.message : String(error)}`);
            return undefined;
        }
    }
    async tryReportTicks(session) {
        try {
            return await session.report("ticks", { showError: false });
        }
        catch {
            return null;
        }
    }
    async tryReportMonitor(session, monitor, verboseOutput) {
        try {
            return await session.report(monitor.source, { showError: false });
        }
        catch (error) {
            const message = formatNetLogoErrorMessage(error);
            this.logVerbose(verboseOutput, `Monitor report failed (${monitor.label}): ${message}`);
            return `Error: ${message}`;
        }
    }
    async tryReportView3D(session, verboseOutput) {
        try {
            const boundsText = await session.report("list min-pxcor max-pxcor min-pycor max-pycor min-pzcor max-pzcor", { showError: false });
            const bounds = parseView3DBounds(boundsText);
            if (!bounds) {
                return undefined;
            }
            const turtleCount = await this.tryReport3DCount(session, "count turtles", "turtles", verboseOutput);
            const linkCount = await this.tryReport3DCount(session, "count links", "links", verboseOutput);
            const patchCount = await this.tryReport3DCount(session, "count patches with [pcolor != black]", "patches", verboseOutput);
            const turtlesText = await this.tryReport3DList(session, "[ (word who \"|\" xcor \"|\" ycor \"|\" zcor \"|\" color \"|\" (item 0 (extract-rgb color)) \"|\" (item 1 (extract-rgb color)) \"|\" (item 2 (extract-rgb color)) \"|\" heading \"|\" pitch \"|\" size \"|\" shape \"|\" label \"|\" label-color \"|\" (item 0 (extract-rgb label-color)) \"|\" (item 1 (extract-rgb label-color)) \"|\" (item 2 (extract-rgb label-color)) \"|\" pen-mode \"|\" pen-size) ] of turtles", "turtles", verboseOutput);
            const linksText = await this.tryReport3DList(session, "[ (word [who] of end1 \"|\" [who] of end2 \"|\" color \"|\" (item 0 (extract-rgb color)) \"|\" (item 1 (extract-rgb color)) \"|\" (item 2 (extract-rgb color)) \"|\" thickness \"|\" (is-directed-link? self) \"|\" shape \"|\" label \"|\" label-color \"|\" (item 0 (extract-rgb label-color)) \"|\" (item 1 (extract-rgb label-color)) \"|\" (item 2 (extract-rgb label-color))) ] of links", "links", verboseOutput);
            const patchesText = await this.tryReport3DList(session, "[ (word pxcor \"|\" pycor \"|\" pzcor \"|\" pcolor \"|\" (item 0 (extract-rgb pcolor)) \"|\" (item 1 (extract-rgb pcolor)) \"|\" (item 2 (extract-rgb pcolor))) ] of sublist (sort patches with [pcolor != black]) 0 (min (list 5000 count patches with [pcolor != black]))", "patches", verboseOutput);
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
                turtles: parseNetLogoDelimitedList(turtlesText).map(parseTurtle3DValue).filter((value) => value !== undefined),
                links: parseNetLogoDelimitedList(linksText).map(parseLink3DValue).filter((value) => value !== undefined),
                patches: parseNetLogoDelimitedList(patchesText).map(parsePatch3DValue).filter((value) => value !== undefined),
                drawingLines: []
            };
        }
        catch (error) {
            this.logVerbose(verboseOutput, `3D view state failed: ${formatNetLogoErrorMessage(error)}`);
            return undefined;
        }
    }
    async tryReportView3DObserver(session, verboseOutput) {
        try {
            return parseView3DObserver(await session.report("list __oxcor __oycor __ozcor", { showError: false }));
        }
        catch (error) {
            this.logVerbose(verboseOutput, `3D observer report failed: ${formatNetLogoErrorMessage(error)}`);
            return undefined;
        }
    }
    async tryReportDrawing3D(session, verboseOutput) {
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
        }
        catch (error) {
            this.logVerbose(verboseOutput, `3D drawing report failed: ${formatNetLogoErrorMessage(error)}`);
            return { data: undefined, totalCount: undefined };
        }
        finally {
            try {
                fs.unlinkSync(exportPath);
            }
            catch {
                // Drawing exports are temporary; a failed cleanup should not hide the real result.
            }
        }
    }
    async tryReport3DList(session, reporter, label, verboseOutput) {
        const exportDir = path.join(this.context.globalStorageUri.fsPath, "report-3d-exports");
        fs.mkdirSync(exportDir, { recursive: true });
        const exportPath = path.join(exportDir, `${label}-3d-${Date.now()}-${Math.random().toString(16).slice(2)}.txt`);
        try {
            await session.exportReport(reporter, exportPath);
            return readTextFile(exportPath) ?? "[]";
        }
        catch (error) {
            this.logVerbose(verboseOutput, `3D ${label} report failed: ${formatNetLogoErrorMessage(error)}`);
            return "[]";
        }
        finally {
            try {
                fs.unlinkSync(exportPath);
            }
            catch {
                // 3D report exports are temporary; a failed cleanup should not hide the real result.
            }
        }
    }
    async tryReport3DCount(session, reporter, label, verboseOutput) {
        try {
            return parseCount(await session.report(reporter, { showError: false }));
        }
        catch (error) {
            this.logVerbose(verboseOutput, `3D ${label} count failed: ${formatNetLogoErrorMessage(error)}`);
            return undefined;
        }
    }
    async tryExportPlot(session, plot) {
        const exportDir = path.join(this.context.globalStorageUri.fsPath, "plot-exports");
        fs.mkdirSync(exportDir, { recursive: true });
        const exportPath = path.join(exportDir, `plot-${Date.now()}-${Math.random().toString(16).slice(2)}.csv`);
        try {
            const base64Csv = await session.exportPlot(plot.plotName, exportPath);
            return Buffer.from(base64Csv, "base64").toString("utf8");
        }
        catch (error) {
            this.output.appendLine(`Plot export failed (${plot.plotName}): ${error instanceof Error ? error.message : String(error)}`);
            return undefined;
        }
    }
}
exports.NetLogoRunner = NetLogoRunner;
class NetLogoSession {
    constructor(javaPath, jvmArgs, runtimeClassPath, modelPath, isThreeDModel, output, verboseOutput, commandTimeoutMs, onDispose) {
        this.javaPath = javaPath;
        this.jvmArgs = jvmArgs;
        this.runtimeClassPath = runtimeClassPath;
        this.modelPath = modelPath;
        this.isThreeDModel = isThreeDModel;
        this.output = output;
        this.commandTimeoutMs = commandTimeoutMs;
        this.onDispose = onDispose;
        this.stdoutBuffer = "";
        this.stderrBuffer = "";
        this.commandChain = Promise.resolve();
        this.verboseOutput = false;
        this.isDisposed = false;
        this.verboseOutput = verboseOutput;
        const bridgeArgs = this.bridgeModelArgs();
        this.child = (0, child_process_1.spawn)(this.javaPath, [...this.jvmArgs, "-cp", this.runtimeClassPath, "NetLogoCommandBridge", ...bridgeArgs], {
            stdio: ["pipe", "pipe", "pipe"]
        });
        const argsForLog = [...this.jvmArgs, "-cp", this.runtimeClassPath, "NetLogoCommandBridge", ...bridgeArgs];
        this.logVerbose(`$ ${this.javaPath} ${argsForLog.map(quoteForLog).join(" ")}`);
        this.ready = new Promise((resolve, reject) => {
            const readyTimer = setTimeout(() => {
                const error = new Error(`NetLogo session did not become ready within ${formatDuration(this.commandTimeoutMs)}.`);
                reject(error);
                this.dispose();
            }, this.commandTimeoutMs);
            this.resolveReady = () => {
                clearTimeout(readyTimer);
                resolve();
            };
            this.rejectReady = (error) => {
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
    bridgeModelArgs() {
        return this.isThreeDModel ? ["--3d", this.modelPath] : [this.modelPath];
    }
    async run(command) {
        this.commandChain = this.commandChain.catch(() => undefined).then(() => this.runNow(command));
        return this.commandChain;
    }
    setVerboseOutput(verboseOutput) {
        this.verboseOutput = verboseOutput;
    }
    async report(reporter, options = {}) {
        const next = this.commandChain.catch(() => undefined).then(() => this.reportNow(reporter, options));
        this.commandChain = next.then(() => undefined);
        return next;
    }
    async exportView(filePath) {
        const next = this.commandChain.catch(() => undefined).then(() => this.exportViewNow(filePath));
        this.commandChain = next.then(() => undefined);
        return next;
    }
    async exportPlot(plotName, filePath) {
        const next = this.commandChain.catch(() => undefined).then(() => this.exportPlotNow(plotName, filePath));
        this.commandChain = next.then(() => undefined);
        return next;
    }
    async exportReport(reporter, filePath) {
        const next = this.commandChain.catch(() => undefined).then(() => this.exportReportNow(reporter, filePath));
        this.commandChain = next.then(() => undefined);
        return next;
    }
    async reportDrawing3D() {
        const next = this.commandChain.catch(() => undefined).then(() => this.reportDrawing3DNow());
        this.commandChain = next.then(() => undefined);
        return next;
    }
    async exportDrawing3D(filePath, maxLines) {
        const next = this.commandChain.catch(() => undefined).then(() => this.exportDrawing3DNow(filePath, maxLines));
        this.commandChain = next.then(() => undefined);
        return next;
    }
    async exportDrawing3DBinary(filePath) {
        const next = this.commandChain.catch(() => undefined).then(() => this.exportDrawing3DBinaryNow(filePath));
        this.commandChain = next.then(() => undefined);
        return next;
    }
    dispose() {
        if (this.isDisposed) {
            return;
        }
        this.isDisposed = true;
        this.onDispose();
        if (!this.child.killed) {
            this.child.kill();
        }
    }
    async runNow(command) {
        if (this.isDisposed) {
            throw new Error("NetLogo session is already closed.");
        }
        await this.ready;
        this.logVerbose(`netlogo> ${command}`);
        await this.createPending(`command ${command}`, () => {
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
    async reportNow(reporter, options) {
        if (this.isDisposed) {
            throw new Error("NetLogo session is already closed.");
        }
        await this.ready;
        this.logVerbose(`netlogo:report> ${reporter}`);
        return this.createPending(`report ${reporter}`, () => {
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
    async exportViewNow(filePath) {
        if (this.isDisposed) {
            throw new Error("NetLogo session is already closed.");
        }
        await this.ready;
        this.logVerbose("netlogo:export-view>");
        return this.createPending("export view", () => {
            this.child.stdin.write(`EXPORT_VIEW ${Buffer.from(filePath, "utf8").toString("base64")}\n`, "utf8", error => {
                if (error) {
                    this.failPending(error);
                }
            });
        });
    }
    async exportPlotNow(plotName, filePath) {
        if (this.isDisposed) {
            throw new Error("NetLogo session is already closed.");
        }
        await this.ready;
        this.logVerbose(`netlogo:export-plot> ${plotName}`);
        return this.createPending(`export plot ${plotName}`, () => {
            const encodedName = Buffer.from(plotName, "utf8").toString("base64");
            const encodedPath = Buffer.from(filePath, "utf8").toString("base64");
            this.child.stdin.write(`EXPORT_PLOT ${encodedName} ${encodedPath}\n`, "utf8", error => {
                if (error) {
                    this.failPending(error);
                }
            });
        });
    }
    async exportReportNow(reporter, filePath) {
        if (this.isDisposed) {
            throw new Error("NetLogo session is already closed.");
        }
        await this.ready;
        this.logVerbose(`netlogo:export-report> ${reporter}`);
        return this.createPending("report export", () => {
            const encodedReporter = Buffer.from(reporter, "utf8").toString("base64");
            const encodedPath = Buffer.from(filePath, "utf8").toString("base64");
            this.child.stdin.write(`EXPORT_REPORT ${encodedReporter} ${encodedPath}\n`, "utf8", error => {
                if (error) {
                    this.failPending(error);
                }
            });
        }, Math.max(this.commandTimeoutMs, 5 * 60000));
    }
    async reportDrawing3DNow() {
        if (this.isDisposed) {
            throw new Error("NetLogo session is already closed.");
        }
        await this.ready;
        this.logVerbose("netlogo:drawing-3d>");
        return this.createPending("3D drawing", () => {
            this.child.stdin.write("DRAWING_3D\n", "utf8", error => {
                if (error) {
                    this.failPending(error);
                }
            });
        });
    }
    async exportDrawing3DNow(filePath, maxLines) {
        if (this.isDisposed) {
            throw new Error("NetLogo session is already closed.");
        }
        await this.ready;
        this.logVerbose("netlogo:export-drawing-3d>");
        return this.createPending("3D drawing export", () => {
            const encodedPath = Buffer.from(filePath, "utf8").toString("base64");
            const lineLimit = Math.max(1, Math.floor(Number(maxLines) || DRAWING_3D_RENDER_LIMIT));
            this.child.stdin.write(`EXPORT_DRAWING_3D ${encodedPath} ${lineLimit}\n`, "utf8", error => {
                if (error) {
                    this.failPending(error);
                }
            });
        }, Math.max(this.commandTimeoutMs, 5 * 60000));
    }
    async exportDrawing3DBinaryNow(filePath) {
        if (this.isDisposed) {
            throw new Error("NetLogo session is already closed.");
        }
        await this.ready;
        this.logVerbose("netlogo:export-drawing-3d-binary>");
        return this.createPending("binary 3D drawing export", () => {
            const encodedPath = Buffer.from(filePath, "utf8").toString("base64");
            this.child.stdin.write(`EXPORT_DRAWING_3D_BINARY ${encodedPath}\n`, "utf8", error => {
                if (error) {
                    this.failPending(error);
                }
            });
        }, Math.max(this.commandTimeoutMs, 5 * 60000));
    }
    handleStdout(text) {
        this.stdoutBuffer += text;
        const lines = this.stdoutBuffer.split(/\r?\n/);
        this.stdoutBuffer = lines.pop() ?? "";
        for (const line of lines) {
            this.handleStdoutLine(line);
        }
    }
    handleStdoutLine(line) {
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
    failPending(error) {
        if (this.pending?.timer) {
            clearTimeout(this.pending.timer);
        }
        this.pending?.reject(error);
        this.pending = undefined;
    }
    resolvePending(value) {
        if (this.pending?.timer) {
            clearTimeout(this.pending.timer);
        }
        this.pending?.resolve(value);
        this.pending = undefined;
    }
    createPending(label, write, timeoutMs = this.commandTimeoutMs) {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                const error = new Error(`NetLogo ${label} timed out after ${formatDuration(timeoutMs)}.`);
                this.failPending(error);
                this.dispose();
            }, timeoutMs);
            const complete = (value) => {
                clearTimeout(timer);
                resolve(value);
            };
            const fail = (error) => {
                clearTimeout(timer);
                reject(error);
            };
            this.pending = { resolve: value => complete(value), reject: fail, timer };
            write(complete, fail);
        });
    }
    logVerbose(line) {
        if (this.verboseOutput) {
            this.output.appendLine(line);
        }
    }
    appendVerbose(text) {
        if (this.verboseOutput) {
            this.output.append(text);
        }
    }
}
NetLogoSession.readyMarker = "__NETLOGO_READY__";
NetLogoSession.okMarker = "__NETLOGO_OK__";
NetLogoSession.errorMarker = "__NETLOGO_ERROR__";
NetLogoSession.reportMarker = "__NETLOGO_REPORT__";
NetLogoSession.viewMarker = "__NETLOGO_VIEW__";
NetLogoSession.plotMarker = "__NETLOGO_PLOT__";
NetLogoSession.drawing3DMarker = "__NETLOGO_DRAWING_3D__";
function parseView3DBounds(value) {
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
function parseView3DObserver(value) {
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
function parseNetLogoNumberList(value) {
    return value
        .replace(/^\s*\[/, "")
        .replace(/\]\s*$/, "")
        .split(/[\s,]+/)
        .map(part => Number(part))
        .filter(number => Number.isFinite(number));
}
function parseCount(value) {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : undefined;
}
function parseNetLogoDelimitedList(value) {
    const body = value.trim().replace(/^\[/, "").replace(/\]$/, "").trim();
    if (!body) {
        return [];
    }
    const entries = [];
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
function parseQuotedNetLogoString(source, start) {
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
function parseTurtle3DValue(value) {
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
function parseLink3DValue(value) {
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
function parsePatch3DValue(value) {
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
function parseDrawingLine3DValues(value) {
    return value
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(line => Boolean(line) && !line.startsWith("#"))
        .map(parseDrawingLine3DValue)
        .filter((line) => line !== undefined);
}
function parseDrawingLine3DCount(value) {
    const firstLine = value.split(/\r?\n/, 1)[0]?.trim() ?? "";
    const match = firstLine.match(/^#\s*count=(\d+)/);
    if (!match) {
        return undefined;
    }
    return parseCount(match[1]);
}
function parseDrawing3DBinaryCount(value) {
    const metadata = parseDrawing3DBinaryMetadata(value);
    return metadata?.originalCount;
}
function parseDrawing3DBinaryMetadata(value) {
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
function parseDrawingLine3DValue(value) {
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
function parseOptionalNumber(value) {
    if (value === undefined || value === "") {
        return undefined;
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
}
function parseRgb3DValue(parts, start) {
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
function parseNetLogoColorAlpha(value) {
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
function clampRgbChannel(value) {
    return Math.min(255, Math.max(0, Math.trunc(value)));
}
function isNetLogoPath(filePath) {
    const lower = filePath.toLowerCase();
    return lower.endsWith(".nlogo") || lower.endsWith(".nlogox") || lower.endsWith(".nlogo3d");
}
function normalizeCommandTimeoutMs(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
        return DEFAULT_COMMAND_TIMEOUT_MS;
    }
    return Math.max(1000, Math.min(30 * 60000, Math.round(numeric)));
}
function formatDuration(milliseconds) {
    if (milliseconds >= 60000 && milliseconds % 60000 === 0) {
        return `${milliseconds / 60000} minute${milliseconds === 60000 ? "" : "s"}`;
    }
    if (milliseconds >= 1000 && milliseconds % 1000 === 0) {
        return `${milliseconds / 1000} second${milliseconds === 1000 ? "" : "s"}`;
    }
    return `${milliseconds} ms`;
}
function processDiagnostic(stdout, stderr) {
    const output = `${stderr}\n${stdout}`
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(Boolean)
        .join(" ");
    return output.length > 500 ? `${output.slice(0, 497)}...` : output;
}
function isFresh(targetPath, sourcePath) {
    try {
        return fs.statSync(targetPath).mtimeMs >= fs.statSync(sourcePath).mtimeMs;
    }
    catch {
        return false;
    }
}
function fileSha256(filePath) {
    return (0, crypto_1.createHash)("sha256").update(fs.readFileSync(filePath)).digest("hex");
}
function readTextFile(filePath) {
    try {
        return fs.readFileSync(filePath, "utf8").trim();
    }
    catch {
        return undefined;
    }
}
function exactArrayBuffer(value) {
    if (value.byteOffset === 0 && value.byteLength === value.buffer.byteLength && value.buffer instanceof ArrayBuffer) {
        return value.buffer;
    }
    return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
}
function quoteForLog(value) {
    return /\s/.test(value) ? JSON.stringify(value) : value;
}
async function saveDocumentIfDirty(uri) {
    const document = vscode.workspace.textDocuments.find(candidate => candidate.uri.toString() === uri.toString());
    if (document?.isDirty) {
        const saved = await document.save();
        if (!saved) {
            throw new Error("NetLogo run cancelled because the model has unsaved changes that could not be saved.");
        }
    }
}
async function readDocumentText(uri) {
    const document = vscode.workspace.textDocuments.find(candidate => candidate.uri.toString() === uri.toString());
    if (document) {
        return document.getText();
    }
    return fs.promises.readFile(uri.fsPath, "utf8");
}
//# sourceMappingURL=runner.js.map