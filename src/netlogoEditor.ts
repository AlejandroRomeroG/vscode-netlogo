import * as path from "path";
import * as vscode from "vscode";
import { promptForNetLogoCommand, rememberNetLogoCommand } from "./commandPrompt";
import {
  createInterfaceWidget,
  deleteInterfaceWidget,
  parseInterfacePreview,
  updateInterfaceWidgetBounds,
  updateInterfaceWidgetProperties,
  type AddableWidgetKind,
  type WidgetBounds,
  type WidgetPropertyUpdates
} from "./classicInterface";
import { parseNetLogoModel, serializeNetLogoModel } from "./modelFormat";
import { resolveNetLogoClassPath } from "./netlogoInstallation";
import {
  formatNetLogoErrorMessage,
  type NetLogoRunOptions,
  type NetLogoRunResult,
  type NetLogoRunner
} from "./runner";

type EditableSection = "code" | "interfaceSource" | "info";

interface WebviewUpdateMessage {
  readonly type: "update";
  readonly section: EditableSection;
  readonly value: string;
}

interface WebviewRunMessage {
  readonly type: "run";
  readonly command: "setup" | "go";
  readonly silent?: boolean;
}

interface WebviewRunCommandMessage {
  readonly type: "run-command";
  readonly command: string;
  readonly repeat?: number;
  readonly silent?: boolean;
}

interface WebviewPromptCommandMessage {
  readonly type: "prompt-command";
}

interface WebviewUpdateBoundsMessage {
  readonly type: "update-bounds";
  readonly widgetId: string;
  readonly bounds: WidgetBounds;
}

interface WebviewUpdatePropertiesMessage {
  readonly type: "update-properties";
  readonly widgetId: string;
  readonly updates: WidgetPropertyUpdates;
}

interface WebviewAddWidgetMessage {
  readonly type: "add-widget";
  readonly kind: AddableWidgetKind;
  readonly bounds: WidgetBounds;
}

interface WebviewDeleteWidgetMessage {
  readonly type: "delete-widget";
  readonly widgetId: string;
}

interface WebviewConfigureMessage {
  readonly type: "configure-runtime";
}

interface WebviewShowOutputMessage {
  readonly type: "show-output";
}

interface WebviewOpenNativeMessage {
  readonly type: "open-native";
}

interface WebviewSaveDocumentMessage {
  readonly type: "save-document";
}

interface WebviewReadyMessage {
  readonly type: "ready";
}

type WebviewMessage =
  | WebviewUpdateMessage
  | WebviewRunMessage
  | WebviewRunCommandMessage
  | WebviewPromptCommandMessage
  | WebviewUpdateBoundsMessage
  | WebviewUpdatePropertiesMessage
  | WebviewAddWidgetMessage
  | WebviewDeleteWidgetMessage
  | WebviewConfigureMessage
  | WebviewShowOutputMessage
  | WebviewOpenNativeMessage
  | WebviewSaveDocumentMessage
  | WebviewReadyMessage;

export class NetLogoModelEditorProvider implements vscode.CustomTextEditorProvider {
  public static readonly viewType = "netlogo.modelEditor";

  private readonly runtimeConfiguredCache = new Map<string, boolean>();

  public static register(context: vscode.ExtensionContext, runner: NetLogoRunner): vscode.Disposable {
    return vscode.window.registerCustomEditorProvider(
      NetLogoModelEditorProvider.viewType,
      new NetLogoModelEditorProvider(context, runner),
      {
        supportsMultipleEditorsPerDocument: true,
        webviewOptions: {
          retainContextWhenHidden: true
        }
      }
    );
  }

  private constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly runner: NetLogoRunner
  ) {
  }

  public async resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel
  ): Promise<void> {
    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.context.extensionUri, "resources")
      ]
    };

    webviewPanel.webview.html = this.getHtml(webviewPanel.webview);
    void vscode.commands.executeCommand("workbench.action.keepEditor");

    const updateWebview = (): void => {
      const model = parseNetLogoModel(document.getText(), document.fileName);
      const interfacePreview = parseInterfacePreview(model.interfaceSource, model.format);
      void webviewPanel.webview.postMessage({
        type: "model",
        version: document.version,
        fileName: path.basename(document.fileName),
        format: model.format,
        code: model.code,
        interfaceSource: model.interfaceSource,
        info: model.info,
        interfacePreview,
        runtimeConfigured: this.isRuntimeConfigured(document.uri)
      });
    };

    const documentChangeSubscription = vscode.workspace.onDidChangeTextDocument(event => {
      if (event.document.uri.toString() === document.uri.toString()) {
        updateWebview();
      }
    });
    const viewStateSubscription = webviewPanel.onDidChangeViewState(event => {
      if (event.webviewPanel.visible) {
        updateWebview();
      }
    });

    webviewPanel.onDidDispose(() => {
      documentChangeSubscription.dispose();
      viewStateSubscription.dispose();
    });

    webviewPanel.webview.onDidReceiveMessage(async (message: WebviewMessage) => {
      if (message.type === "ready") {
        updateWebview();
        return;
      }

      if (message.type === "update") {
        await this.updateDocument(document, message.section, message.value);
        return;
      }

      if (message.type === "run") {
        const command = message.command === "setup" ? "setup" : "go";
        await rememberNetLogoCommand(this.context, command);
        await this.runAndPost(webviewPanel.webview, document.uri, command, { showProgress: message.silent !== true });
        return;
      }

      if (message.type === "run-command") {
        const command = message.command.trim();
        if (command) {
          const repeat = Math.max(1, Math.min(256, Math.floor(Number(message.repeat) || 1)));
          const executionCommand = repeat > 1 ? `repeat ${repeat} [ ${command} ]` : command;
          await rememberNetLogoCommand(this.context, command);
          await this.runAndPost(webviewPanel.webview, document.uri, executionCommand, { showProgress: message.silent !== true });
        }
        return;
      }

      if (message.type === "prompt-command") {
        const command = await promptForNetLogoCommand(this.context, {
          prompt: "Command to run in this model workspace"
        });
        if (command) {
          await this.runAndPost(webviewPanel.webview, document.uri, command, { showProgress: true });
        }
        return;
      }

      if (message.type === "update-bounds") {
        await this.updateWidgetBounds(document, message.widgetId, message.bounds);
        return;
      }

      if (message.type === "update-properties") {
        await this.updateWidgetProperties(document, message.widgetId, message.updates);
        return;
      }

      if (message.type === "add-widget") {
        await this.addWidget(document, message.kind, message.bounds);
        return;
      }

      if (message.type === "delete-widget") {
        await this.deleteWidget(document, message.widgetId);
        return;
      }

      if (message.type === "configure-runtime") {
        await vscode.commands.executeCommand("netlogo.configure");
        updateWebview();
        return;
      }

      if (message.type === "show-output") {
        await vscode.commands.executeCommand("netlogo.showOutput");
        return;
      }

      if (message.type === "open-native") {
        await webviewPanel.webview.postMessage({ type: "native-opening", opening: true });
        try {
          await vscode.commands.executeCommand("netlogo.openInNetLogo", document.uri);
        } finally {
          await webviewPanel.webview.postMessage({ type: "native-opening", opening: false });
        }
        return;
      }

      if (message.type === "save-document") {
        await document.save();
        return;
      }

    });

    updateWebview();
  }

  private async runAndPost(
    webview: vscode.Webview,
    resource: vscode.Uri,
    command: string,
    options: NetLogoRunOptions
  ): Promise<void> {
    try {
      const result = await this.runner.run(resource, command, options);
      await this.postRuntimeResult(webview, result);
    } catch (error) {
      this.postRuntimeError(webview, error);
    }
  }

  private async postRuntimeResult(webview: vscode.Webview, result: NetLogoRunResult | undefined): Promise<void> {
    const delivered = await webview.postMessage({
      type: "runtime-result",
      result: result ?? null
    });
    if (!delivered) {
      throw new Error("The NetLogo runtime result could not be delivered to the model editor.");
    }
  }

  private postRuntimeError(webview: vscode.Webview, error: unknown): void {
    void webview.postMessage({
      type: "runtime-error",
      message: formatNetLogoErrorMessage(error)
    });
  }

  private isRuntimeConfigured(resource: vscode.Uri): boolean {
    const config = vscode.workspace.getConfiguration("netlogo", resource);
    const configuredClassPath = config.get<string[]>("classPath", []);
    const home = config.get<string>("home", "");
    const autoDetect = config.get<boolean>("autoDetect", true);
    const cacheKey = JSON.stringify({ resource: resource.toString(), configuredClassPath, home, autoDetect });
    const cached = this.runtimeConfiguredCache.get(cacheKey);
    if (cached !== undefined) {
      return cached;
    }

    const configured = Boolean(resolveNetLogoClassPath({ configuredClassPath, home, autoDetect }));
    if (this.runtimeConfiguredCache.size > 16) {
      this.runtimeConfiguredCache.clear();
    }
    this.runtimeConfiguredCache.set(cacheKey, configured);
    return configured;
  }

  private async updateDocument(document: vscode.TextDocument, section: EditableSection, value: string): Promise<void> {
    const current = parseNetLogoModel(document.getText(), document.fileName);
    const next = {
      ...current,
      [section]: value
    };
    const replacement = serializeNetLogoModel(next);

    if (replacement === document.getText()) {
      return;
    }

    const edit = new vscode.WorkspaceEdit();
    edit.replace(document.uri, new vscode.Range(0, 0, document.lineCount, 0), replacement);
    await vscode.workspace.applyEdit(edit);
  }

  private async addWidget(document: vscode.TextDocument, kind: AddableWidgetKind, bounds: WidgetBounds): Promise<void> {
    const current = parseNetLogoModel(document.getText(), document.fileName);
    const interfaceSource = createInterfaceWidget(current.interfaceSource, current.format, kind, bounds);
    if (interfaceSource === current.interfaceSource) {
      return;
    }

    const replacement = serializeNetLogoModel({
      ...current,
      interfaceSource
    });

    const edit = new vscode.WorkspaceEdit();
    edit.replace(document.uri, new vscode.Range(0, 0, document.lineCount, 0), replacement);
    const applied = await vscode.workspace.applyEdit(edit);
    if (applied && kind === "plot") {
      this.runner.invalidate(document.uri);
    }
  }

  private async deleteWidget(document: vscode.TextDocument, widgetId: string): Promise<void> {
    const current = parseNetLogoModel(document.getText(), document.fileName);
    const widget = parseInterfacePreview(current.interfaceSource, current.format).widgets
      .find(candidate => candidate.id === widgetId);
    const interfaceSource = deleteInterfaceWidget(current.interfaceSource, current.format, widgetId);
    if (interfaceSource === current.interfaceSource) {
      return;
    }

    const replacement = serializeNetLogoModel({
      ...current,
      interfaceSource
    });

    const edit = new vscode.WorkspaceEdit();
    edit.replace(document.uri, new vscode.Range(0, 0, document.lineCount, 0), replacement);
    const applied = await vscode.workspace.applyEdit(edit);
    if (applied && widget?.kind === "plot") {
      this.runner.invalidate(document.uri);
    }
  }

  private async updateWidgetProperties(
    document: vscode.TextDocument,
    widgetId: string,
    updates: WidgetPropertyUpdates
  ): Promise<void> {
    const current = parseNetLogoModel(document.getText(), document.fileName);
    const widget = parseInterfacePreview(current.interfaceSource, current.format).widgets
      .find(candidate => candidate.id === widgetId);
    const interfaceSource = updateInterfaceWidgetProperties(current.interfaceSource, current.format, widgetId, updates);
    if (interfaceSource === current.interfaceSource) {
      return;
    }

    const replacement = serializeNetLogoModel({
      ...current,
      interfaceSource
    });

    const edit = new vscode.WorkspaceEdit();
    edit.replace(document.uri, new vscode.Range(0, 0, document.lineCount, 0), replacement);
    const applied = await vscode.workspace.applyEdit(edit);
    if (applied && widget?.kind === "plot") {
      this.runner.invalidate(document.uri);
    }
  }

  private async updateWidgetBounds(document: vscode.TextDocument, widgetId: string, bounds: WidgetBounds): Promise<void> {
    const current = parseNetLogoModel(document.getText(), document.fileName);
    const interfaceSource = updateInterfaceWidgetBounds(current.interfaceSource, current.format, widgetId, bounds);
    if (interfaceSource === current.interfaceSource) {
      return;
    }

    const replacement = serializeNetLogoModel({
      ...current,
      interfaceSource
    });

    const edit = new vscode.WorkspaceEdit();
    edit.replace(document.uri, new vscode.Range(0, 0, document.lineCount, 0), replacement);
    await vscode.workspace.applyEdit(edit);
  }

  private getHtml(webview: vscode.Webview): string {
    const nonce = getNonce();
    const threeUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, "resources", "vendor", "three", "three.module.min.js"));

    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: ${webview.cspSource}; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}' ${webview.cspSource};">
  <title>NetLogo Model Editor</title>
  <style>
    :root {
      color-scheme: light dark;
    }

    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      height: 100vh;
      overflow: hidden;
      color: var(--vscode-editor-foreground);
      background: var(--vscode-editor-background);
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
    }

    .shell {
      display: grid;
      grid-template-rows: auto auto auto 1fr;
      height: 100vh;
      min-height: 0;
    }

    .topbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      min-height: 42px;
      height: 42px;
      max-height: 42px;
      padding: 6px 12px;
      border-bottom: 1px solid var(--vscode-panel-border);
      background: var(--vscode-sideBar-background);
    }

    .identity {
      display: flex;
      align-items: center;
      gap: 10px;
      min-width: 0;
    }

    .mark {
      display: grid;
      place-items: center;
      width: 24px;
      height: 24px;
      border-radius: 4px;
      color: var(--vscode-badge-foreground);
      background: var(--vscode-badge-background);
      font-weight: 700;
      flex: none;
    }

    .filename {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-weight: 600;
    }

    .actions {
      display: flex;
      align-items: center;
      gap: 6px;
      flex: none;
      height: 28px;
    }

    .actions button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      height: 28px;
      min-height: 28px;
      max-height: 28px;
      padding-top: 0;
      padding-bottom: 0;
      margin: 0;
      line-height: 16px;
      flex: none;
      appearance: none;
    }

    .run-controls {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      height: 28px;
      flex: none;
    }

    .speed-control {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 2px;
      min-width: 112px;
      color: var(--vscode-descriptionForeground);
      font-size: 11px;
      line-height: 1.1;
      user-select: none;
    }

    .speed-label {
      min-height: 12px;
      color: var(--vscode-foreground);
      font-size: 11px;
      font-weight: 600;
      text-align: center;
      white-space: nowrap;
    }

    .speed-slider-wrap {
      position: relative;
      display: flex;
      align-items: center;
      width: 96px;
    }

    .speed-normal-mark {
      position: absolute;
      left: 50%;
      top: 50%;
      width: 1px;
      height: 11px;
      background: var(--vscode-descriptionForeground);
      opacity: 0.85;
      transform: translate(-50%, -50%);
      pointer-events: none;
    }

    .speed-control input {
      position: relative;
      z-index: 1;
      width: 96px;
      min-width: 0;
    }

    .tick-counter {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 5px;
      height: 28px;
      min-height: 28px;
      max-height: 28px;
      padding: 0 8px;
      border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
      border-radius: 4px;
      color: var(--vscode-descriptionForeground);
      background: var(--vscode-editorWidget-background);
      font-size: 11px;
      line-height: 16px;
      white-space: nowrap;
    }

    .tick-counter > * {
      display: inline-flex;
      align-items: center;
      height: 16px;
      line-height: 16px;
    }

    .tick-counter strong {
      color: var(--vscode-editor-foreground);
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 12px;
      font-weight: 600;
      font-variant-numeric: tabular-nums;
    }

    button {
      min-height: 28px;
      padding: 4px 10px;
      border: 1px solid var(--vscode-button-border, transparent);
      border-radius: 4px;
      color: var(--vscode-button-foreground);
      background: var(--vscode-button-background);
      font: inherit;
      cursor: pointer;
    }

    button:hover {
      background: var(--vscode-button-hoverBackground);
    }

    #foreverButton {
      width: 68px;
      min-width: 68px;
      max-width: 68px;
      align-self: center;
      text-align: center;
    }

    .tabs {
      display: flex;
      gap: 1px;
      padding: 0 12px;
      border-bottom: 1px solid var(--vscode-panel-border);
      background: var(--vscode-editorGroupHeader-tabsBackground);
    }

    .tab {
      min-width: 96px;
      color: var(--vscode-tab-inactiveForeground);
      background: var(--vscode-tab-inactiveBackground);
      border: 0;
      border-radius: 0;
      border-top: 2px solid transparent;
    }

    .tab[aria-selected="true"] {
      color: var(--vscode-tab-activeForeground);
      background: var(--vscode-tab-activeBackground);
      border-top-color: var(--vscode-focusBorder);
    }

    .content {
      display: grid;
      grid-template-rows: minmax(0, 1fr);
      height: var(--content-height, calc(100vh - 108px));
      min-height: 0;
      overflow: hidden;
    }

    .pane {
      display: none;
      height: var(--content-height, calc(100vh - 108px));
      min-height: 0;
      overflow: hidden;
    }

    .pane.active {
      display: grid;
      grid-template-rows: minmax(0, 1fr);
    }

    textarea {
      display: block;
      width: 100%;
      height: 100%;
      min-height: 0;
      resize: none;
      padding: 14px 16px;
      border: 0;
      outline: 0;
      color: var(--vscode-editor-foreground, #d4d4d4);
      background: var(--vscode-editor-background, #1e1e1e);
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: var(--vscode-editor-font-size);
      line-height: 1.45;
      tab-size: 2;
    }

    .highlight-editor {
      display: block;
      width: 100%;
      margin: 0;
      padding: 14px 16px;
      border: 0;
      outline: 0;
      overflow: auto;
      color: var(--vscode-editor-foreground, #d4d4d4);
      background: var(--vscode-editor-background, #1e1e1e);
      caret-color: var(--vscode-editor-foreground, #d4d4d4);
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: var(--vscode-editor-font-size);
      line-height: 1.45;
      tab-size: 2;
    }

    .highlight-editor:focus {
      outline: 1px solid var(--vscode-focusBorder, transparent);
      outline-offset: -1px;
    }

    .source-buffer {
      position: absolute;
      width: 1px !important;
      height: 1px !important;
      min-height: 0 !important;
      opacity: 0;
      pointer-events: none;
    }

    .code-editor {
      --code-gutter-width: 48px;
      position: relative;
      display: grid;
      grid-template-rows: minmax(0, 1fr);
      height: var(--content-height, calc(100vh - 108px));
      min-height: 0;
      background: var(--vscode-editor-background);
      overflow: hidden;
    }

    .code-line-numbers {
      position: absolute;
      inset: 0 auto 0 0;
      width: var(--code-gutter-width);
      height: 100%;
      margin: 0;
      padding: 14px 10px 14px 6px;
      border: 0;
      border-right: 1px solid var(--vscode-editorLineNumber-border, var(--vscode-panel-border));
      overflow: hidden;
      color: var(--vscode-editorLineNumber-foreground);
      background: var(--vscode-editor-background);
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: var(--vscode-editor-font-size);
      line-height: 1.45;
      text-align: right;
      white-space: pre;
      user-select: none;
      pointer-events: none;
      z-index: 1;
    }

    .code-highlight {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      margin: 0;
      padding: 14px 16px 14px calc(var(--code-gutter-width) + 16px);
      border: 0;
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: var(--vscode-editor-font-size);
      line-height: 1.45;
      tab-size: 2;
      white-space: pre;
      display: none;
      overflow: hidden;
      color: var(--vscode-editor-foreground, #d4d4d4);
      pointer-events: none;
    }

    #codeInput {
      z-index: -1;
    }

    #codeEditorSurface {
      height: var(--content-height, calc(100vh - 108px));
      min-height: var(--content-height, 240px);
      padding-left: calc(var(--code-gutter-width) + 16px);
      white-space: pre;
    }

    #codeEditorSurface::selection,
    #infoEditorSurface::selection {
      background: var(--vscode-editor-selectionBackground);
    }

    .nl-comment {
      color: var(--vscode-editorLineNumber-foreground);
      font-style: italic;
    }

    .nl-keyword {
      color: var(--vscode-symbolIcon-keywordForeground, var(--vscode-charts-purple));
      font-weight: 600;
    }

    .nl-primitive {
      color: var(--vscode-symbolIcon-functionForeground, var(--vscode-charts-blue));
    }

    .nl-string {
      color: var(--vscode-symbolIcon-stringForeground, var(--vscode-charts-green));
    }

    .nl-number {
      color: var(--vscode-symbolIcon-numberForeground, var(--vscode-charts-orange));
    }

    .nl-symbol {
      color: var(--vscode-descriptionForeground);
    }

    .md-marker {
      color: var(--vscode-descriptionForeground);
      font-weight: 600;
    }

    .md-heading {
      color: var(--vscode-symbolIcon-classForeground, var(--vscode-charts-blue));
      font-weight: 700;
    }

    .md-code {
      color: var(--vscode-symbolIcon-stringForeground, var(--vscode-charts-green));
    }

    .md-strong {
      font-weight: 700;
    }

    .md-emphasis {
      font-style: italic;
    }

    .md-link {
      color: var(--vscode-textLink-foreground);
      text-decoration: underline;
    }

    .info-shell {
      display: grid;
      grid-template-rows: auto minmax(0, 1fr);
      height: var(--content-height, calc(100vh - 108px));
      min-height: 0;
    }

    .info-toolbar {
      display: flex;
      justify-content: flex-end;
      gap: 6px;
      min-height: 38px;
      padding: 5px 8px;
      border-bottom: 1px solid var(--vscode-panel-border);
      background: var(--vscode-sideBar-background);
    }

    .info-preview {
      overflow: auto;
      height: var(--info-editor-height, calc(100vh - 146px));
      min-height: var(--info-editor-height, 220px);
      padding: 18px 22px 32px;
      color: var(--vscode-editor-foreground);
      background: var(--vscode-editor-background);
      font-family: var(--vscode-font-family);
      line-height: 1.55;
      cursor: text;
    }

    .info-preview.hidden,
    #infoInput.hidden {
      display: none;
    }

    #infoInput {
      grid-row: 2;
    }

    #infoEditorSurface {
      grid-row: 2;
      height: var(--info-editor-height, calc(100vh - 146px));
      min-height: var(--info-editor-height, 220px);
      white-space: pre-wrap;
      word-break: normal;
      overflow-wrap: normal;
    }

    #infoEditorSurface.hidden {
      display: none;
    }

    .info-preview {
      grid-row: 2;
    }

    .info-preview h1,
    .info-preview h2,
    .info-preview h3 {
      margin: 1em 0 0.45em;
      line-height: 1.2;
    }

    .info-preview h1 {
      padding-bottom: 0.25em;
      border-bottom: 1px solid var(--vscode-panel-border);
      font-size: 1.55em;
    }

    .info-preview h2 {
      font-size: 1.25em;
    }

    .info-preview h3 {
      font-size: 1.08em;
    }

    .info-preview p,
    .info-preview ul,
    .info-preview ol,
    .info-preview pre,
    .info-preview blockquote {
      margin: 0.7em 0;
    }

    .info-preview ul,
    .info-preview ol {
      padding-left: 1.6em;
    }

    .info-preview code {
      padding: 0.1em 0.3em;
      border-radius: 3px;
      background: var(--vscode-textCodeBlock-background, var(--vscode-editorWidget-background));
      font-family: var(--vscode-editor-font-family, monospace);
    }

    .info-preview pre {
      overflow: auto;
      padding: 10px 12px;
      border-radius: 4px;
      background: var(--vscode-textCodeBlock-background, var(--vscode-editorWidget-background));
    }

    .info-preview pre code {
      padding: 0;
      background: transparent;
    }

    .info-preview blockquote {
      padding-left: 12px;
      border-left: 3px solid var(--vscode-panel-border);
      color: var(--vscode-descriptionForeground);
    }

    .info-preview a {
      color: var(--vscode-textLink-foreground);
      text-decoration: none;
    }

    .interface-layout {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 292px;
      height: 100%;
      min-height: 0;
    }

    .interface-main {
      display: grid;
      grid-template-rows: auto minmax(0, 1fr);
      min-width: 0;
      min-height: 0;
    }

    .interface-toolbar {
      display: flex;
      align-items: center;
      gap: 6px;
      min-height: 38px;
      padding: 5px 8px;
      border-bottom: 1px solid var(--vscode-panel-border);
      background: var(--vscode-sideBar-background);
    }

    .toolbar-spacer {
      flex: 1;
      min-width: 0;
    }

    select {
      min-height: 28px;
      border: 1px solid var(--vscode-dropdown-border, var(--vscode-input-border, var(--vscode-panel-border)));
      border-radius: 3px;
      color: var(--vscode-dropdown-foreground);
      background: var(--vscode-dropdown-background);
      font: inherit;
    }

    button:disabled {
      opacity: 0.55;
      cursor: default;
    }

    button.running {
      color: var(--vscode-button-foreground);
      background: var(--vscode-statusBarItem-errorBackground, var(--vscode-button-background));
    }

    .surface-scroller {
      min-height: 0;
      overflow: auto;
      background: var(--vscode-editor-background);
    }

    #interfaceInput {
      display: none;
    }

    .surface {
      position: relative;
      width: 820px;
      height: 560px;
      margin: 16px;
      border: 1px solid var(--vscode-panel-border);
      background:
        linear-gradient(var(--vscode-editorWidget-background), var(--vscode-editorWidget-background)) padding-box,
        var(--vscode-editor-background);
    }

    .surface,
    .widget,
    .drag-proxy {
      touch-action: none;
      -webkit-user-drag: none;
    }

    .widget {
      position: absolute;
      overflow: hidden;
      min-width: 38px;
      min-height: 22px;
      padding: 5px 7px;
      border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
      border-radius: 4px;
      color: var(--vscode-editor-foreground);
      background: var(--vscode-input-background);
      box-shadow: 0 1px 0 rgba(0, 0, 0, 0.12);
      user-select: none;
      cursor: move;
    }

    .widget.selected {
      outline: 2px solid var(--vscode-focusBorder);
      outline-offset: 1px;
      z-index: 2;
    }

    .widget.dragging {
      will-change: transform;
      z-index: 3;
    }

    .widget.drag-source {
      opacity: 0.58;
    }

    .drag-proxy {
      position: absolute;
      pointer-events: none;
      box-sizing: border-box;
      border: 2px solid var(--vscode-focusBorder);
      border-radius: 4px;
      background: color-mix(in srgb, var(--vscode-focusBorder) 18%, transparent);
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.22);
      will-change: transform;
      z-index: 4;
    }

    .resize-handle {
      position: absolute;
      right: -1px;
      bottom: -1px;
      width: 12px;
      height: 12px;
      border-left: 1px solid var(--vscode-focusBorder);
      border-top: 1px solid var(--vscode-focusBorder);
      background: var(--vscode-editor-background);
      cursor: nwse-resize;
      display: none;
    }

    .widget.selected .resize-handle {
      display: block;
    }

    .widget.button-widget {
      display: grid;
      place-items: center;
      padding: 0;
      color: var(--vscode-button-foreground);
      background: var(--vscode-button-background);
    }

    .widget.button-widget:hover {
      background: var(--vscode-button-hoverBackground);
    }

    .widget.button-widget.running {
      outline: 2px solid var(--vscode-focusBorder);
      outline-offset: 1px;
    }

    .widget.view-widget {
      display: grid;
      grid-template-rows: auto 1fr auto;
      padding: 0;
      background: var(--vscode-editor-background);
    }

    .view-title,
    .plot-title,
    .output-title {
      padding: 4px 7px;
      border-bottom: 1px solid var(--vscode-panel-border);
      color: var(--vscode-descriptionForeground);
      font-size: 11px;
      text-transform: uppercase;
    }

    .view-grid {
      background-image:
        linear-gradient(to right, color-mix(in srgb, var(--vscode-editor-foreground) 10%, transparent) 1px, transparent 1px),
        linear-gradient(to bottom, color-mix(in srgb, var(--vscode-editor-foreground) 10%, transparent) 1px, transparent 1px);
      background-size: 18px 18px;
      background-color: var(--vscode-editorWidget-background);
    }

    .view-image {
      width: 100%;
      height: 100%;
      min-height: 0;
      object-fit: contain;
      background: var(--vscode-editorWidget-background);
    }

    .three-view {
      position: relative;
      min-width: 0;
      min-height: 0;
      overflow: hidden;
      background: #000;
      touch-action: none;
    }

    .three-view canvas {
      display: block;
      width: 100%;
      height: 100%;
    }

    .three-view:fullscreen,
    .three-view.fullscreen-fallback {
      width: 100vw;
      height: 100vh;
      background: #000;
    }

    .three-view.fullscreen-fallback {
      position: fixed;
      inset: 0;
      z-index: 1000;
    }

    .three-status {
      position: absolute;
      left: 8px;
      bottom: 8px;
      padding: 2px 5px;
      border-radius: 3px;
      color: rgba(255, 255, 255, 0.78);
      background: rgba(0, 0, 0, 0.42);
      font-size: 10px;
      pointer-events: none;
    }

    .three-inspector {
      position: absolute;
      left: 8px;
      top: 8px;
      max-width: min(260px, calc(100% - 16px));
      padding: 7px 8px;
      border: 1px solid rgba(127, 127, 127, 0.34);
      border-radius: 4px;
      color: rgba(255, 255, 255, 0.88);
      background: rgba(0, 0, 0, 0.58);
      font-size: 11px;
      line-height: 1.35;
      pointer-events: none;
    }

    .three-inspector-title {
      margin-bottom: 5px;
      font-weight: 700;
    }

    .three-inspector-row {
      display: grid;
      grid-template-columns: max-content minmax(0, 1fr);
      gap: 8px;
    }

    .three-inspector-key {
      color: rgba(255, 255, 255, 0.62);
    }

    .three-inspector-value {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .three-controls {
      position: absolute;
      top: 8px;
      right: 8px;
      display: flex;
      flex-wrap: wrap;
      justify-content: flex-end;
      gap: 4px;
      max-width: calc(100% - 16px);
      padding: 3px;
      border: 1px solid rgba(127, 127, 127, 0.32);
      border-radius: 4px;
      background: rgba(0, 0, 0, 0.34);
    }

    .three-control-button {
      min-width: 28px;
      height: 24px;
      padding: 0 7px;
      border-radius: 3px;
      border: 1px solid rgba(127, 127, 127, 0.34);
      color: #f1f1f1;
      background: rgba(255, 255, 255, 0.12);
      font-size: 11px;
      line-height: 1;
      cursor: pointer;
    }

    .three-control-button:hover {
      background: rgba(255, 255, 255, 0.22);
    }

    .three-control-button.active {
      color: #111;
      background: #f1f1f1;
    }

    .view-footer {
      padding: 3px 7px;
      border-top: 1px solid var(--vscode-panel-border);
      color: var(--vscode-descriptionForeground);
      font-size: 11px;
    }

    .slider-widget,
    .chooser-widget,
    .input-widget,
    .monitor-widget,
    .switch-widget {
      display: grid;
      gap: 3px;
    }

    .monitor-widget {
      grid-template-rows: auto minmax(0, 1fr);
      gap: 2px;
      padding: 3px 6px;
    }

    .monitor-heading {
      overflow: hidden;
      color: var(--vscode-editor-foreground);
      font-size: 11px;
      font-weight: 600;
      line-height: 1.1;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .slider-widget {
      grid-template-rows: minmax(12px, auto) minmax(13px, 1fr);
      padding: 3px 6px;
    }

    .slider-row,
    .switch-row,
    .chooser-row {
      display: flex;
      align-items: center;
      gap: 7px;
      min-width: 0;
    }

    .slider-row {
      display: grid;
      grid-template-columns: minmax(0, 1fr) max-content;
    }

    .fake-track {
      position: relative;
      height: 5px;
      border-radius: 999px;
      background: var(--vscode-scrollbarSlider-background);
      flex: 1;
    }

    .fake-thumb {
      position: absolute;
      top: -4px;
      width: 13px;
      height: 13px;
      border-radius: 50%;
      background: var(--vscode-focusBorder);
    }

    .fake-switch {
      width: 32px;
      height: 16px;
      padding: 2px;
      border-radius: 999px;
      background: var(--vscode-scrollbarSlider-background);
      flex: none;
    }

    .fake-switch.on {
      background: var(--vscode-button-background);
    }

    .fake-switch::after {
      content: "";
      display: block;
      width: 12px;
      height: 12px;
      border-radius: 50%;
      background: var(--vscode-editor-background);
    }

    .fake-switch.on::after {
      transform: translateX(16px);
    }

    .fake-select,
    .fake-input,
    .monitor-value {
      min-height: 24px;
      padding: 3px 6px;
      border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
      border-radius: 3px;
      background: var(--vscode-editor-background);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .runtime-slider {
      width: 100%;
      min-width: 0;
      height: 14px;
    }

    .runtime-checkbox {
      flex: none;
    }

    .runtime-select {
      width: 100%;
      min-width: 0;
      min-height: 24px;
      font-size: 12px;
    }

    .monitor-value {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      min-height: 0;
      text-align: right;
      font-family: var(--vscode-editor-font-family, monospace);
    }

    .plot-widget {
      display: grid;
      grid-template-rows: auto 1fr auto;
      padding: 0;
    }

    .plot-body {
      position: relative;
      margin: 8px;
      background-image:
        linear-gradient(to right, color-mix(in srgb, var(--vscode-editor-foreground) 8%, transparent) 1px, transparent 1px),
        linear-gradient(to bottom, color-mix(in srgb, var(--vscode-editor-foreground) 8%, transparent) 1px, transparent 1px);
      background-size: 24px 18px;
    }

    .plot-svg {
      width: 100%;
      height: 100%;
      display: block;
    }

    .plot-axis,
    .plot-tick {
      stroke: var(--vscode-descriptionForeground);
      stroke-width: 1;
      vector-effect: non-scaling-stroke;
    }

    .plot-grid-line {
      stroke: color-mix(in srgb, var(--vscode-editor-foreground) 18%, transparent);
      stroke-width: 1;
      vector-effect: non-scaling-stroke;
    }

    .plot-tick-label,
    .plot-axis-label,
    .plot-no-data {
      fill: var(--vscode-descriptionForeground);
      font-family: var(--vscode-font-family);
      font-size: 8px;
    }

    .plot-axis-label {
      font-size: 9px;
    }

    .plot-no-data {
      text-anchor: middle;
    }

    .plot-legend-label {
      fill: var(--vscode-editor-foreground);
      font-family: var(--vscode-font-family);
      font-size: 7px;
    }

    .plot-legend-swatch {
      stroke: color-mix(in srgb, var(--vscode-editor-foreground) 30%, transparent);
      stroke-width: 0.5;
    }

    .plot-empty {
      display: grid;
      place-items: center;
      height: 100%;
      color: var(--vscode-descriptionForeground);
      font-size: 11px;
    }

    .plot-footer {
      display: flex;
      justify-content: space-between;
      gap: 8px;
      padding: 0 8px 6px;
      color: var(--vscode-descriptionForeground);
      font-size: 11px;
    }

    .textbox-widget {
      border-color: transparent;
      background: transparent;
      box-shadow: none;
      white-space: pre-wrap;
    }

    .output-widget {
      display: grid;
      grid-template-rows: auto 1fr;
      padding: 0;
      background: var(--vscode-terminal-background, var(--vscode-editor-background));
    }

    .output-body {
      padding: 8px;
      color: var(--vscode-terminal-foreground, var(--vscode-editor-foreground));
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 12px;
    }

    .widget-type {
      display: block;
      color: var(--vscode-descriptionForeground);
      font-size: 11px;
      line-height: 1.2;
      text-transform: uppercase;
    }

    .control-heading {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: var(--vscode-editor-foreground);
      font-size: 11px;
      font-weight: 600;
      line-height: 1.1;
    }

    .control-value {
      min-width: 34px;
      max-width: 100%;
      overflow: visible;
      color: var(--vscode-descriptionForeground);
      font-size: 10px;
      line-height: 1;
      text-align: right;
      white-space: nowrap;
    }

    .widget-label {
      display: block;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      line-height: 1.25;
    }

    .empty {
      display: grid;
      place-items: center;
      height: 100%;
      color: var(--vscode-descriptionForeground);
    }

    .status {
      display: inline-flex;
      align-items: center;
      width: 35ch;
      min-width: 35ch;
      min-height: 28px;
      height: 28px;
      max-height: 28px;
      padding: 4px 8px;
      overflow-x: auto;
      overflow-y: hidden;
      border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
      border-radius: 4px;
      color: var(--vscode-descriptionForeground);
      background: var(--vscode-editorWidget-background);
      font-size: 11px;
      scrollbar-width: thin;
      text-align: left;
      white-space: nowrap;
    }

    .status::-webkit-scrollbar {
      height: 4px;
    }

    .runtime-banner {
      display: flex;
      align-items: center;
      gap: 8px;
      min-height: 34px;
      padding: 6px 12px;
      border-bottom: 1px solid rgba(86, 62, 24, 0.7);
      color: #241a0a;
      background: #e6c07a;
      font-weight: 600;
    }

    #runtimeBannerText {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .runtime-banner.hidden {
      display: none;
    }

    .runtime-banner button {
      min-height: 24px;
      padding: 2px 8px;
    }

    .mode-toggle {
      display: inline-flex;
      overflow: hidden;
      border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
      border-radius: 4px;
    }

    .mode-toggle button {
      min-height: 26px;
      border: 0;
      border-radius: 0;
      color: var(--vscode-button-secondaryForeground, var(--vscode-editor-foreground));
      background: var(--vscode-button-secondaryBackground, var(--vscode-editorWidget-background));
    }

    .mode-toggle button.active {
      color: var(--vscode-button-foreground);
      background: var(--vscode-button-background);
    }

    .surface.interact-mode .widget {
      cursor: default;
    }

    .surface.interact-mode .widget.button-widget {
      cursor: pointer;
    }

    .surface.interact-mode .resize-handle {
      display: none;
    }

    .surface.layout-mode .widget {
      cursor: move;
    }

    .properties-panel {
      min-height: 0;
      overflow: auto;
      padding: 12px;
      border-left: 1px solid var(--vscode-panel-border);
      background: var(--vscode-sideBar-background);
    }

    .properties-title {
      margin: 0 0 10px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: 13px;
      font-weight: 600;
    }

    .property-group {
      display: grid;
      gap: 8px;
      margin-bottom: 14px;
    }

    .property-row {
      display: grid;
      gap: 4px;
    }

    .bounds-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 8px;
    }

    .property-label {
      color: var(--vscode-descriptionForeground);
      font-size: 11px;
    }

    .property-input,
    .property-textarea {
      width: 100%;
      min-width: 0;
      border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
      border-radius: 3px;
      color: var(--vscode-input-foreground);
      background: var(--vscode-input-background);
      font: inherit;
    }

    .property-input {
      min-height: 26px;
      padding: 3px 6px;
    }

    .property-textarea {
      min-height: 58px;
      resize: vertical;
      padding: 5px 6px;
      font-family: var(--vscode-editor-font-family, monospace);
      line-height: 1.35;
    }

    .property-check {
      display: flex;
      align-items: center;
      gap: 8px;
      min-height: 26px;
    }

    .plot-pens-editor {
      display: grid;
      gap: 8px;
      margin-bottom: 14px;
    }

    .plot-pens-heading {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }

    .plot-pens-heading h3 {
      margin: 0;
      font-size: 12px;
    }

    .plot-pen-card {
      display: grid;
      gap: 7px;
      padding: 8px;
      border: 1px solid var(--vscode-panel-border);
      border-radius: 4px;
      background: var(--vscode-editorWidget-background);
    }

    .plot-pen-card-header {
      display: grid;
      grid-template-columns: 18px minmax(0, 1fr) auto;
      align-items: center;
      gap: 6px;
    }

    .plot-pen-swatch {
      width: 18px;
      height: 18px;
      border: 1px solid var(--vscode-panel-border);
      border-radius: 3px;
    }

    .plot-pen-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 7px;
    }

    .plot-pen-select {
      width: 100%;
      min-width: 0;
      min-height: 26px;
    }

    .plot-pen-delete {
      min-height: 24px;
      padding: 2px 7px;
      color: var(--vscode-button-foreground);
      background: var(--vscode-statusBarItem-errorBackground, var(--vscode-button-background));
    }

    .no-selection {
      color: var(--vscode-descriptionForeground);
    }
  </style>
</head>
<body>
  <main class="shell">
    <header class="topbar">
      <div class="identity">
        <div class="mark">NL</div>
        <div id="fileName" class="filename">NetLogo</div>
      </div>
      <div class="actions">
        <span id="status" class="status">Ready</span>
        <button id="commandButton" type="button" title="Run NetLogo command">Command...</button>
        <button id="openNativeButton" type="button" title="Open in native NetLogo">Open in NetLogo</button>
        <label class="speed-control" title="Forever speed">
          <span id="speedLabel" class="speed-label">normal speed</span>
          <span class="speed-slider-wrap">
            <span class="speed-normal-mark" aria-hidden="true"></span>
            <input id="speedSlider" type="range" min="-110" max="112" step="1" value="0" aria-label="Forever speed">
          </span>
        </label>
        <span class="run-controls">
          <span class="tick-counter" title="NetLogo ticks"><span>ticks</span><strong id="tickCount">-</strong></span>
          <button id="setupButton" type="button">Setup</button>
          <button id="goButton" type="button">Go once</button>
          <button id="foreverButton" type="button">Forever</button>
        </span>
      </div>
    </header>
    <nav class="tabs" role="tablist" aria-label="NetLogo sections">
      <button class="tab" type="button" role="tab" aria-selected="true" data-tab="interface">Interface</button>
      <button class="tab" type="button" role="tab" aria-selected="false" data-tab="info">Info</button>
      <button class="tab" type="button" role="tab" aria-selected="false" data-tab="code">Code</button>
    </nav>
    <div id="runtimeBanner" class="runtime-banner hidden">
      <span id="runtimeBannerText">NetLogo runtime not configured.</span>
      <button id="configureRuntimeButton" type="button">Configure</button>
      <button id="showOutputButton" type="button">Output</button>
    </div>
    <section class="content">
      <section id="interfacePane" class="pane active" role="tabpanel">
        <div class="interface-layout">
          <div class="interface-main">
            <div class="interface-toolbar">
              <div class="mode-toggle" role="group" aria-label="Interface mode">
                <button id="interactModeButton" type="button" class="active">Interact</button>
                <button id="layoutModeButton" type="button">Layout</button>
              </div>
              <select id="addWidgetKind" aria-label="Widget type">
                <option value="button">Button</option>
                <option value="slider">Slider</option>
                <option value="switch">Switch</option>
                <option value="chooser">Chooser</option>
                <option value="monitor">Monitor</option>
                <option value="plot">Plot</option>
                <option value="input">Input</option>
                <option value="textbox">Text</option>
                <option value="output">Output</option>
              </select>
              <button id="addWidgetButton" type="button">Add widget</button>
              <div class="toolbar-spacer"></div>
              <button id="deleteWidgetButton" type="button" hidden disabled>Delete widget</button>
            </div>
            <div class="surface-scroller">
              <div id="surface" class="surface"></div>
            </div>
            <textarea id="interfaceInput" spellcheck="false"></textarea>
          </div>
          <aside id="propertiesPanel" class="properties-panel"></aside>
        </div>
      </section>
      <section id="infoPane" class="pane" role="tabpanel">
        <div class="info-shell">
          <div class="info-toolbar">
            <button id="infoToggleButton" type="button">Edit</button>
          </div>
          <div id="infoPreview" class="info-preview" tabindex="0"></div>
          <pre id="infoEditorSurface" class="highlight-editor markdown-editor hidden" contenteditable="true" role="textbox" aria-multiline="true" spellcheck="true"></pre>
          <textarea id="infoInput" class="source-buffer hidden" spellcheck="true" wrap="soft" aria-hidden="true"></textarea>
        </div>
      </section>
      <section id="codePane" class="pane" role="tabpanel">
        <div class="code-editor">
          <pre id="codeLineNumbers" class="code-line-numbers" aria-hidden="true"></pre>
          <pre id="codeHighlight" class="code-highlight" aria-hidden="true"></pre>
          <pre id="codeEditorSurface" class="highlight-editor netlogo-editor" contenteditable="true" role="textbox" aria-multiline="true" spellcheck="false"></pre>
          <textarea id="codeInput" class="source-buffer" spellcheck="false" wrap="off" aria-hidden="true"></textarea>
        </div>
      </section>
    </section>
  </main>

  <script nonce="${nonce}" type="module">
    import * as THREE from "${threeUri}";
    window.NetLogoThree = THREE;
    window.dispatchEvent(new Event("netlogo-three-ready"));
  </script>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const restoredUiState = vscode.getState?.() ?? {};
    const knownWidgetTypes = new Set([
      "GRAPHICS-WINDOW",
      "BUTTON",
      "SLIDER",
      "SWITCH",
      "CHOOSER",
      "MONITOR",
      "PLOT",
      "INPUTBOX",
      "TEXTBOX",
      "OUTPUT",
      "CC-WINDOW",
      "VIEW"
    ]);
    const netLogoKeywords = new Set([
      "ask",
      "breed",
      "carefully",
      "directed-link-breed",
      "else",
      "end",
      "extensions",
      "foreach",
      "globals",
      "if",
      "ifelse",
      "ifelse-value",
      "let",
      "links-own",
      "loop",
      "of",
      "patches-own",
      "report",
      "repeat",
      "set",
      "stop",
      "to",
      "to-report",
      "turtles-own",
      "undirected-link-breed",
      "while",
      "with"
    ]);
    const netLogoPrimitives = new Set([
      "all?",
      "any?",
      "back",
      "bk",
      "clear-all",
      "clear-patches",
      "clear-plot",
      "clear-ticks",
      "clear-turtles",
      "color",
      "count",
      "create-links-with",
      "create-turtles",
      "die",
      "distance",
      "export-plot",
      "export-view",
      "face",
      "facexy",
      "false",
      "fd",
      "file-close",
      "file-open",
      "file-print",
      "filter",
      "forward",
      "fput",
      "hatch",
      "histogram",
      "item",
      "length",
      "link-neighbors",
      "links",
      "lput",
      "lt",
      "map",
      "max",
      "mean",
      "member?",
      "min",
      "n-of",
      "neighbors",
      "nobody",
      "one-of",
      "patch-here",
      "patches",
      "pen-down",
      "pen-up",
      "plot",
      "plotxy",
      "print",
      "random",
      "random-float",
      "reduce",
      "reset-ticks",
      "rt",
      "set-current-plot",
      "set-current-plot-pen",
      "setxy",
      "show",
      "sort",
      "sprout",
      "sum",
      "tick",
      "tick-advance",
      "true",
      "turtles",
      "who",
      "xcor",
      "ycor"
    ]);
    const netLogoNumberPattern = /^-?(?:\\d+\\.?\\d*|\\.\\d+)(?:e[+-]?\\d+)?$/i;
    // NetLogo 6.4 uses these raw Swing slider bounds, with a dead zone around
    // the center. Outside it, two raw units equal one UpdateManager speed unit.
    const RUN_SPEED_RAW_MIN = -110;
    const RUN_SPEED_RAW_MAX = 112;
    const RUN_SPEED_DEAD_ZONE = 10;
    const RUN_SPEED_DEFAULT_FRAME_RATE = 30;
    const RUN_SPEED_MAX_BATCH = 256;
    const THREE_INSTANCE_CHUNK_SIZE = 60000;

    const state = {
      version: 0,
      hasLoadedModel: false,
      activeTab: validUiTab(restoredUiState.activeTab),
      code: "",
      interfaceSource: "",
      info: "",
      infoEditing: Boolean(restoredUiState.infoEditing),
      interfaceMode: validInterfaceMode(restoredUiState.interfaceMode),
      runSpeed: restoredRunSpeed(restoredUiState.runSpeed),
      ticks: null,
      runtimeConfigured: true,
      runtimeStatus: "not-run",
      interfacePreview: { widgets: [], bounds: { width: 820, height: 560 } },
      selectedWidgetId: null,
      interaction: null,
      pendingInterfaceRender: false,
      runLoop: null,
      runtimeValues: {},
      viewImageDataUri: null,
      view3DState: null,
      threeViewDisposers: [],
      threeTrailState: null,
      threeObserverCameraKey: null,
      threeManualRadius: null,
      threeBackground: restoredThreeBackground(restoredUiState),
      threeInteractionMode: validThreeInteractionMode(restoredUiState.threeInteractionMode),
      threeCamera: sanitizeThreeCamera(restoredUiState.threeCamera),
      plotData: {},
      dirtyPlotWidgets: new Set()
    };

    const inputs = {
      code: document.getElementById("codeInput"),
      interfaceSource: document.getElementById("interfaceInput"),
      info: document.getElementById("infoInput")
    };

    const fileName = document.getElementById("fileName");
    const status = document.getElementById("status");
    const content = document.querySelector(".content");
    const surface = document.getElementById("surface");
    const propertiesPanel = document.getElementById("propertiesPanel");
    const addWidgetKind = document.getElementById("addWidgetKind");
    const addWidgetButton = document.getElementById("addWidgetButton");
    const deleteWidgetButton = document.getElementById("deleteWidgetButton");
    const setupButton = document.getElementById("setupButton");
    const goButton = document.getElementById("goButton");
    const commandButton = document.getElementById("commandButton");
    const openNativeButton = document.getElementById("openNativeButton");
    const foreverButton = document.getElementById("foreverButton");
    const speedLabel = document.getElementById("speedLabel");
    const speedSlider = document.getElementById("speedSlider");
    const tickCount = document.getElementById("tickCount");
    const runtimeBanner = document.getElementById("runtimeBanner");
    const runtimeBannerText = document.getElementById("runtimeBannerText");
    const configureRuntimeButton = document.getElementById("configureRuntimeButton");
    const showOutputButton = document.getElementById("showOutputButton");
    const interactModeButton = document.getElementById("interactModeButton");
    const layoutModeButton = document.getElementById("layoutModeButton");
    const codeEditor = document.querySelector(".code-editor");
    const codeEditorSurface = document.getElementById("codeEditorSurface");
    const codeLineNumbers = document.getElementById("codeLineNumbers");
    const codeHighlight = document.getElementById("codeHighlight");
    const infoShell = document.querySelector(".info-shell");
    const infoToolbar = document.querySelector(".info-toolbar");
    const infoPreview = document.getElementById("infoPreview");
    const infoEditorSurface = document.getElementById("infoEditorSurface");
    const infoToggleButton = document.getElementById("infoToggleButton");
    const timers = new Map();

    window.addEventListener("resize", updateEditorLayout);

    window.addEventListener("netlogo-three-ready", () => {
      renderInterface();
    });

    surface.addEventListener("pointerdown", event => {
      if (event.target === surface) {
        state.selectedWidgetId = null;
        renderInterface();
      }
    });

    document.addEventListener("pointermove", event => {
      if (state.interaction) {
        updatePointerInteraction(event);
      }
    });

    document.addEventListener("pointerup", event => {
      if (state.interaction) {
        finishPointerInteraction(event);
      }
    });

    document.addEventListener("contextmenu", event => {
      if (state.interaction) {
        event.preventDefault();
        event.stopPropagation();
      }
    });

    document.addEventListener("keydown", event => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        vscode.postMessage({ type: "save-document" });
      }
    });

    document.querySelectorAll(".tab").forEach(button => {
      button.addEventListener("click", () => activateTab(button.dataset.tab));
    });

    setupButton.addEventListener("click", () => {
      stopRunLoop();
      postRunCommand("setup", false);
    });

    goButton.addEventListener("click", () => {
      stopRunLoop();
      postRunCommand(toolbarGoCommand(), false);
    });

    commandButton.addEventListener("click", () => {
      stopRunLoop();
      vscode.postMessage({ type: "prompt-command" });
    });

    openNativeButton.addEventListener("click", () => {
      if (openNativeButton.disabled) return;
      setNativeOpening(true);
      vscode.postMessage({ type: "open-native" });
    });

    function setNativeOpening(opening) {
      openNativeButton.disabled = opening;
      openNativeButton.setAttribute("aria-busy", String(opening));
      openNativeButton.title = opening
        ? "Starting NetLogo; native model loading may take a few seconds"
        : "Open in native NetLogo";
    }

    foreverButton.addEventListener("click", () => {
      if (state.runLoop) {
        stopRunLoop();
      } else {
        startRunLoop(toolbarGoCommand(), "go");
      }
    });

    speedSlider.addEventListener("input", () => {
      state.runSpeed = clampRunSpeed(speedSlider.value);
      persistUiState();
      updateSpeedControl();
    });
    speedSlider.addEventListener("change", () => {
      if (Math.abs(state.runSpeed) <= RUN_SPEED_DEAD_ZONE) {
        state.runSpeed = 0;
        persistUiState();
        updateSpeedControl();
      }
    });
    updateSpeedControl();
    renderTickCount();
    setInterfaceMode(state.interfaceMode);
    activateTab(state.activeTab);
    updateEditorLayout();

    configureRuntimeButton.addEventListener("click", () => {
      vscode.postMessage({ type: "configure-runtime" });
    });

    showOutputButton.addEventListener("click", () => {
      vscode.postMessage({ type: "show-output" });
    });

    interactModeButton.addEventListener("click", () => {
      setInterfaceMode("interact");
    });

    layoutModeButton.addEventListener("click", () => {
      setInterfaceMode("layout");
    });

    codeEditorSurface.addEventListener("input", () => {
      syncHighlightedEditor("code", codeEditorSurface, inputs.code);
    });
    codeEditorSurface.addEventListener("keydown", event => {
      handleHighlightedEditorKeyDown(event, codeEditorSurface, inputs.code, "code");
    });
    codeEditorSurface.addEventListener("paste", event => {
      handleHighlightedEditorPaste(event, codeEditorSurface, inputs.code, "code");
    });
    codeEditorSurface.addEventListener("scroll", syncCodeHighlightScroll);

    infoEditorSurface.addEventListener("input", () => {
      syncHighlightedEditor("info", infoEditorSurface, inputs.info);
    });
    infoEditorSurface.addEventListener("keydown", event => {
      handleHighlightedEditorKeyDown(event, infoEditorSurface, inputs.info, "info");
    });
    infoEditorSurface.addEventListener("paste", event => {
      handleHighlightedEditorPaste(event, infoEditorSurface, inputs.info, "info");
    });

    infoToggleButton.addEventListener("click", () => {
      setInfoEditing(!state.infoEditing);
    });

    infoPreview.addEventListener("click", event => {
      event.preventDefault();
      setInfoEditing(true, findInfoSourceOffset(event), infoClickAnchor(event));
    });

    infoPreview.addEventListener("keydown", event => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        setInfoEditing(true);
      }
    });

    addWidgetButton.addEventListener("click", () => {
      const kind = addWidgetKind.value;
      const bounds = nextWidgetBounds(kind);
      setInterfaceMode("layout");
      setStatus("Adding widget");
      vscode.postMessage({ type: "add-widget", kind, bounds });
    });

    deleteWidgetButton.addEventListener("click", () => {
      const widget = findWidget(state.selectedWidgetId);
      if (!widget) {
        return;
      }

      setStatus("Deleting widget");
      vscode.postMessage({ type: "delete-widget", widgetId: widget.id });
      state.selectedWidgetId = null;
      state.interfacePreview.widgets = (state.interfacePreview.widgets ?? []).filter(candidate => candidate.id !== widget.id);
      updateSurfaceBounds();
      renderInterface();
    });

    for (const [section, input] of Object.entries(inputs)) {
      input.addEventListener("input", () => {
        state[section] = input.value;
        if (section === "interfaceSource") {
          state.interfacePreview = { widgets: [], bounds: { width: 820, height: 560 } };
          renderInterface();
        }
        if (section === "info") {
          renderInfo();
        }
        if (section === "code") {
          renderCodeHighlight();
          syncCodeHighlightScroll();
        }
        queueUpdate(section, input.value);
      });
    }

    window.addEventListener("message", event => {
      const message = event.data;
      if (message?.type === "native-opening") {
        setNativeOpening(message.opening);
        return;
      }
      if (!message || message.type !== "model") {
        if (message?.type === "runtime-result") {
          applyRuntimeResult(message.result);
        } else if (message?.type === "runtime-error") {
          applyRuntimeError(message.message);
        }
        return;
      }

      const firstModelLoad = !state.hasLoadedModel;
      const codeEditorActive = document.activeElement === codeEditorSurface;
      const infoEditorActive = document.activeElement === infoEditorSurface;
      const sourceEditorActive = codeEditorActive || infoEditorActive;
      const nextCode = message.code ?? "";
      const nextInfo = message.info ?? "";

      state.version = message.version;
      state.hasLoadedModel = true;
      if (firstModelLoad || !codeEditorActive || nextCode === state.code) {
        state.code = nextCode;
      }
      state.interfaceSource = message.interfaceSource ?? "";
      if (firstModelLoad || !infoEditorActive || nextInfo === state.info) {
        state.info = nextInfo;
      }
      state.interfacePreview = message.interfacePreview ?? { widgets: [], bounds: { width: 820, height: 560 } };
      state.runtimeConfigured = message.runtimeConfigured !== false;
      if (state.selectedWidgetId && !findWidget(state.selectedWidgetId)) {
        state.selectedWidgetId = null;
      }

      fileName.textContent = message.fileName ?? "NetLogo";
      if (firstModelLoad || !codeEditorActive) {
        setInputValue(inputs.code, state.code);
      }
      setInputValue(inputs.interfaceSource, state.interfaceSource);
      if (firstModelLoad || !infoEditorActive) {
        setInputValue(inputs.info, state.info);
      }
      if (firstModelLoad || !codeEditorActive) {
        renderCodeHighlight();
      }
      if (firstModelLoad || !infoEditorActive) {
        renderInfo();
      }
      if (firstModelLoad || !sourceEditorActive) {
        updateEditorLayout();
      }
      setStatus(state.runLoop ? "Running " + state.runLoop.label : message.format === "xml" ? "XML model" : "Classic model");
      updateRuntimeBanner();
      updateRunControls();
      if (firstModelLoad || !sourceEditorActive) {
        renderInterface();
      }
    });

    vscode.postMessage({ type: "ready" });

    function persistUiState() {
      vscode.setState?.({
        activeTab: state.activeTab,
        infoEditing: state.infoEditing,
        interfaceMode: state.interfaceMode,
        runSpeed: state.runSpeed,
        runSpeedScaleVersion: 2,
        threeBackground: state.threeBackground,
        threeBackgroundPreferenceVersion: 1,
        threeInteractionMode: state.threeInteractionMode,
        threeCamera: sanitizeThreeCamera(state.threeCamera)
      });
    }

    function validUiTab(tab) {
      return ["interface", "info", "code"].includes(tab) ? tab : "interface";
    }

    function validInterfaceMode(mode) {
      return mode === "layout" ? "layout" : "interact";
    }

    function restoredThreeBackground(restored) {
      return restored.threeBackgroundPreferenceVersion === 1 && restored.threeBackground === "light" ? "light" : "dark";
    }

    function validThreeInteractionMode(mode) {
      return ["orbit", "zoom", "move"].includes(mode) ? mode : "orbit";
    }

    function restoredRunSpeed(value) {
      const number = Number(value);
      if (!Number.isFinite(number)) {
        return 0;
      }
      if (restoredUiState.runSpeedScaleVersion === 2) {
        return clampRunSpeed(number);
      }
      // Before scale version 2 the webview stored -10..10. Preserve the old
      // thumb's relative distance from normal when migrating to NetLogo's raw
      // -110..112 scale.
      return clampRunSpeed(number < 0 ? number * 10 - 10 : number > 0 ? number * 10 + 10 : 0);
    }

    function clampRunSpeed(value) {
      return clampNumber(Math.round(Number(value)), RUN_SPEED_RAW_MIN, RUN_SPEED_RAW_MAX);
    }

    function sanitizeThreeCamera(camera) {
      if (!camera || typeof camera !== "object") {
        return null;
      }
      const next = {};
      for (const key of ["theta", "phi", "radius", "targetX", "targetY", "targetZ"]) {
        const value = Number(camera[key]);
        if (!Number.isFinite(value)) {
          return null;
        }
        next[key] = value;
      }
      return next;
    }

    function setStatus(message) {
      status.textContent = message;
      status.title = message;
    }

    function updateEditorLayout() {
      const contentTop = content?.getBoundingClientRect().top ?? 108;
      const contentHeight = Math.max(180, Math.floor(window.innerHeight - contentTop));
      const infoToolbarHeight = infoToolbar?.getBoundingClientRect().height ?? 38;
      const infoEditorHeight = Math.max(140, contentHeight - infoToolbarHeight);

      document.documentElement.style.setProperty("--content-height", contentHeight + "px");
      document.documentElement.style.setProperty("--info-editor-height", infoEditorHeight + "px");

      if (content) {
        content.style.height = contentHeight + "px";
      }
      if (codeEditor) {
        codeEditor.style.height = contentHeight + "px";
      }
      if (codeEditorSurface) {
        codeEditorSurface.style.height = contentHeight + "px";
        codeEditorSurface.style.minHeight = contentHeight + "px";
      }
      if (infoShell) {
        infoShell.style.height = contentHeight + "px";
      }
      if (infoPreview) {
        infoPreview.style.height = infoEditorHeight + "px";
        infoPreview.style.minHeight = infoEditorHeight + "px";
      }
      if (infoEditorSurface) {
        infoEditorSurface.style.height = infoEditorHeight + "px";
        infoEditorSurface.style.minHeight = infoEditorHeight + "px";
      }
    }

    function updateRuntimeBanner(message) {
      const text = message || (state.runtimeStatus === "reload-needed"
        ? "Plot definition changed. Run Setup to reload the model workspace."
        : state.runtimeConfigured ? "" : "NetLogo runtime not configured.");
      runtimeBanner.classList.toggle("hidden", !text);
      runtimeBannerText.textContent = text;
      configureRuntimeButton.hidden = state.runtimeStatus !== "not-configured";
      showOutputButton.hidden = !text;
    }

    function setInterfaceMode(mode) {
      state.interfaceMode = mode === "layout" ? "layout" : "interact";
      if (state.interfaceMode === "interact") {
        state.selectedWidgetId = null;
      }
      interactModeButton.classList.toggle("active", state.interfaceMode === "interact");
      layoutModeButton.classList.toggle("active", state.interfaceMode === "layout");
      interactModeButton.setAttribute("aria-pressed", String(state.interfaceMode === "interact"));
      layoutModeButton.setAttribute("aria-pressed", String(state.interfaceMode === "layout"));
      addWidgetButton.disabled = state.interfaceMode !== "layout";
      deleteWidgetButton.hidden = state.interfaceMode !== "layout";
      deleteWidgetButton.disabled = state.interfaceMode !== "layout" || !findWidget(state.selectedWidgetId);
      persistUiState();
      renderInterface();
    }

    function activateTab(tab) {
      state.activeTab = validUiTab(tab);

      document.querySelectorAll(".tab").forEach(button => {
        button.setAttribute("aria-selected", String(button.dataset.tab === state.activeTab));
      });

      document.querySelectorAll(".pane").forEach(pane => {
        pane.classList.remove("active");
      });

      document.getElementById(state.activeTab + "Pane").classList.add("active");
      persistUiState();
      updateEditorLayout();
      if (state.activeTab === "code") {
        setInputValue(inputs.code, state.code);
        renderCodeHighlight();
        requestAnimationFrame(() => {
          codeEditorSurface.focus();
          syncCodeHighlightScroll();
        });
      }
      if (state.activeTab === "info") {
        setInputValue(inputs.info, state.info);
        renderInfo();
        renderInfoEditor(false);
      }
      if (state.activeTab === "interface") {
        renderInterface();
      }
    }

    function setInfoEditing(editing, selectionOffset, anchorRatio) {
      state.infoEditing = Boolean(editing);
      persistUiState();
      setInputValue(inputs.info, state.info);
      inputs.info.classList.toggle("hidden", !state.infoEditing);
      infoEditorSurface.classList.toggle("hidden", !state.infoEditing);
      infoPreview.classList.toggle("hidden", state.infoEditing);
      infoToggleButton.textContent = state.infoEditing ? "Preview" : "Edit";
      updateEditorLayout();
      if (state.infoEditing) {
        inputs.info.wrap = "soft";
        inputs.info.style.whiteSpace = "pre-wrap";
        inputs.info.style.overflowWrap = "normal";
        renderInfoEditor(false);
        requestAnimationFrame(() => {
          revealEditableOffset(infoEditorSurface, selectionOffset, anchorRatio);
        });
      } else {
        renderInfo();
        infoPreview.focus();
      }
    }

    function renderInfo() {
      infoPreview.replaceChildren(...markdownToNodes(state.info));
      renderInfoEditor(true);
    }

    function renderInfoEditor(preserveSelection) {
      renderHighlightedEditable(infoEditorSurface, state.info, appendHighlightedMarkdown, preserveSelection);
    }

    function appendHighlightedMarkdown(parent, source) {
      const lines = String(source ?? "").split("\\n");
      const fenceMarker = String.fromCharCode(96, 96, 96);
      let inFence = false;
      lines.forEach((line, lineIndex) => {
        const trimmed = line.trimStart();
        const leading = line.length - trimmed.length;
        if (trimmed.startsWith(fenceMarker)) {
          if (leading > 0) {
            parent.append(document.createTextNode(line.slice(0, leading)));
          }
          appendCodeToken(parent, trimmed, "md-marker");
          inFence = !inFence;
        } else if (inFence) {
          appendCodeToken(parent, line, "md-code");
        } else {
          appendHighlightedMarkdownLine(parent, line);
        }
        if (lineIndex < lines.length - 1) {
          parent.append(document.createTextNode("\\n"));
        }
      });
    }

    function appendHighlightedMarkdownLine(parent, line) {
      const heading = line.match(/^(\\s*)(#{1,6})(\\s+)(.*)$/);
      if (heading) {
        parent.append(document.createTextNode(heading[1]));
        appendCodeToken(parent, heading[2], "md-marker");
        parent.append(document.createTextNode(heading[3]));
        appendCodeToken(parent, heading[4], "md-heading");
        return;
      }

      const list = line.match(/^(\\s*)([-*+] |\\d+[.)] )(.*)$/);
      if (list) {
        parent.append(document.createTextNode(list[1]));
        appendCodeToken(parent, list[2], "md-marker");
        appendHighlightedMarkdownInline(parent, list[3]);
        return;
      }

      const quote = line.match(/^(\\s*>\\s?)(.*)$/);
      if (quote) {
        appendCodeToken(parent, quote[1], "md-marker");
        appendHighlightedMarkdownInline(parent, quote[2]);
        return;
      }

      appendHighlightedMarkdownInline(parent, line);
    }

    function appendHighlightedMarkdownInline(parent, text) {
      const codeMarker = String.fromCharCode(96);
      let index = 0;
      while (index < text.length) {
        if (text[index] === codeMarker) {
          const end = text.indexOf(codeMarker, index + 1);
          if (end > index) {
            appendCodeToken(parent, text.slice(index, end + 1), "md-code");
            index = end + 1;
            continue;
          }
        }

        if (text.startsWith("**", index)) {
          const end = text.indexOf("**", index + 2);
          if (end > index + 2) {
            appendCodeToken(parent, "**", "md-marker");
            appendCodeToken(parent, text.slice(index + 2, end), "md-strong");
            appendCodeToken(parent, "**", "md-marker");
            index = end + 2;
            continue;
          }
        }

        if (text[index] === "*") {
          const end = text.indexOf("*", index + 1);
          if (end > index + 1) {
            appendCodeToken(parent, "*", "md-marker");
            appendCodeToken(parent, text.slice(index + 1, end), "md-emphasis");
            appendCodeToken(parent, "*", "md-marker");
            index = end + 1;
            continue;
          }
        }

        const link = text.slice(index).match(/^\\[([^\\]]+)\\]\\(([^)]+)\\)/);
        if (link) {
          appendCodeToken(parent, "[", "md-marker");
          appendCodeToken(parent, link[1], "md-link");
          appendCodeToken(parent, "](", "md-marker");
          appendCodeToken(parent, link[2], "md-code");
          appendCodeToken(parent, ")", "md-marker");
          index += link[0].length;
          continue;
        }

        const nextSpecial = nextMarkdownSpecial(text, index + 1);
        parent.append(document.createTextNode(text.slice(index, nextSpecial)));
        index = nextSpecial;
      }
    }

    function nextMarkdownSpecial(text, start) {
      const candidates = [String.fromCharCode(96), "*", "["]
        .map(marker => text.indexOf(marker, start))
        .filter(position => position >= 0);
      return candidates.length > 0 ? Math.min(...candidates) : text.length;
    }

    function markdownToNodes(markdown) {
      const source = String(markdown ?? "").replace(/\\r\\n/g, "\\n");
      const lines = splitMarkdownLines(source);
      const nodes = [];
      let paragraph = [];
      let list = null;
      let codeFence = null;

      function flushParagraph() {
        if (paragraph.length === 0) {
          return;
        }
        const element = node("p", "", "");
        setSourceRange(element, paragraph[0].start, paragraph[paragraph.length - 1].end);
        paragraph.forEach((part, index) => {
          if (index > 0) {
            element.append(sourceSpan(" ", Math.max(paragraph[index - 1].end, part.start - 1), "md-source-gap"));
          }
          appendInlineMarkdown(element, part.text, part.start);
        });
        nodes.push(element);
        paragraph = [];
      }

      function flushList() {
        if (!list) {
          return;
        }
        nodes.push(list.element);
        list = null;
      }

      const fenceMarker = String.fromCharCode(96, 96, 96);
      for (const lineInfo of lines) {
        const line = lineInfo.text;
        if (line.startsWith(fenceMarker)) {
          if (codeFence) {
            nodes.push(renderCodeFence(codeFence));
            codeFence = null;
          } else {
            flushParagraph();
            flushList();
            codeFence = {
              lines: [],
              start: lineInfo.next,
              end: lineInfo.next
            };
          }
          continue;
        }

        if (codeFence) {
          codeFence.lines.push(lineInfo);
          codeFence.end = lineInfo.end;
          continue;
        }

        const heading = line.match(/^(#{1,3})(\\s+)(.+)$/);
        if (heading) {
          flushParagraph();
          flushList();
          const text = heading[3].replace(/\\s+$/, "");
          const start = lineInfo.start + heading[1].length + heading[2].length;
          const element = node("h" + heading[1].length, "", "");
          setSourceRange(element, start, start + text.length);
          appendInlineMarkdown(element, text, start);
          nodes.push(element);
          continue;
        }

        const unordered = line.match(/^(\\s*[-*]\\s+)(.+)$/);
        const ordered = line.match(/^(\\s*\\d+[.)]\\s+)(.+)$/);
        if (unordered || ordered) {
          flushParagraph();
          const orderedList = Boolean(ordered);
          if (!list || list.ordered !== orderedList) {
            flushList();
            list = {
              ordered: orderedList,
                element: node(orderedList ? "ol" : "ul", "", "")
            };
          }
          const match = unordered ?? ordered;
          const text = match[2].replace(/\\s+$/, "");
          const start = lineInfo.start + match[1].length;
          const item = node("li", "", "");
          setSourceRange(item, start, start + text.length);
          appendInlineMarkdown(item, text, start);
          list.element.append(item);
          const listStart = Number(list.element.dataset.sourceStart);
          setSourceRange(
            list.element,
            Number.isFinite(listStart) ? Math.min(listStart, start) : start,
            start + text.length
          );
          continue;
        }

        const quote = line.match(/^(>\\s?)(.*)$/);
        if (quote) {
          flushParagraph();
          flushList();
          const text = quote[2].replace(/\\s+$/, "");
          const start = lineInfo.start + quote[1].length;
          const block = node("blockquote", "", "");
          setSourceRange(block, start, start + text.length);
          appendInlineMarkdown(block, text, start);
          nodes.push(block);
          continue;
        }

        if (line.trim() === "") {
          flushParagraph();
          flushList();
          continue;
        }

        const leading = line.match(/^\\s*/)?.[0].length ?? 0;
        const text = line.slice(leading).replace(/\\s+$/, "");
        const start = lineInfo.start + leading;
        paragraph.push({ text, start, end: start + text.length });
      }

      if (codeFence) {
        nodes.push(renderCodeFence(codeFence));
      }
      flushParagraph();
      flushList();
      return nodes.length > 0 ? nodes : [node("p", "no-selection", "")];
    }

    function splitMarkdownLines(source) {
      if (source.length === 0) {
        return [{ text: "", start: 0, end: 0, next: 0 }];
      }

      const lines = [];
      let start = 0;
      while (start <= source.length) {
        const newline = source.indexOf("\\n", start);
        if (newline < 0) {
          lines.push({ text: source.slice(start), start, end: source.length, next: source.length });
          break;
        }
        lines.push({ text: source.slice(start, newline), start, end: newline, next: newline + 1 });
        start = newline + 1;
      }
      return lines;
    }

    function renderCodeFence(codeFence) {
      const text = codeFence.lines.map(line => line.text).join("\\n");
      const code = node("code", "", text);
      setSourceRange(code, codeFence.start, codeFence.end);
      const pre = node("pre", "", code);
      setSourceRange(pre, codeFence.start, codeFence.end);
      return pre;
    }

    function appendInlineMarkdown(parent, text, sourceStart) {
      const codeMarker = String.fromCharCode(96);
      let index = 0;
      while (index < text.length) {
        if (text.startsWith("**", index)) {
          const end = text.indexOf("**", index + 2);
          if (end > index + 2) {
            const element = node("strong", "", text.slice(index + 2, end));
            setSourceRange(element, sourceStart + index + 2, sourceStart + end);
            parent.append(element);
            index = end + 2;
            continue;
          }
        }

        if (text[index] === "*") {
          const end = text.indexOf("*", index + 1);
          if (end > index + 1) {
            const element = node("em", "", text.slice(index + 1, end));
            setSourceRange(element, sourceStart + index + 1, sourceStart + end);
            parent.append(element);
            index = end + 1;
            continue;
          }
        }

        if (text[index] === codeMarker) {
          const end = text.indexOf(codeMarker, index + 1);
          if (end > index + 1) {
            const element = node("code", "", text.slice(index + 1, end));
            setSourceRange(element, sourceStart + index + 1, sourceStart + end);
            parent.append(element);
            index = end + 1;
            continue;
          }
        }

        if (text[index] === "[") {
          const labelEnd = text.indexOf("]", index + 1);
          const urlStart = labelEnd >= 0 ? text.indexOf("(", labelEnd) : -1;
          const urlEnd = urlStart >= 0 ? text.indexOf(")", urlStart) : -1;
          if (labelEnd > index + 1 && urlStart === labelEnd + 1 && urlEnd > urlStart + 1) {
            const href = text.slice(urlStart + 1, urlEnd);
            const link = node("a", "", text.slice(index + 1, labelEnd));
            setSourceRange(link, sourceStart + index + 1, sourceStart + labelEnd);
            if (href.startsWith("http://") || href.startsWith("https://") || href.startsWith("#")) {
              link.href = href;
            }
            parent.append(link);
            index = urlEnd + 1;
            continue;
          }
        }

        let next = index + 1;
        while (next < text.length && !text.startsWith("**", next) && !["*", codeMarker, "["].includes(text[next])) {
          next += 1;
        }
        parent.append(sourceSpan(text.slice(index, next), sourceStart + index, ""));
        index = next;
      }
    }

    function sourceSpan(text, sourceStart, className) {
      const span = node("span", className, text);
      setSourceRange(span, sourceStart, sourceStart + String(text ?? "").length);
      return span;
    }

    function setSourceRange(element, start, end) {
      element.dataset.sourceStart = String(Math.max(0, start));
      element.dataset.sourceEnd = String(Math.max(0, end));
      return element;
    }

    function findInfoSourceOffset(event) {
      const range = caretRangeFromEvent(event);
      const rangeOffset = sourceOffsetFromRange(range);
      if (Number.isFinite(rangeOffset)) {
        return rangeOffset;
      }

      const element = closestSourceElement(event.target);
      const fallback = Number(element?.dataset.sourceStart);
      return Number.isFinite(fallback) ? fallback : 0;
    }

    function infoClickAnchor(event) {
      const rect = infoPreview.getBoundingClientRect();
      if (!rect.height) {
        return 0.25;
      }
      return clampNumber((event.clientY - rect.top) / rect.height, 0.08, 0.92);
    }

    function caretRangeFromEvent(event) {
      if (document.caretRangeFromPoint) {
        return document.caretRangeFromPoint(event.clientX, event.clientY);
      }

      if (document.caretPositionFromPoint) {
        const position = document.caretPositionFromPoint(event.clientX, event.clientY);
        if (!position) {
          return null;
        }
        const range = document.createRange();
        range.setStart(position.offsetNode, position.offset);
        return range;
      }

      return null;
    }

    function sourceOffsetFromRange(range) {
      if (!range) {
        return null;
      }

      const element = closestSourceElement(range.startContainer);
      const start = Number(element?.dataset.sourceStart);
      const end = Number(element?.dataset.sourceEnd);
      if (!element || !Number.isFinite(start)) {
        return null;
      }

      if (range.startContainer.nodeType === Node.TEXT_NODE && element.contains(range.startContainer)) {
        return clampNumber(start + textNodeOffsetWithin(element, range.startContainer, range.startOffset), start, Number.isFinite(end) ? end : state.info.length);
      }

      return start;
    }

    function textNodeOffsetWithin(element, targetNode, targetOffset) {
      let offset = 0;
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      let current = walker.nextNode();
      while (current) {
        if (current === targetNode) {
          return offset + targetOffset;
        }
        offset += current.textContent.length;
        current = walker.nextNode();
      }
      return 0;
    }

    function closestSourceElement(value) {
      const element = value?.nodeType === Node.ELEMENT_NODE ? value : value?.parentElement;
      return element?.closest?.("[data-source-start]") ?? null;
    }

    function renderCodeHighlight() {
      renderHighlightedEditable(codeEditorSurface, state.code, appendHighlightedNetLogo, true);
      renderHighlightedEditable(codeHighlight, state.code, appendHighlightedNetLogo, false);
      renderCodeLineNumbers();
      syncCodeHighlightScroll();
    }

    function renderCodeLineNumbers() {
      const lineCount = String(state.code ?? "").split("\\n").length;
      const digits = String(lineCount).length;
      if (codeEditor) {
        codeEditor.style.setProperty("--code-gutter-width", Math.max(48, digits * 9 + 26) + "px");
      }
      codeLineNumbers.textContent = Array.from({ length: lineCount }, (_, index) => String(index + 1)).join("\\n");
    }

    function renderHighlightedEditable(target, source, renderer, preserveSelection) {
      const offset = preserveSelection ? editableOffset(target) : null;
      const fragment = document.createDocumentFragment();
      renderer(fragment, source);
      target.replaceChildren(fragment);
      if (Number.isFinite(offset) && document.activeElement === target) {
        setEditableOffset(target, offset);
      }
    }

    function syncHighlightedEditor(section, editor, input) {
      const value = editableText(editor);
      state[section] = value;
      setInputValue(input, value);
      if (section === "info") {
        renderInfo();
      } else if (section === "code") {
        renderCodeHighlight();
      }
      queueUpdate(section, value);
    }

    function handleHighlightedEditorKeyDown(event, editor, input, section) {
      if (event.key === "Tab") {
        event.preventDefault();
        insertEditableText(editor, "  ");
        syncHighlightedEditor(section, editor, input);
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        insertEditableText(editor, "\\n");
        syncHighlightedEditor(section, editor, input);
      }
    }

    function handleHighlightedEditorPaste(event, editor, input, section) {
      event.preventDefault();
      insertEditableText(editor, event.clipboardData?.getData("text/plain") ?? "");
      syncHighlightedEditor(section, editor, input);
    }

    function insertEditableText(editor, text) {
      editor.focus();
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0 || !editor.contains(selection.anchorNode)) {
        editor.append(document.createTextNode(text));
        setEditableOffset(editor, editableText(editor).length);
        return;
      }

      const range = selection.getRangeAt(0);
      range.deleteContents();
      const node = document.createTextNode(text);
      range.insertNode(node);
      range.setStartAfter(node);
      range.setEndAfter(node);
      selection.removeAllRanges();
      selection.addRange(range);
    }

    function editableText(editor) {
      return editor.textContent.replace(/\\u00a0/g, " ");
    }

    function editableOffset(editor) {
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0 || !editor.contains(selection.anchorNode)) {
        return null;
      }

      const range = selection.getRangeAt(0).cloneRange();
      const prefix = document.createRange();
      prefix.selectNodeContents(editor);
      prefix.setEnd(range.startContainer, range.startOffset);
      return prefix.toString().length;
    }

    function revealEditableOffset(editor, offset, anchorRatio) {
      editor.focus();
      if (!Number.isFinite(offset)) {
        return;
      }
      const bounded = clampNumber(offset, 0, editableText(editor).length);
      setEditableOffset(editor, bounded);
      requestAnimationFrame(() => {
        const anchor = Number.isFinite(anchorRatio) ? clampNumber(anchorRatio, 0.08, 0.92) : 0.25;
        const caretRect = selectedEditableCaretRect(editor);
        if (caretRect) {
          const editorRect = editor.getBoundingClientRect();
          const targetTop = editorRect.top + editor.clientHeight * anchor;
          editor.scrollTop = Math.max(0, editor.scrollTop + caretRect.top - targetTop);
        } else {
          revealEditableOffsetByLine(editor, bounded, anchor);
        }
        editor.scrollLeft = 0;
        requestAnimationFrame(() => {
          keepEditableCaretVisible(editor);
        });
      });
    }

    function revealEditableOffsetByLine(editor, offset, anchor) {
      const lineCount = editableText(editor).slice(0, offset).split("\\n").length - 1;
      const style = getComputedStyle(editor);
      const lineHeight = Number.parseFloat(style.lineHeight) || 20;
      const paddingTop = Number.parseFloat(style.paddingTop) || 0;
      const target = paddingTop + lineCount * lineHeight;
      editor.scrollTop = Math.max(0, target - editor.clientHeight * anchor);
    }

    function selectedEditableCaretRect(editor) {
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0 || !editor.contains(selection.anchorNode)) {
        return null;
      }

      const range = selection.getRangeAt(0).cloneRange();
      const rects = range.getClientRects();
      if (rects.length) {
        return rects[0];
      }

      const marker = document.createElement("span");
      marker.textContent = String.fromCharCode(8203);
      marker.style.display = "inline-block";
      marker.style.width = "0";
      marker.style.height = "1em";
      marker.style.overflow = "hidden";
      range.insertNode(marker);
      const rect = marker.getBoundingClientRect();
      marker.remove();
      selection.removeAllRanges();
      selection.addRange(range);
      return rect;
    }

    function keepEditableCaretVisible(editor) {
      const caretRect = selectedEditableCaretRect(editor);
      if (!caretRect) {
        return;
      }

      const editorRect = editor.getBoundingClientRect();
      const topLimit = editorRect.top + 8;
      const bottomLimit = editorRect.bottom - 8;
      if (caretRect.top < topLimit) {
        editor.scrollTop += caretRect.top - topLimit;
      } else if (caretRect.bottom > bottomLimit) {
        editor.scrollTop += caretRect.bottom - bottomLimit;
      }
      editor.scrollLeft = 0;
    }

    function setEditableOffset(editor, offset) {
      const bounded = clampNumber(offset, 0, editableText(editor).length);
      const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
      let remaining = bounded;
      let current = walker.nextNode();
      while (current) {
        const length = current.textContent.length;
        if (remaining <= length) {
          const range = document.createRange();
          range.setStart(current, remaining);
          range.collapse(true);
          const selection = window.getSelection();
          selection.removeAllRanges();
          selection.addRange(range);
          return;
        }
        remaining -= length;
        current = walker.nextNode();
      }

      const range = document.createRange();
      range.selectNodeContents(editor);
      range.collapse(false);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    }

    function appendHighlightedNetLogo(parent, source) {
      const lines = String(source ?? "").split("\\n");
      lines.forEach((line, lineIndex) => {
        appendHighlightedNetLogoLine(parent, line);
        if (lineIndex < lines.length - 1) {
          parent.append(document.createTextNode("\\n"));
        }
      });
    }

    function appendHighlightedNetLogoLine(parent, line) {
      let index = 0;
      while (index < line.length) {
        const character = line[index];
        if (character === ";") {
          appendCodeToken(parent, line.slice(index), "nl-comment");
          return;
        }

        if (character === '"') {
          const end = readStringEnd(line, index);
          appendCodeToken(parent, line.slice(index, end), "nl-string");
          index = end;
          continue;
        }

        if (/\\s/.test(character)) {
          const start = index;
          while (index < line.length && /\\s/.test(line[index])) {
            index += 1;
          }
          parent.append(document.createTextNode(line.slice(start, index)));
          continue;
        }

        if ("[](){}".includes(character)) {
          appendCodeToken(parent, character, "nl-symbol");
          index += 1;
          continue;
        }

        const start = index;
        while (index < line.length && !isNetLogoDelimiter(line[index])) {
          index += 1;
        }
        const token = line.slice(start, index);
        appendCodeToken(parent, token, classifyNetLogoToken(token));
      }
    }

    function readStringEnd(line, start) {
      let index = start + 1;
      while (index < line.length) {
        if (line[index] === "\\\\" && index + 1 < line.length) {
          index += 2;
          continue;
        }
        if (line[index] === '"') {
          return index + 1;
        }
        index += 1;
      }
      return line.length;
    }

    function isNetLogoDelimiter(character) {
      return character === ";"
        || character === '"'
        || /[\\s\\[\\]\\(\\){}]/.test(character);
    }

    function classifyNetLogoToken(token) {
      const lower = token.toLowerCase();
      if (netLogoNumberPattern.test(token)) {
        return "nl-number";
      }
      if (netLogoKeywords.has(lower)) {
        return "nl-keyword";
      }
      if (netLogoPrimitives.has(lower)) {
        return "nl-primitive";
      }
      return "";
    }

    function appendCodeToken(parent, text, className) {
      if (!text) {
        return;
      }
      if (className) {
        parent.append(node("span", className, text));
      } else {
        parent.append(document.createTextNode(text));
      }
    }

    function syncCodeHighlightScroll() {
      codeHighlight.scrollTop = codeEditorSurface.scrollTop;
      codeHighlight.scrollLeft = codeEditorSurface.scrollLeft;
      codeLineNumbers.scrollTop = codeEditorSurface.scrollTop;
    }

    function clampNumber(value, min, max) {
      return Math.min(Math.max(value, min), max);
    }

    function queueUpdate(section, value) {
      setStatus(state.runLoop ? "Running " + state.runLoop.label : "Editing");
      clearTimeout(timers.get(section));
      timers.set(section, setTimeout(() => {
        vscode.postMessage({ type: "update", section, value });
        setStatus(state.runLoop ? "Running " + state.runLoop.label : "Synced");
      }, 250));
    }

    function postRunCommand(command, silent, repeat = 1) {
      state.runtimeStatus = "running";
      updateRuntimeBanner();
      setStatus("Running " + command);
      vscode.postMessage({ type: "run-command", command, repeat, silent });
    }

    function updateSpeedControl() {
      state.runSpeed = clampRunSpeed(state.runSpeed);
      speedSlider.value = String(state.runSpeed);
      const targetFps = runLoopTargetFps();
      const batchSize = runLoopBatchSize();
      const label = runSpeedLabel();
      speedLabel.textContent = label;
      const timing = " · " + formatRunLoopFps(targetFps) + " fps";
      const batching = batchSize > 1 ? " · " + batchSize + " ticks/update" : "";
      speedSlider.title = label + timing + batching;
      speedSlider.setAttribute(
        "aria-valuetext",
        label
          + ", target " + formatRunLoopFps(targetFps) + " frames per second"
          + (batchSize > 1 ? ", " + batchSize + " ticks per update" : "")
      );
    }

    function runSpeedLabel() {
      const rawSpeed = clampRunSpeed(state.runSpeed);
      const speed = runSpeedPosition();
      if (rawSpeed <= RUN_SPEED_RAW_MIN) {
        return "slowest";
      }
      if (speed < 0) {
        return "slower";
      }
      if (speed === 0) {
        return "normal speed";
      }
      if (rawSpeed >= RUN_SPEED_RAW_MAX) {
        return "fastest";
      }
      return "faster";
    }

    function runSpeedPosition() {
      const rawSpeed = clampRunSpeed(state.runSpeed);
      if (rawSpeed < -RUN_SPEED_DEAD_ZONE) {
        return (rawSpeed + RUN_SPEED_DEAD_ZONE) / 2;
      }
      if (rawSpeed > RUN_SPEED_DEAD_ZONE) {
        return (rawSpeed - RUN_SPEED_DEAD_ZONE) / 2;
      }
      return 0;
    }

    function configuredFrameRate() {
      const view = state.interfacePreview.widgets.find(widget => widget.kind === "view");
      const configured = Number(view?.details?.frameRate ?? view?.details?.["frame-rate"]);
      return Number.isFinite(configured) && configured > 0 ? configured : RUN_SPEED_DEFAULT_FRAME_RATE;
    }

    function runLoopDelayMs() {
      const speed = runSpeedPosition();
      const defaultFrameRate = configuredFrameRate();
      const frameRate = speed >= 0
        ? defaultFrameRate + speed - 1 + Math.pow(1.3, speed)
        : defaultFrameRate * Math.pow(0.9, -speed);
      const frameGap = 1000 / Math.max(frameRate, Number.EPSILON);
      if (speed < 0) {
        // Tick-based NetLogo adds this slowdown after its frame-rate pause.
        return frameGap + Math.pow(Math.pow(9000, 0.02), -speed);
      }
      return frameGap;
    }

    function runLoopTargetFps() {
      return 1000 / runLoopDelayMs();
    }

    function formatRunLoopFps(value) {
      if (value >= 100) {
        return String(Math.round(value));
      }
      return String(Math.round(value * 10) / 10);
    }

    function runLoopBatchSize() {
      const speed = runSpeedPosition();
      if (speed <= 25) {
        return 1;
      }
      const tickGap = speed <= 40
        ? Math.ceil(speed - 24)
        : Math.floor(speed - 24 + Math.pow(Math.pow(1_000_000, 0.1), speed - 40));
      // Large native gaps are split so Stop remains cooperative across the
      // extension bridge and a single request cannot monopolize the runtime.
      return Math.min(RUN_SPEED_MAX_BATCH, Math.max(1, tickGap));
    }

    function startRunLoop(command, label) {
      if (state.runLoop?.command === command) {
        stopRunLoop();
        return;
      }

      state.runLoop = {
        command,
        label: label || command,
        waiting: false,
        requestStartedAt: null
      };
      state.runtimeStatus = "running";
      updateRuntimeBanner();
      setStatus("Running " + state.runLoop.label);
      updateRunControls();
      renderInterface();
      scheduleRunLoop();
    }

    function stopRunLoop() {
      if (!state.runLoop) {
        return;
      }

      state.runLoop = null;
      setStatus("Stopping");
      updateRunControls();
      renderInterface();
    }

    function scheduleRunLoop() {
      const loop = state.runLoop;
      if (!loop || loop.waiting) {
        return;
      }

      loop.waiting = true;
      loop.requestStartedAt = performance.now();
      postRunCommand(loop.command, true, runLoopBatchSize());
    }

    function updateRunControls() {
      const running = Boolean(state.runLoop);
      setupButton.disabled = running;
      goButton.disabled = running;
      foreverButton.textContent = running ? "Stop" : "Forever";
      foreverButton.classList.toggle("running", running);
    }

    function renderTickCount() {
      tickCount.textContent = formatRuntimeTicks(state.ticks);
    }

    function formatRuntimeTicks(value) {
      if (value === null || value === undefined || value === "") {
        return "-";
      }

      const numeric = Number(value);
      if (!Number.isFinite(numeric)) {
        return String(value);
      }

      return new Intl.NumberFormat("en-US", {
        useGrouping: true,
        maximumFractionDigits: Number.isInteger(numeric) ? 0 : 2
      }).format(numeric);
    }

    function formatMonitorValue(value, precision) {
      const text = String(value ?? "").trim();
      if (!/^[-+]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][-+]?\\d+)?$/.test(text)) {
        return text || "...";
      }

      const numeric = Number(text);
      if (!Number.isFinite(numeric)) {
        return text;
      }

      const requestedPrecision = Number(precision);
      const decimalPlaces = Number.isFinite(requestedPrecision)
        ? Math.max(Math.round(requestedPrecision), 0)
        : 17;
      const approximated = netLogoMonitorApproximate(numeric, decimalPlaces);
      return formatNetLogoMonitorNumber(
        Object.is(approximated, -0) ? 0 : approximated,
        decimalPlaces >= 17 ? text : undefined
      );
    }

    // NetLogo evaluates numeric monitor reporters through Approximate.approximate.
    // In particular, its floor(value * scale + 0.5) rule rounds negative ties
    // toward positive infinity instead of using Intl.NumberFormat's half-away-
    // from-zero rule. At 17+ places NetLogo deliberately leaves the double alone.
    function netLogoMonitorApproximate(value, decimalPlaces) {
      if (decimalPlaces >= 17) {
        return value;
      }

      const scale = Math.pow(10, decimalPlaces);
      const approximated = Math.floor(value * scale + 0.5) / scale;
      return decimalPlaces > 0 ? approximated : Math.floor(approximated + 0.5);
    }

    function formatNetLogoMonitorNumber(value, originalText) {
      // Dump.number prints exact integer doubles through 2^53 inclusively.
      if (Number.isInteger(value) && Math.abs(value) <= 9007199254740992) {
        return groupMonitorDecimal(String(value));
      }

      const exponential = value.toExponential();
      const exponent = Number(exponential.slice(exponential.lastIndexOf("e") + 1));
      if (exponent < -3 || exponent >= 7) {
        const source = originalText && /[eE]/.test(originalText)
          ? originalText
          : exponential;
        return normalizeMonitorExponent(source, value);
      }

      return groupMonitorDecimal(String(value));
    }

    function normalizeMonitorExponent(source, value) {
      let scientific = source;
      let separator = Math.max(scientific.lastIndexOf("e"), scientific.lastIndexOf("E"));
      if (separator < 0) {
        scientific = value.toExponential();
        separator = scientific.lastIndexOf("e");
      }

      let mantissa = scientific.slice(0, separator);
      const exponent = Number(scientific.slice(separator + 1));
      const dot = mantissa.indexOf(".");
      if (dot < 0) {
        mantissa += ".0";
      } else {
        while (mantissa.endsWith("0") && !mantissa.endsWith(".0")) {
          mantissa = mantissa.slice(0, -1);
        }
      }
      return mantissa + "E" + String(exponent);
    }

    function groupMonitorDecimal(source) {
      const negative = source.startsWith("-");
      const unsigned = negative || source.startsWith("+") ? source.slice(1) : source;
      const dot = unsigned.indexOf(".");
      const whole = dot < 0 ? unsigned : unsigned.slice(0, dot);
      let fraction = dot < 0 ? "" : unsigned.slice(dot + 1);
      while (fraction.endsWith("0")) {
        fraction = fraction.slice(0, -1);
      }

      const groups = [];
      for (let end = whole.length; end > 0; end -= 3) {
        groups.unshift(whole.slice(Math.max(0, end - 3), end));
      }
      const grouped = groups.join(",") || "0";
      return (negative ? "-" : "") + grouped + (fraction ? "." + fraction : "");
    }

    function renderInterface() {
      if (state.interaction) {
        state.pendingInterfaceRender = true;
        return;
      }

      state.pendingInterfaceRender = false;
      const widgets = state.interfacePreview.widgets ?? [];
      disposeThreeViews();
      surface.replaceChildren();
      surface.classList.toggle("interact-mode", state.interfaceMode === "interact");
      surface.classList.toggle("layout-mode", state.interfaceMode === "layout");

      if (widgets.length === 0) {
        const empty = document.createElement("div");
        empty.className = "empty";
        empty.textContent = state.interfaceSource.trim() ? "Interface source not parsed" : "No widgets";
        surface.append(empty);
        surface.style.width = "820px";
        surface.style.height = "560px";
        renderProperties();
        return;
      }

      surface.style.width = (state.interfacePreview.bounds?.width ?? 820) + "px";
      surface.style.height = (state.interfacePreview.bounds?.height ?? 560) + "px";

      for (const widget of widgets) {
        const element = document.createElement("div");
        element.className = "widget " + widget.kind + "-widget";
        if (widget.id === state.selectedWidgetId) {
          element.classList.add("selected");
        }
        const isRunningForeverButton = widget.kind === "button"
          && Boolean(widget.details?.forever)
          && state.runLoop?.command === widgetRunCommand(widget);
        if (isRunningForeverButton) {
          element.classList.add("running");
        }
        element.dataset.widgetId = widget.id;
        element.tabIndex = 0;
        element.style.left = widget.x + "px";
        element.style.top = widget.y + "px";
        element.style.width = widget.width + "px";
        element.style.height = widget.height + "px";
        element.title = widget.runCommand
          ? (widget.details?.forever ? "Run/stop forever: " : "Run: ") + widget.runCommand
          : widget.type;
        element.append(renderWidgetContent(widget));
        const handle = node("span", "resize-handle", "");
        handle.addEventListener("pointerdown", event => startPointerInteraction(event, widget, element, "resize"));
        element.append(handle);
        element.addEventListener("pointerdown", event => startPointerInteraction(event, widget, element, "move"));
        element.addEventListener("keydown", event => handleWidgetKeydown(event, widget));
        surface.append(element);
        if (widget.kind === "view") {
          const dispose = mountThreeView(element);
          if (dispose) {
            state.threeViewDisposers.push(dispose);
          }
        }
      }

      renderProperties();
    }

    function disposeThreeViews() {
      for (const dispose of state.threeViewDisposers.splice(0)) {
        dispose();
      }
    }

    function refreshMountedThreeViews() {
      if (!state.view3DState) {
        return false;
      }

      let refreshed = false;
      for (const controller of state.threeViewDisposers) {
        if (typeof controller.update === "function") {
          if (controller.update(state.view3DState) === false) {
            return false;
          }
          refreshed = true;
        }
      }
      return refreshed;
    }

    function refreshMountedRuntimeWidgets() {
      for (const element of surface.querySelectorAll(".widget")) {
        const widget = findWidget(element.dataset.widgetId);
        if (!widget) {
          continue;
        }
        if (widget.kind === "monitor") {
          const value = element.querySelector(".monitor-value");
          if (value) {
            value.textContent = formatMonitorValue(state.runtimeValues[widget.id] ?? "...", widget.details?.precision);
          }
        } else if (widget.kind === "plot") {
          const plotBody = element.querySelector(".plot-body");
          if (plotBody) {
            plotBody.replaceWith(renderPlotBody(widget));
          }
        }
      }
    }

    function applyRuntimeResult(result) {
      if (!result) {
        state.runLoop = null;
        state.runtimeConfigured = false;
        state.runtimeStatus = "not-configured";
        setStatus("Runtime not configured");
        updateRuntimeBanner("NetLogo runtime not configured.");
        updateRunControls();
        renderInterface();
        return;
      }

      state.runtimeConfigured = true;
      state.runtimeStatus = "updated";
      state.runtimeValues = {};
      for (const monitor of result.monitorValues ?? []) {
        state.runtimeValues[monitor.widgetId] = monitor.value;
      }
      state.ticks = result.ticks ?? null;
      renderTickCount();
      state.viewImageDataUri = result.viewImageDataUri ?? null;
      state.view3DState = result.view3DState ?? null;
      state.plotData = {};
      for (const plot of result.plotValues ?? []) {
        state.plotData[plot.widgetId] = plot.data ?? null;
        state.dirtyPlotWidgets.delete(plot.widgetId);
      }
      const loop = state.runLoop;
      updateRuntimeBanner();
      setStatus(loop ? "Running " + loop.label : result.command ? "Updated after " + result.command : "Updated");
      if (loop) {
        loop.waiting = false;
        const requestElapsed = loop.requestStartedAt === null
          ? 0
          : Math.max(0, performance.now() - loop.requestStartedAt);
        loop.requestStartedAt = null;
        const remainingDelay = Math.max(0, runLoopDelayMs() - requestElapsed);
        setTimeout(() => {
          if (state.runLoop === loop) {
            scheduleRunLoop();
          }
        }, remainingDelay);
      }
      updateRunControls();
      const canRefresh3DOnly = Boolean(result.view3DState)
        && !result.viewImageDataUri;
      if (canRefresh3DOnly && refreshMountedThreeViews()) {
        refreshMountedRuntimeWidgets();
      } else {
        renderInterface();
      }
    }

    function applyRuntimeError(message) {
      state.runLoop = null;
      state.runtimeStatus = "error";
      const displayMessage = message || "NetLogo run failed";
      setStatus(displayMessage);
      updateRuntimeBanner("Last run failed: " + displayMessage);
      updateRunControls();
      renderInterface();
      console.error(displayMessage);
    }

    function startPointerInteraction(event, widget, element, mode) {
      if (event.button !== 0) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      if (state.interfaceMode !== "layout") {
        if (widget.kind === "button" && widget.runCommand) {
          runWidgetButton(widget);
        }
        return;
      }
      state.selectedWidgetId = widget.id;
      element.classList.add("selected");
      element.classList.add("dragging");
      if (mode === "move") {
        element.classList.add("drag-source");
      }
      renderProperties();
      element.setPointerCapture?.(event.pointerId);
      state.interaction = {
        mode,
        widgetId: widget.id,
        element,
        pointerId: event.pointerId,
        startClientX: event.clientX,
        startClientY: event.clientY,
        startX: widget.x,
        startY: widget.y,
        startWidth: widget.width,
        startHeight: widget.height,
        moved: false,
        pendingBounds: null,
        pendingTransform: null,
        dragProxy: mode === "move" ? createDragProxy(widget) : null,
        frame: null
      };
      setStatus(mode === "resize" ? "Resizing" : "Moving");
    }

    function updatePointerInteraction(event) {
      const interaction = state.interaction;
      if (!interaction) {
        return;
      }
      if (event.pointerId !== interaction.pointerId) {
        return;
      }

      const widget = findWidget(interaction.widgetId);
      if (!widget) {
        cleanupPointerInteraction(interaction);
        state.interaction = null;
        return;
      }

      const dx = event.clientX - interaction.startClientX;
      const dy = event.clientY - interaction.startClientY;
      interaction.moved = interaction.moved || Math.abs(dx) > 2 || Math.abs(dy) > 2;

      const bounds = interaction.mode === "resize"
        ? normalizeBounds({
          x: interaction.startX,
          y: interaction.startY,
          width: interaction.startWidth + dx,
          height: interaction.startHeight + dy
        }, widget.kind)
        : normalizeBounds({
          x: interaction.startX + dx,
          y: interaction.startY + dy,
          width: interaction.startWidth,
          height: interaction.startHeight
        }, widget.kind);

      interaction.pendingBounds = bounds;
      interaction.pendingTransform = interaction.mode === "move"
        ? { x: bounds.x - interaction.startX, y: bounds.y - interaction.startY }
        : null;
      schedulePointerInteractionFlush(interaction);
    }

    function schedulePointerInteractionFlush(interaction) {
      if (interaction.frame !== null) {
        return;
      }

      interaction.frame = requestAnimationFrame(() => {
        interaction.frame = null;
        flushPointerInteraction(interaction);
      });
    }

    function flushPointerInteraction(interaction) {
      const bounds = interaction.pendingBounds;
      if (!bounds) {
        return;
      }

      const widget = findWidget(interaction.widgetId);
      if (!widget) {
        return;
      }

      if (interaction.mode === "move") {
        const transform = interaction.pendingTransform ?? {
          x: bounds.x - interaction.startX,
          y: bounds.y - interaction.startY
        };
        const target = interaction.dragProxy ?? interaction.element;
        target.style.transform = "translate3d(" + transform.x + "px, " + transform.y + "px, 0)";
        return;
      }

      interaction.pendingBounds = null;
      interaction.pendingTransform = null;
      applyWidgetBounds(widget, bounds);
      writeElementBounds(interaction.element, bounds);
      updateSurfaceBounds();
    }

    function finishPointerInteraction(event) {
      const interaction = state.interaction;
      if (!interaction) {
        return;
      }
      if (event && event.pointerId !== interaction.pointerId) {
        return;
      }

      if (interaction.frame !== null) {
        cancelAnimationFrame(interaction.frame);
        interaction.frame = null;
      }

      const widget = findWidget(interaction.widgetId);
      if (!widget) {
        cleanupPointerInteraction(interaction);
        state.interaction = null;
        return;
      }

      const finalBounds = interaction.pendingBounds ?? {
        x: widget.x,
        y: widget.y,
        width: widget.width,
        height: widget.height
      };
      if (interaction.mode === "move") {
        interaction.pendingBounds = null;
        interaction.pendingTransform = null;
        cleanupPointerInteraction(interaction);
        applyWidgetBounds(widget, finalBounds);
        writeElementBounds(interaction.element, finalBounds);
        updateSurfaceBounds();
      } else {
        cleanupPointerInteraction(interaction);
        flushPointerInteraction(interaction);
      }
      state.interaction = null;
      commitWidgetBounds(widget);
      flushPendingInterfaceRender();
    }

    function flushPendingInterfaceRender() {
      if (state.pendingInterfaceRender && !state.interaction) {
        renderInterface();
      }
    }

    function createDragProxy(widget) {
      const proxy = document.createElement("div");
      proxy.className = "drag-proxy";
      proxy.style.left = widget.x + "px";
      proxy.style.top = widget.y + "px";
      proxy.style.width = widget.width + "px";
      proxy.style.height = widget.height + "px";
      surface.append(proxy);
      return proxy;
    }

    function cleanupPointerInteraction(interaction) {
      interaction.element.classList.remove("dragging");
      interaction.element.classList.remove("drag-source");
      interaction.element.style.transform = "";
      interaction.dragProxy?.remove();
      interaction.dragProxy = null;
    }

    function handleWidgetKeydown(event, widget) {
      if (state.interfaceMode !== "layout") {
        if ((event.key === "Enter" || event.key === " ") && widget.kind === "button" && widget.runCommand) {
          event.preventDefault();
          runWidgetButton(widget);
        }
        return;
      }

      const keys = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"]);
      if (!keys.has(event.key)) {
        return;
      }

      event.preventDefault();
      state.selectedWidgetId = widget.id;
      const step = event.shiftKey ? 10 : 1;
      const deltaX = event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0;
      const deltaY = event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0;
      const bounds = event.altKey
        ? normalizeBounds({
          x: widget.x,
          y: widget.y,
          width: widget.width + deltaX,
          height: widget.height + deltaY
        }, widget.kind)
        : normalizeBounds({
          x: widget.x + deltaX,
          y: widget.y + deltaY,
          width: widget.width,
          height: widget.height
        }, widget.kind);

      applyWidgetBounds(widget, bounds);
      updateSurfaceBounds();
      renderInterface();
      commitWidgetBounds(widget);
    }

    function runWidgetButton(widget) {
      const command = widgetRunCommand(widget);
      if (!command) {
        return;
      }

      if (widget.details?.forever) {
        if (state.runLoop?.command === command) {
          stopRunLoop();
        } else {
          startRunLoop(command, widget.label || widget.runCommand || command);
        }
      } else {
        postRunCommand(command, false);
      }
    }

    function widgetRunCommand(widget) {
      const command = String(widget?.runCommand ?? "").trim();
      if (!command) {
        return "";
      }

      const buttonType = String(widget.details?.buttonType ?? "OBSERVER").toUpperCase();
      if (buttonType === "TURTLE") {
        return "ask turtles [ " + command + " ]";
      }
      if (buttonType === "PATCH") {
        return "ask patches [ " + command + " ]";
      }
      if (buttonType === "LINK") {
        return "ask links [ " + command + " ]";
      }
      return command;
    }

    function toolbarGoCommand() {
      const goWidget = (state.interfacePreview.widgets ?? []).find(widget =>
        widget.kind === "button" && String(widget.runCommand ?? "").trim().toLowerCase() === "go"
      );
      return goWidget ? widgetRunCommand(goWidget) : "go";
    }

    function commitWidgetBounds(widget) {
      setStatus("Editing");
      vscode.postMessage({
        type: "update-bounds",
        widgetId: widget.id,
        bounds: {
          x: widget.x,
          y: widget.y,
          width: widget.width,
          height: widget.height
        }
      });
    }

    function renderProperties() {
      const widget = findWidget(state.selectedWidgetId);
      propertiesPanel.replaceChildren();
      deleteWidgetButton.disabled = state.interfaceMode !== "layout" || !widget;

      if (!widget) {
        propertiesPanel.append(
          node("h2", "properties-title", "Properties"),
          node("div", "no-selection", "No selection")
        );
        return;
      }

      propertiesPanel.append(node("h2", "properties-title", widget.type));
      propertiesPanel.append(renderBoundsFields(widget));

      const descriptors = getPropertyDescriptors(widget);
      if (descriptors.length > 0) {
        const group = node("div", "property-group", "");
        for (const descriptor of descriptors) {
          group.append(renderPropertyField(widget, descriptor));
        }
        propertiesPanel.append(group);
      }

      if (widget.kind === "plot") {
        propertiesPanel.append(renderPlotPensEditor(widget));
      }
    }

    function renderBoundsFields(widget) {
      const group = node("div", "property-group bounds-grid", "");
      for (const descriptor of [
        { key: "x", label: "X", value: widget.x },
        { key: "y", label: "Y", value: widget.y },
        { key: "width", label: "W", value: widget.width },
        { key: "height", label: "H", value: widget.height }
      ]) {
        const input = node("input", "property-input", "");
        input.type = "number";
        input.value = String(descriptor.value);
        input.addEventListener("change", () => {
          const next = normalizeBounds({
            x: descriptor.key === "x" ? Number(input.value) : widget.x,
            y: descriptor.key === "y" ? Number(input.value) : widget.y,
            width: descriptor.key === "width" ? Number(input.value) : widget.width,
            height: descriptor.key === "height" ? Number(input.value) : widget.height
          }, widget.kind);
          applyWidgetBounds(widget, next);
          updateSurfaceBounds();
          renderInterface();
          commitWidgetBounds(widget);
        });

        group.append(node("label", "property-row", [
          node("span", "property-label", descriptor.label),
          input
        ]));
      }
      return group;
    }

    function renderPropertyField(widget, descriptor) {
      const label = node("label", "property-row", "");
      const labelText = node("span", "property-label", descriptor.label);
      const input = descriptor.multiline
        ? node("textarea", "property-textarea", "")
        : node("input", "property-input", "");

      if (descriptor.type === "checkbox") {
        const checkboxLabel = node("label", "property-check", "");
        input.type = "checkbox";
        input.checked = Boolean(descriptor.value);
        input.addEventListener("change", () => {
          commitWidgetProperties(widget, descriptor.key, input.checked);
        });
        checkboxLabel.append(input, labelText);
        return checkboxLabel;
      }

      if (!descriptor.multiline) {
        input.type = descriptor.type === "number" ? "number" : "text";
      }
      input.value = formatPropertyValue(descriptor);
      input.addEventListener("change", () => {
        commitWidgetProperties(widget, descriptor.key, readPropertyValue(input, descriptor));
      });
      label.append(labelText, input);
      return label;
    }

    function commitWidgetProperties(widget, key, value) {
      if (widget.kind === "plot") {
        stopRunLoop();
        state.dirtyPlotWidgets.add(widget.id);
        state.runtimeStatus = "reload-needed";
        updateRuntimeBanner();
      }
      updateWidgetPropertyInState(widget, key, value);
      setStatus(widget.kind === "plot" ? "Plot changed · run Setup" : "Editing");
      vscode.postMessage({
        type: "update-properties",
        widgetId: widget.id,
        updates: { [key]: value }
      });
      renderInterface();
    }

    function getPropertyDescriptors(widget) {
      const details = widget.details ?? {};
      switch (widget.kind) {
        case "view":
          return [
            descriptor("patchSize", "Patch size", details.patchSize, "number"),
            descriptor("tickCounter", "Tick counter", details.tickCounter)
          ];
        case "button":
          return [
            descriptor("label", "Label", widget.label),
            descriptor("code", "Code", details.code ?? widget.runCommand ?? "", "text", true),
            descriptor("forever", "Forever", details.forever, "checkbox")
          ];
        case "slider":
          return [
            descriptor("label", "Label", widget.label),
            descriptor("variable", "Variable", details.variable),
            descriptor("min", "Min", details.min),
            descriptor("max", "Max", details.max),
            descriptor("value", "Value", details.value, "number"),
            descriptor("step", "Step", details.step),
            descriptor("units", "Units", details.units)
          ];
        case "switch":
          return [
            descriptor("label", "Label", widget.label),
            descriptor("variable", "Variable", details.variable),
            descriptor("on", "On", details.on, "checkbox")
          ];
        case "chooser":
          return [
            descriptor("label", "Label", widget.label),
            descriptor("variable", "Variable", details.variable),
            descriptor("choices", "Choices", details.choices, "text", true),
            descriptor("selectedIndex", "Selected", details.selectedIndex, "number")
          ];
        case "monitor":
          return [
            descriptor("label", "Label", widget.label),
            descriptor("source", "Source", details.source, "text", true),
            descriptor("precision", "Precision", details.precision, "number")
          ];
        case "plot":
          return [
            descriptor("label", "Title", widget.label),
            descriptor("xAxis", "X axis", details.xAxis),
            descriptor("yAxis", "Y axis", details.yAxis),
            descriptor("xMin", "X min", details.xMin, "number"),
            descriptor("xMax", "X max", details.xMax, "number"),
            descriptor("yMin", "Y min", details.yMin, "number"),
            descriptor("yMax", "Y max", details.yMax, "number"),
            descriptor("autoplot", "Auto scale", details.autoplot, "checkbox"),
            descriptor("legend", "Show legend", details.legend, "checkbox"),
            descriptor("setupCode", "Plot setup commands", details.setupCode, "text", true),
            descriptor("updateCode", "Plot update commands", details.updateCode, "text", true)
          ];
        case "input":
          return [
            descriptor("variable", "Variable", details.variable ?? widget.label),
            descriptor("value", "Value", details.value, "text", true),
            descriptor("multiline", "Multiline", details.multiline, "checkbox")
          ];
        case "textbox":
          return [
            descriptor("text", "Text", details.text ?? widget.label, "text", true),
            descriptor("fontSize", "Font size", details.fontSize, "number")
          ];
        case "output":
          return [
            descriptor("fontSize", "Font size", details.fontSize, "number")
          ];
        default:
          return [
            descriptor("label", "Label", widget.label)
          ];
      }
    }

    function renderPlotPensEditor(widget) {
      const pens = plotPens(widget);
      const editor = node("section", "plot-pens-editor", "");
      const addButton = node("button", "", "Add pen");
      addButton.type = "button";
      addButton.addEventListener("click", () => {
        const nextPens = pens.concat([newPlotPen(pens)]);
        commitWidgetProperties(widget, "pens", nextPens);
      });
      editor.append(node("div", "plot-pens-heading", [
        node("h3", "", "Pens"),
        addButton
      ]));

      if (pens.length === 0) {
        editor.append(node("div", "no-selection", "No pens. Add one to plot a series."));
        return editor;
      }

      pens.forEach((pen, index) => editor.append(renderPlotPenCard(widget, pens, pen, index)));
      return editor;
    }

    function renderPlotPenCard(widget, pens, pen, index) {
      const card = node("div", "plot-pen-card", "");
      const nameInput = node("input", "property-input", "");
      nameInput.type = "text";
      nameInput.value = String(pen.name ?? "");
      nameInput.setAttribute("aria-label", "Pen name");
      nameInput.addEventListener("change", () => {
        const requested = nameInput.value;
        if (requested !== "" && pens.some((candidate, candidateIndex) =>
          candidateIndex !== index && String(candidate.name ?? "") === requested
        )) {
          setStatus("Non-empty pen names must be unique");
          renderProperties();
          return;
        }
        commitPlotPen(widget, pens, index, { name: requested });
      });

      const swatch = node("span", "plot-pen-swatch", "");
      swatch.style.backgroundColor = plotCssColor(pen.color);
      const deleteButton = node("button", "plot-pen-delete", "Delete");
      deleteButton.type = "button";
      deleteButton.addEventListener("click", () => {
        commitWidgetProperties(widget, "pens", pens.filter((_candidate, candidateIndex) => candidateIndex !== index));
      });
      card.append(node("div", "plot-pen-card-header", [swatch, nameInput, deleteButton]));

      const colorSelect = node("select", "plot-pen-select", "");
      colorSelect.setAttribute("aria-label", "Pen color");
      const palette = plotPalette();
      const currentColor = Number(pen.color);
      if (!palette.some(entry => entry.color === currentColor)) {
        const custom = node("option", "", "Custom " + plotCssColor(currentColor));
        custom.value = String(currentColor);
        custom.selected = true;
        colorSelect.append(custom);
      }
      let paletteGroup;
      let paletteFamily;
      palette.forEach(entry => {
        if (entry.family !== paletteFamily) {
          paletteFamily = entry.family;
          paletteGroup = document.createElement("optgroup");
          paletteGroup.label = entry.family;
          colorSelect.append(paletteGroup);
        }
        const option = node("option", "", entry.name);
        option.value = String(entry.color);
        option.selected = entry.color === currentColor;
        option.style.color = plotCssColor(entry.color);
        paletteGroup.append(option);
      });
      colorSelect.addEventListener("change", () => {
        commitPlotPen(widget, pens, index, { color: Number(colorSelect.value) });
      });

      const modeSelect = node("select", "plot-pen-select", "");
      modeSelect.setAttribute("aria-label", "Pen mode");
      [[0, "Line"], [1, "Bar"], [2, "Point"]].forEach(([value, label]) => {
        const option = node("option", "", label);
        option.value = String(value);
        option.selected = Number(pen.mode) === value;
        modeSelect.append(option);
      });
      modeSelect.addEventListener("change", () => {
        commitPlotPen(widget, pens, index, { mode: Number(modeSelect.value) });
      });

      const intervalInput = node("input", "property-input", "");
      intervalInput.type = "number";
      intervalInput.min = "0.000001";
      intervalInput.step = "any";
      intervalInput.value = String(pen.interval ?? 1);
      intervalInput.addEventListener("change", () => {
        const interval = Number(intervalInput.value);
        if (!Number.isFinite(interval) || interval <= 0) {
          setStatus("Pen interval must be greater than zero");
          renderProperties();
          return;
        }
        commitPlotPen(widget, pens, index, { interval });
      });

      const legendInput = node("input", "", "");
      legendInput.type = "checkbox";
      legendInput.checked = pen.inLegend !== false;
      legendInput.addEventListener("change", () => {
        commitPlotPen(widget, pens, index, { inLegend: legendInput.checked });
      });

      card.append(node("div", "plot-pen-grid", [
        plotPenField("Color", colorSelect),
        plotPenField("Mode", modeSelect),
        plotPenField("Interval", intervalInput),
        node("label", "property-check", [legendInput, node("span", "property-label", "Show in legend")])
      ]));

      const setupInput = node("textarea", "property-textarea", "");
      setupInput.value = String(pen.setupCode ?? "");
      setupInput.addEventListener("change", () => {
        commitPlotPen(widget, pens, index, { setupCode: setupInput.value });
      });
      const updateInput = node("textarea", "property-textarea", "");
      updateInput.value = String(pen.updateCode ?? "");
      updateInput.addEventListener("change", () => {
        commitPlotPen(widget, pens, index, { updateCode: updateInput.value });
      });
      card.append(
        plotPenField("Pen setup commands", setupInput),
        plotPenField("Pen update commands", updateInput)
      );
      return card;
    }

    function plotPenField(label, input) {
      return node("label", "property-row", [
        node("span", "property-label", label),
        input
      ]);
    }

    function plotPens(widget) {
      return Array.isArray(widget.details?.pens)
        ? widget.details.pens.filter(pen => pen && typeof pen === "object").map(pen => ({
          name: String(pen.name ?? "Pen"),
          interval: Number.isFinite(Number(pen.interval)) ? Number(pen.interval) : 1,
          mode: [0, 1, 2].includes(Number(pen.mode)) ? Number(pen.mode) : 0,
          color: Number.isInteger(Number(pen.color)) ? Number(pen.color) : (0xff000000 | netLogoColorHex(0)) | 0,
          inLegend: pen.inLegend !== false,
          setupCode: String(pen.setupCode ?? ""),
          updateCode: String(pen.updateCode ?? "")
        }))
        : [];
    }

    function commitPlotPen(widget, pens, index, changes) {
      const nextPens = pens.map((pen, candidateIndex) => candidateIndex === index
        ? { ...pen, ...changes }
        : pen);
      commitWidgetProperties(widget, "pens", nextPens);
    }

    function newPlotPen(_pens) {
      return {
        name: "",
        interval: 1,
        mode: 0,
        color: (0xff000000 | netLogoColorHex(0)) | 0,
        inLegend: true,
        setupCode: "",
        updateCode: ""
      };
    }

    function plotPalette() {
      const families = [
        "gray", "red", "orange", "brown", "yellow", "green", "lime",
        "turquoise", "cyan", "sky", "blue", "violet", "magenta", "pink"
      ];
      const offsets = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 9.9];
      return families.flatMap((family, familyIndex) => offsets.map(offset => {
        const colorNumber = familyIndex * 10 + offset;
        const name = colorNumber === 0
          ? "black"
          : colorNumber === 9.9
            ? "white"
            : offset === 5 ? family : family + " " + colorNumber;
        return {
          family,
          name,
          colorNumber,
          color: (0xff000000 | netLogoColorHex(colorNumber)) | 0
        };
      }));
    }

    function descriptor(key, label, value, type = "text", multiline = false) {
      return { key, label, value: value ?? "", type, multiline };
    }

    function formatPropertyValue(descriptor) {
      if (Array.isArray(descriptor.value)) {
        return descriptor.value.join("\\n");
      }
      return String(descriptor.value ?? "");
    }

    function readPropertyValue(input, descriptor) {
      if (descriptor.key === "choices") {
        return parseChoices(input.value);
      }
      if (descriptor.type === "number") {
        const numeric = Number(input.value);
        return Number.isFinite(numeric) ? numeric : input.value;
      }
      return input.value;
    }

    function updateWidgetPropertyInState(widget, key, value) {
      widget.details = widget.details ?? {};
      widget.details[key] = value;
      if (key === "label" || (widget.kind === "textbox" && key === "text")) {
        widget.label = String(value);
      }
      if (key === "variable" && (widget.kind === "input" || !widget.label)) {
        widget.label = String(value);
      }
      if (key === "code") {
        widget.runCommand = String(value);
      }
    }

    function parseChoices(value) {
      const lines = value.split(/\\r?\\n/).map(line => line.trim()).filter(Boolean);
      if (lines.length > 1) {
        return lines;
      }

      const tokens = [];
      const expression = /"([^"]*)"|(\\S+)/g;
      let match;
      while ((match = expression.exec(value)) !== null) {
        tokens.push(match[1] ?? match[2] ?? "");
      }
      return tokens;
    }

    function nextWidgetBounds(kind) {
      const sizes = {
        view: { width: 440, height: 440 },
        button: { width: 90, height: 34 },
        slider: { width: 180, height: 33 },
        switch: { width: 120, height: 33 },
        chooser: { width: 180, height: 45 },
        monitor: { width: 160, height: 45 },
        plot: { width: 230, height: 130 },
        input: { width: 160, height: 45 },
        textbox: { width: 120, height: 45 },
        output: { width: 240, height: 120 }
      };
      const size = sizes[kind] ?? sizes.button;
      const widgets = state.interfacePreview.widgets ?? [];
      const offset = widgets.length % 8;
      return {
        x: 20 + offset * 18,
        y: 20 + offset * 18,
        width: size.width,
        height: size.height
      };
    }

    function findWidget(widgetId) {
      return (state.interfacePreview.widgets ?? []).find(widget => widget.id === widgetId);
    }

    function applyWidgetBounds(widget, bounds) {
      widget.x = bounds.x;
      widget.y = bounds.y;
      widget.width = bounds.width;
      widget.height = bounds.height;
    }

    function writeElementBounds(element, bounds) {
      element.style.left = bounds.x + "px";
      element.style.top = bounds.y + "px";
      element.style.width = bounds.width + "px";
      element.style.height = bounds.height + "px";
    }

    function updateSurfaceBounds() {
      const widgets = state.interfacePreview.widgets ?? [];
      state.interfacePreview.bounds = {
        width: Math.max(820, ...widgets.map(widget => widget.x + widget.width + 24)),
        height: Math.max(560, ...widgets.map(widget => widget.y + widget.height + 24))
      };
      surface.style.width = state.interfacePreview.bounds.width + "px";
      surface.style.height = state.interfacePreview.bounds.height + "px";
    }

    function normalizeBounds(bounds, kind) {
      const minimum = widgetMinimumSize(kind);
      return {
        x: Math.max(0, Math.round(bounds.x)),
        y: Math.max(0, Math.round(bounds.y)),
        width: Math.max(minimum.width, Math.round(bounds.width)),
        height: Math.max(minimum.height, Math.round(bounds.height))
      };
    }

    function widgetMinimumSize(kind) {
      const sizes = {
        slider: { width: 90, height: 34 },
        switch: { width: 80, height: 30 },
        chooser: { width: 100, height: 34 },
        monitor: { width: 90, height: 34 },
        plot: { width: 120, height: 80 },
        input: { width: 90, height: 34 },
        output: { width: 120, height: 80 },
        view: { width: 80, height: 80 }
      };
      return sizes[kind] ?? { width: 32, height: 24 };
    }

    function renderWidgetContent(widget) {
      switch (widget.kind) {
        case "view":
          return fragment([
            node("div", "view-title", widget.label),
            renderViewBody(),
            node("div", "view-footer", viewWorldLabel(widget))
          ]);
        case "button":
          return node("span", "widget-label", widget.label);
        case "slider":
          return fragment([
            node("div", "control-heading", displayName(widget)),
            node("div", "slider-row", [
              renderRuntimeSlider(widget),
              node("span", "control-value", detailText(widget, ["value", "units"], ""))
            ])
          ]);
        case "switch":
          return fragment([
            node("div", "control-heading", displayName(widget)),
            node("div", "switch-row", [
              renderRuntimeSwitch(widget),
              node("span", "control-value", widget.details?.variable ?? "")
            ])
          ]);
        case "chooser":
          return fragment([
            node("div", "control-heading", displayName(widget)),
            renderRuntimeChooser(widget)
          ]);
        case "monitor":
          return fragment([
            node("div", "monitor-heading", widget.label || widget.details?.source || "Monitor"),
            monitorValueElement(widget)
          ]);
        case "plot":
          return fragment([
            node("div", "plot-title", widget.label),
            renderPlotBody(widget),
            node("div", "plot-footer", [
              node("span", "", widget.details?.xAxis ?? "x"),
              node("span", "", widget.details?.yAxis ?? "y")
            ])
          ]);
        case "input":
          return fragment([
            labelWithType(widget),
            node("div", "fake-input", widget.details?.value ?? "")
          ]);
        case "textbox":
          return node("div", "widget-label", widget.details?.text ?? widget.label);
        case "output":
          return fragment([
            node("div", "output-title", "Output"),
            node("div", "output-body", ">")
          ]);
        default:
          return labelWithType(widget);
      }
    }

    function renderViewBody() {
      if (state.view3DState) {
        return node("div", "three-view", [
          node("div", "three-status", "3D")
        ]);
      }

      if (state.viewImageDataUri) {
        const image = node("img", "view-image", "");
        image.src = state.viewImageDataUri;
        image.alt = "NetLogo view";
        return image;
      }

      return node("div", "view-grid", "");
    }

    function mountThreeView(element) {
      const host = element.querySelector(".three-view");
      if (!host || !state.view3DState) {
        return null;
      }

      const THREE = window.NetLogoThree;
      if (!THREE) {
        const pending = host.querySelector(".three-status");
        if (pending) {
          pending.textContent = "Loading 3D";
        }
        return null;
      }

      try {
        return renderThreeView(host, state.view3DState, THREE);
      } catch (error) {
        host.replaceChildren(node("div", "three-status", "3D view unavailable"));
        console.error(error);
        return null;
      }
    }

    function renderThreeView(host, viewState, THREE) {
      let currentViewState = viewState;
      host.replaceChildren();
      const renderer = new THREE.WebGLRenderer({ antialias: true });
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.NoToneMapping;
      renderer.toneMappingExposure = 1;
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      host.append(renderer.domElement);

      const label = node("div", "three-status", threeStatusText(currentViewState));
      host.append(label);
      const inspector = node("div", "three-inspector", "");
      inspector.hidden = true;
      host.append(inspector);
      const controlsBar = renderThreeControls();
      controlsBar.addEventListener("pointerdown", event => event.stopPropagation());
      controlsBar.addEventListener("wheel", event => event.stopPropagation(), { passive: true });
      host.append(controlsBar);

      const scene = new THREE.Scene();
      scene.background = new THREE.Color(threeTheme().background);
      addThreeLights(scene, THREE);

      const bounds = viewState.bounds;
      const spanX = Math.max(1, bounds.maxX - bounds.minX + 1);
      const spanY = Math.max(1, bounds.maxY - bounds.minY + 1);
      const spanZ = Math.max(1, bounds.maxZ - bounds.minZ + 1);
      const span = Math.max(spanX, spanY, spanZ);
      const baseTarget = new THREE.Vector3(
        (bounds.minX + bounds.maxX) / 2,
        (bounds.minZ + bounds.maxZ) / 2,
        (bounds.minY + bounds.maxY) / 2
      );
      const target = baseTarget.clone();

      const camera = new THREE.PerspectiveCamera(45, 1, span / 100, span * 12);
      renderer.setTransparentSort((a, b) => threeTransparentObjectOrder(a, b, camera));
      const controls = {
        theta: Math.PI / 4,
        phi: Math.PI / 3,
        radius: span * 1.9,
        targetX: baseTarget.x,
        targetY: baseTarget.y,
        targetZ: baseTarget.z,
        ...(state.threeCamera ?? {})
      };
      if (!Number.isFinite(controls.targetX)) {
        controls.targetX = baseTarget.x;
      }
      if (!Number.isFinite(controls.targetY)) {
        controls.targetY = baseTarget.y;
      }
      if (!Number.isFinite(controls.targetZ)) {
        controls.targetZ = baseTarget.z;
      }

      applyThreeObserverCamera(currentViewState);

      const pickables = [];
      const trailLayer = new THREE.Group();
      scene.add(trailLayer);
      const trailState = ensureThreeTrailState(bounds, span);
      const agentLayer = new THREE.Group();
      scene.add(agentLayer);
      const patchLayer = new THREE.Group();
      const turtleLayer = new THREE.Group();
      const transparentLayer = new THREE.Group();
      scene.add(patchLayer, turtleLayer, transparentLayer);
      let viewportWidth = 0;
      let viewportHeight = 0;
      const worldBox = addThreeWorldBox(scene, THREE, bounds);
      rebuildAgentLayer(currentViewState);

      const raycaster = new THREE.Raycaster();
      raycaster.params.Line = { threshold: Math.max(0.18, span * 0.01) };
      const pointer = new THREE.Vector2();

      function resize() {
        const width = Math.max(1, host.clientWidth);
        const height = Math.max(1, host.clientHeight);
        if (width === viewportWidth && height === viewportHeight) {
          return;
        }
        viewportWidth = width;
        viewportHeight = height;
        renderer.setSize(width, height, false);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
      }

      function updateCamera() {
        controls.phi = Math.max(0.08, Math.min(Math.PI - 0.08, controls.phi));
        controls.radius = clampThreeRadius(controls.radius);
        target.set(controls.targetX, controls.targetY, controls.targetZ);
        const sinPhi = Math.sin(controls.phi);
        camera.position.set(
          target.x + controls.radius * sinPhi * Math.sin(controls.theta),
          target.y + controls.radius * Math.cos(controls.phi),
          target.z + controls.radius * sinPhi * Math.cos(controls.theta)
        );
        camera.lookAt(target);
        // Keep the depth range close to the world, including when zooming inside it.
        const clipping = threeCameraClipping(camera.position, baseTarget, spanX, spanY, spanZ);
        if (camera.near !== clipping.near || camera.far !== clipping.far) {
          camera.near = clipping.near;
          camera.far = clipping.far;
          camera.updateProjectionMatrix();
        }
      }

      function setCameraPose(pose) {
        const next = cameraPose(pose, span, baseTarget, currentViewState.observer);
        controls.theta = next.theta;
        controls.phi = next.phi;
        controls.radius = next.radius;
        controls.targetX = next.targetX;
        controls.targetY = next.targetY;
        controls.targetZ = next.targetZ;
        state.threeManualRadius = null;
        saveThreeCamera();
        draw();
      }

      function saveThreeCamera(useManualRadius = false) {
        state.threeCamera = { ...controls };
        if (useManualRadius) {
          state.threeManualRadius = controls.radius;
        }
        persistUiState();
      }

      function draw() {
        resize();
        updateCamera();
        renderer.render(scene, camera);
      }

      let drag = null;
      host.addEventListener("pointerdown", event => {
        event.preventDefault();
        event.stopPropagation();
        host.setPointerCapture?.(event.pointerId);
        drag = {
          x: event.clientX,
          y: event.clientY,
          mode: state.threeInteractionMode,
          theta: controls.theta,
          phi: controls.phi,
          radius: controls.radius,
          targetX: controls.targetX,
          targetY: controls.targetY,
          targetZ: controls.targetZ,
          moved: false
        };
      });
      host.addEventListener("pointermove", event => {
        if (!drag) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        drag.moved = drag.moved || Math.abs(event.clientX - drag.x) > 3 || Math.abs(event.clientY - drag.y) > 3;
        const dx = event.clientX - drag.x;
        const dy = event.clientY - drag.y;
        if (drag.mode === "zoom") {
          controls.radius = clampThreeRadius(drag.radius * Math.exp(dy * 0.012));
        } else if (drag.mode === "move") {
          panThreeCamera(dx, dy, drag);
        } else {
          controls.theta = drag.theta - dx * 0.01;
          controls.phi = drag.phi + dy * 0.01;
        }
        saveThreeCamera(drag.mode === "zoom");
        draw();
      });
      host.addEventListener("pointerup", event => {
        event.stopPropagation();
        if (drag && !drag.moved) {
          inspectThreeObject(event);
        }
        drag = null;
      });
      host.addEventListener("wheel", event => {
        event.preventDefault();
        event.stopPropagation();
        controls.radius = clampThreeRadius(controls.radius * (event.deltaY > 0 ? 1.12 : 0.88));
        saveThreeCamera(true);
        draw();
      }, { passive: false });

      const handleFullscreenChange = () => draw();
      document.addEventListener("fullscreenchange", handleFullscreenChange);

      controlsBar.addEventListener("click", event => {
        const button = event.target instanceof HTMLElement ? event.target.closest("button") : null;
        const action = button?.dataset.action;
        if (!action) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        if (["orbit", "zoom", "move"].includes(action)) {
          state.threeInteractionMode = action;
          persistUiState();
          updateThreeControlsActive(controlsBar);
          return;
        }
        if (action === "background") {
          state.threeBackground = state.threeBackground === "dark" ? "light" : "dark";
          persistUiState();
          updateThreeTheme(scene, worldBox, controlsBar, THREE);
          draw();
          return;
        }
        if (action === "fullscreen") {
          toggleThreeFullscreen(host);
          return;
        }
        setCameraPose(action);
      });

      const dispose = () => {
        document.removeEventListener("fullscreenchange", handleFullscreenChange);
        host.classList.remove("fullscreen-fallback");
        geometryDispose(scene);
        renderer.dispose();
      };
      dispose.update = nextViewState => {
        if (!sameThreeBounds(bounds, nextViewState.bounds)) {
          return false;
        }
        rebuildAgentLayer(nextViewState);
        return true;
      };
      return dispose;

      function rebuildAgentLayer(nextViewState) {
        currentViewState = nextViewState;
        applyThreeObserverCamera(currentViewState);
        pickables.length = 0;
        updateThreePenTrails(trailLayer, THREE, trailState, currentViewState);
        geometryDispose(agentLayer);
        agentLayer.clear();
        addThreePatches(patchLayer, THREE, currentViewState, pickables, true);
        addThreeTurtles(turtleLayer, THREE, currentViewState.turtles, pickables, true);
        addThreeLinks(agentLayer, THREE, currentViewState.links, currentViewState.turtles, pickables, true);
        addThreeTransparency(transparentLayer, THREE, currentViewState, pickables);
        addThreeLabels(agentLayer, THREE, currentViewState.turtles, currentViewState.links);
        label.textContent = threeStatusText(currentViewState);
        draw();
      }

      function applyThreeObserverCamera(viewState) {
        const key = threeObserverCameraKey(viewState.observer);
        if (!key || key === state.threeObserverCameraKey) {
          return;
        }

        const observerControls = threeObserverCameraControls(viewState.observer, baseTarget, span);
        if (!observerControls) {
          return;
        }

        controls.theta = observerControls.theta;
        controls.phi = observerControls.phi;
        controls.radius = typeof state.threeManualRadius === "number" && Number.isFinite(state.threeManualRadius)
          ? clampThreeRadius(Number(state.threeManualRadius))
          : observerControls.radius;
        controls.targetX = observerControls.targetX;
        controls.targetY = observerControls.targetY;
        controls.targetZ = observerControls.targetZ;
        state.threeCamera = { ...controls };
        state.threeObserverCameraKey = key;
      }

      function clampThreeRadius(value) {
        return Math.max(span * 0.35, Math.min(span * 8, Number(value) || span * 1.9));
      }

      function panThreeCamera(dx, dy, start) {
        updateCamera();
        camera.updateMatrixWorld();
        const right = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 0);
        const up = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 1);
        const scale = controls.radius / Math.max(1, host.clientHeight) * 1.65;
        const pan = right.multiplyScalar(-dx * scale).add(up.multiplyScalar(dy * scale));
        controls.targetX = start.targetX + pan.x;
        controls.targetY = start.targetY + pan.y;
        controls.targetZ = start.targetZ + pan.z;
      }

      function toggleThreeFullscreen(targetHost) {
        if (document.fullscreenElement === targetHost) {
          document.exitFullscreen?.().finally?.(() => draw());
          return;
        }
        if (targetHost.classList.contains("fullscreen-fallback")) {
          targetHost.classList.remove("fullscreen-fallback");
          draw();
          return;
        }
        if (targetHost.requestFullscreen) {
          const request = targetHost.requestFullscreen();
          request?.then?.(() => draw());
          request?.catch?.(() => {
            targetHost.classList.add("fullscreen-fallback");
            draw();
          });
          return;
        }
        targetHost.classList.add("fullscreen-fallback");
        draw();
      }

      function inspectThreeObject(event) {
        const rect = renderer.domElement.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) {
          return;
        }

        pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        pointer.y = -(((event.clientY - rect.top) / rect.height) * 2 - 1);
        raycaster.setFromCamera(pointer, camera);
        const hit = raycaster.intersectObjects(pickables, false)[0];
        label.textContent = hit ? describeThreeHit(hit) : threeStatusText(currentViewState);
        renderThreeInspector(inspector, hit);
      }
    }

    function renderThreeControls() {
      return node("div", "three-controls", [
        threeControlButton("orbit", "Orbit", "Orbit camera", state.threeInteractionMode === "orbit"),
        threeControlButton("zoom", "Zoom", "Drag to zoom", state.threeInteractionMode === "zoom"),
        threeControlButton("move", "Move", "Drag to pan camera", state.threeInteractionMode === "move"),
        threeControlButton("home", "⌂", "Reset camera"),
        threeControlButton("top", "T", "Top view"),
        threeControlButton("front", "F", "Front view"),
        threeControlButton("side", "S", "Side view"),
        threeControlButton("fullscreen", "Full", "Toggle full screen"),
        threeControlButton("background", state.threeBackground === "dark" ? "◐" : "◑", "Toggle background", true)
      ]);
    }

    function threeControlButton(action, label, title, active) {
      const button = node("button", "three-control-button" + (active ? " active" : ""), label);
      button.type = "button";
      button.title = title;
      button.setAttribute("aria-label", title);
      button.dataset.action = action;
      return button;
    }

    function updateThreeControlsActive(container) {
      for (const button of container.querySelectorAll("button[data-action]")) {
        const action = button.dataset.action;
        if (["orbit", "zoom", "move"].includes(action)) {
          button.classList.toggle("active", action === state.threeInteractionMode);
        } else if (action === "background") {
          button.textContent = state.threeBackground === "dark" ? "◐" : "◑";
        }
      }
    }

    function updateThreeTheme(scene, worldBox, controlsBar, THREE) {
      const theme = threeTheme();
      scene.background = new THREE.Color(theme.background);
      if (worldBox?.material?.color) {
        worldBox.material.color.setHex(theme.box);
      }
      updateThreeControlsActive(controlsBar);
    }

    function threeStatusText(viewState) {
      const turtleCount = displayThreeCoverage(viewState.turtleCount, viewState.turtles.length);
      const linkCount = displayThreeCoverage(viewState.linkCount, viewState.links.length);
      const patchCount = displayThreeCoverage(viewState.patchCount, threePatchSource(viewState).length);
      const drawingLineCount = displayThreeCount(viewState.drawingLineCount, viewState.drawingLines?.length ?? 0);
      const parts = [turtleCount + " turtles"];
      if (linkCount !== "0") {
        parts.push(linkCount + " links");
      }
      if (patchCount !== "0") {
        parts.push(patchCount + " patches");
      }
      if (drawingLineCount !== "0") {
        parts.push(drawingLineCount + " trails");
      }
      return parts.join(" · ");
    }

    function displayThreeCoverage(total, rendered) {
      const numericTotal = Number(total);
      return Number.isFinite(numericTotal) && numericTotal > rendered
        ? displayThreeCount(rendered, rendered) + " / " + displayThreeCount(numericTotal, rendered)
        : displayThreeCount(total, rendered);
    }

    function displayThreeCount(total, rendered) {
      const numericTotal = Number(total);
      const count = Number.isFinite(numericTotal) ? numericTotal : rendered;
      return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(count);
    }

    function threeTheme() {
      return state.threeBackground === "light"
        ? { background: 0xf7f7f4, box: 0xb8bcc6 }
        : { background: 0x000000, box: 0x8f929a };
    }

    function cameraPose(pose, span, baseTarget, observer) {
      const radius = state.threeCamera?.radius ?? span * 1.9;
      const targetX = pose === "home" ? baseTarget.x : state.threeCamera?.targetX ?? baseTarget.x;
      const targetY = pose === "home" ? baseTarget.y : state.threeCamera?.targetY ?? baseTarget.y;
      const targetZ = pose === "home" ? baseTarget.z : state.threeCamera?.targetZ ?? baseTarget.z;
      switch (pose) {
        case "top":
          return { theta: 0, phi: 0.08, radius, targetX, targetY, targetZ };
        case "front":
          return { theta: 0, phi: Math.PI / 2, radius, targetX, targetY, targetZ };
        case "side":
          return { theta: Math.PI / 2, phi: Math.PI / 2, radius, targetX, targetY, targetZ };
        default:
          return threeObserverCameraControls(observer, baseTarget, span)
            ?? { theta: Math.PI / 4, phi: Math.PI / 3, radius: span * 1.9, targetX: baseTarget.x, targetY: baseTarget.y, targetZ: baseTarget.z };
      }
    }

    function threeObserverCameraControls(observer, baseTarget, span) {
      if (!observer) {
        return undefined;
      }

      const x = Number(observer.x);
      const y = Number(observer.y);
      const z = Number(observer.z);
      if (![x, y, z].every(Number.isFinite)) {
        return undefined;
      }

      const dx = x - baseTarget.x;
      const dy = z - baseTarget.y;
      const dz = y - baseTarget.z;
      const radius = Math.hypot(dx, dy, dz);
      if (radius <= 0.001) {
        return undefined;
      }

      return {
        theta: Math.atan2(dx, dz),
        phi: Math.acos(clampNumber(dy / radius, -1, 1)),
        radius: Math.max(span * 0.35, Math.min(span * 8, radius)),
        targetX: baseTarget.x,
        targetY: baseTarget.y,
        targetZ: baseTarget.z
      };
    }

    function threeObserverCameraKey(observer) {
      if (!observer) {
        return "";
      }
      const x = Number(observer.x);
      const y = Number(observer.y);
      const z = Number(observer.z);
      if (![x, y, z].every(Number.isFinite)) {
        return "";
      }
      return [x, y, z].map(value => value.toFixed(4)).join("|");
    }

    function sameThreeBounds(left, right) {
      return Boolean(left && right)
        && left.minX === right.minX
        && left.maxX === right.maxX
        && left.minY === right.minY
        && left.maxY === right.maxY
        && left.minZ === right.minZ
        && left.maxZ === right.maxZ;
    }

    function threeCameraClipping(position, center, spanX, spanY, spanZ) {
      const radius = Math.hypot(spanX, spanY, spanZ) / 2;
      const distance = Math.hypot(position.x - center.x, position.y - center.y, position.z - center.z);
      const margin = Math.max(1, radius * 0.05);
      return {
        near: Math.max(0.01, Math.min(spanX, spanY, spanZ) / 1000, distance - radius - margin),
        far: Math.max(distance + radius + margin, margin * 2)
      };
    }

    function geometryDispose(scene) {
      const geometries = new Set();
      const materials = new Set();
      scene.traverse(object => {
        if (object.isInstancedMesh || object.isBatchedMesh) {
          if (object.isBatchedMesh) geometries.add(object.geometry);
          object.dispose();
        }
        if (object.geometry && !geometries.has(object.geometry)) {
          geometries.add(object.geometry);
          object.geometry.dispose();
        }
        if (object.material) {
          for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
            if (!materials.has(material)) {
              materials.add(material);
              disposeThreeMaterial(material);
            }
          }
        }
      });
    }

    function disposeThreeMaterial(material) {
      if (material.map) {
        material.map.dispose();
      }
      material.dispose();
    }

    function addThreeWorldBox(scene, THREE, bounds) {
      const theme = threeTheme();
      const box = threeWorldEdgeBounds(THREE, bounds);
      const helper = new THREE.Box3Helper(box, 0x4d4658);
      helper.material.color.setHex(theme.box);
      scene.add(helper);
      return helper;
    }

    function threeWorldEdgeBounds(THREE, bounds) {
      return new THREE.Box3(
        new THREE.Vector3(bounds.minX - 0.5, bounds.minZ - 0.5, bounds.minY - 0.5),
        new THREE.Vector3(bounds.maxX + 0.5, bounds.maxZ + 0.5, bounds.maxY + 0.5)
      );
    }

    function addThreeLights(scene, THREE) {
      // NetLogo's fixed-function GL lights specify diffuse reflectance directly;
      // Three.js Lambert materials divide irradiance by PI.
      const irradianceScale = Math.PI;
      scene.add(new THREE.AmbientLight(0xffffff, 0.7 * irradianceScale));
      const keyLight = new THREE.DirectionalLight(0xffffff, 0.35 * irradianceScale);
      keyLight.position.set(-1, 0.4, -0.3);
      scene.add(keyLight);
      const fillLight = new THREE.DirectionalLight(0xffffff, 0.35 * irradianceScale);
      fillLight.position.set(1, -0.5, 0.6);
      scene.add(fillLight);
    }

    function addThreeTurtles(scene, THREE, turtles, pickables, opaqueOnly = false) {
      const active = new Set();
      const groups = new Map();
      for (const turtle of turtles) {
        if (turtle.hidden || Number(turtle.size) === 0 || threeOpacity(turtle) === 0
          || (opaqueOnly && threeOpacity(turtle) < 1)) {
          continue;
        }
        const geometryKey = turtleGeometryKey(turtle.shape);
        const opacity = threeOpacity(turtle);
        const key = geometryKey + "|" + opacity;
        const group = groups.get(key) ?? { key, geometryKey, opacity, items: [] };
        group.items.push(turtle);
        groups.set(key, group);
      }

      const baseDirection = new THREE.Vector3(0, 1, 0);
      const matrix = new THREE.Matrix4();
      const position = new THREE.Vector3();
      const scale = new THREE.Vector3();
      const quaternion = new THREE.Quaternion();
      const rollRotation = new THREE.Quaternion();
      const color = new THREE.Color();

      for (const group of [...groups.values()].sort((a, b) => a.key.localeCompare(b.key))) {
        if (group.geometryKey === "line") {
          addThreeLineTurtleGroup(scene, THREE, group, pickables, active);
          continue;
        }
        for (let start = 0; start < group.items.length; start += THREE_INSTANCE_CHUNK_SIZE) {
          const chunk = group.items.slice(start, start + THREE_INSTANCE_CHUNK_SIZE);
          const key = group.key + "|" + start;
          active.add(key);
          const mesh = threeInstanceBatch(scene, THREE, key, chunk.length, group.opacity,
            () => turtleGeometryForKey(THREE, group.geometryKey), false);
          mesh.userData = { kind: "turtle", items: chunk };

          chunk.forEach((turtle, index) => {
            const rawSize = Number(turtle.size);
            const size = Number.isFinite(rawSize) && rawSize > 0 ? Math.max(0.01, rawSize) : 1;
            position.set(turtle.x, turtle.z, turtle.y);
            const direction = turtleDirection(THREE, turtle.heading, turtle.pitch);
            quaternion.setFromUnitVectors(baseDirection, direction);
            quaternion.multiply(rollRotation.setFromAxisAngle(baseDirection, -(Number(turtle.roll) || 0) * Math.PI / 180));
            scale.set(size, size, size);
            matrix.compose(position, quaternion, scale);
            mesh.setMatrixAt(index, matrix);
            mesh.setColorAt(index, color.setHex(threeColorHex(turtle)));
          });
          finishThreeInstanceBatch(mesh);
          pickables.push(mesh);
        }
      }
      pruneThreeBatches(scene, active);
    }

    function addThreeLineTurtleGroup(scene, THREE, group, pickables, active) {
      const key = group.key;
      active.add(key);
      const batches = threeBatches(scene);
      let lines = batches.get(key);
      const count = group.items.length * 2;
      if (!lines || lines.geometry.getAttribute("position").count < count) {
        if (lines) {
          geometryDispose(lines);
          scene.remove(lines);
        }
        const capacity = Math.pow(2, Math.ceil(Math.log2(Math.max(64, count))));
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(capacity * 3), 3).setUsage(THREE.DynamicDrawUsage));
        geometry.setAttribute("color", new THREE.BufferAttribute(new Float32Array(capacity * 3), 3).setUsage(THREE.DynamicDrawUsage));
        const material = new THREE.LineBasicMaterial({
          vertexColors: true, transparent: group.opacity < 1, opacity: group.opacity, depthWrite: group.opacity >= 1
        });
        lines = new THREE.LineSegments(geometry, material);
        lines.renderOrder = 2;
        batches.set(key, lines);
        scene.add(lines);
      }
      const positions = lines.geometry.getAttribute("position").array;
      const colors = lines.geometry.getAttribute("color").array;
      const position = new THREE.Vector3();
      const endpoint = new THREE.Vector3();
      const color = new THREE.Color();
      let cursor = 0;

      for (const turtle of group.items) {
        const rawSize = Number(turtle.size);
        const halfLength = (Number.isFinite(rawSize) && rawSize > 0 ? Math.max(0.01, rawSize) : 1) * 0.5;
        position.copy(netLogoVector(THREE, turtle.x, turtle.y, turtle.z));
        const direction = turtleDirection(THREE, turtle.heading, turtle.pitch).multiplyScalar(halfLength);
        color.setHex(threeColorHex(turtle));
        color.toArray(colors, cursor);
        color.toArray(colors, cursor + 3);
        endpoint.copy(position).sub(direction);
        positions[cursor++] = endpoint.x;
        positions[cursor++] = endpoint.y;
        positions[cursor++] = endpoint.z;
        endpoint.copy(position).add(direction);
        positions[cursor++] = endpoint.x;
        positions[cursor++] = endpoint.y;
        positions[cursor++] = endpoint.z;
      }

      lines.geometry.setDrawRange(0, count);
      for (const name of ["position", "color"]) {
        const attribute = lines.geometry.getAttribute(name);
        attribute.clearUpdateRanges();
        attribute.addUpdateRange(0, cursor);
        attribute.needsUpdate = true;
      }
      lines.geometry.computeBoundingSphere();
      lines.userData = { kind: "turtle", items: group.items, lineItems: true };
      pickables.push(lines);
    }

    function turtleGeometryKey(shape) {
      const normalized = String(shape ?? "").trim().toLowerCase();
      if (["circle", "dot", "sphere"].includes(normalized)) {
        return "sphere";
      }
      if (["box", "cube", "square"].includes(normalized)) {
        return "box";
      }
      if (normalized === "line") {
        return "line";
      }
      if (normalized === "cylinder") {
        return "cylinder";
      }
      return "cone";
    }

    function turtleGeometryForKey(THREE, key) {
      switch (key) {
        case "sphere":
          return new THREE.SphereGeometry(0.42, 16, 12);
        case "box":
          return new THREE.BoxGeometry(0.78, 0.78, 0.78);
        case "cylinder":
          return new THREE.CylinderGeometry(0.08, 0.08, 0.95, 8);
        default:
          return new THREE.ConeGeometry(0.28, 0.9, 12);
      }
    }

    function threeBatches(scene) {
      return scene.userData.threeBatches ?? (scene.userData.threeBatches = new Map());
    }

    function threeInstanceBatch(scene, THREE, key, count, opacity, createGeometry, patch) {
      const batches = threeBatches(scene);
      let mesh = batches.get(key);
      if (!mesh || mesh.instanceMatrix.count < count) {
        const capacity = Math.min(THREE_INSTANCE_CHUNK_SIZE, Math.pow(2, Math.ceil(Math.log2(Math.max(64, count)))));
        const geometry = mesh?.geometry ?? createGeometry();
        const material = mesh?.material ?? new THREE.MeshLambertMaterial({
          color: 0xffffff,
          side: THREE.FrontSide,
          transparent: opacity < 1,
          opacity,
          depthWrite: opacity >= 1,
          // Give coincident trails/agents precedence without moving patch coordinates.
          polygonOffset: patch,
          polygonOffsetFactor: patch ? 1 : 0,
          polygonOffsetUnits: patch ? 1 : 0
        });
        if (mesh) {
          mesh.dispose();
          scene.remove(mesh);
        }
        mesh = new THREE.InstancedMesh(geometry, material, capacity);
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3).setUsage(THREE.DynamicDrawUsage);
        mesh.renderOrder = patch ? 0 : 2;
        batches.set(key, mesh);
        scene.add(mesh);
      }
      mesh.count = count;
      return mesh;
    }

    function finishThreeInstanceBatch(mesh, bounds) {
      for (const attribute of [mesh.instanceMatrix, mesh.instanceColor]) {
        attribute.clearUpdateRanges();
        attribute.addUpdateRange(0, mesh.count * attribute.itemSize);
        attribute.needsUpdate = true;
      }
      // Three.js does not automatically refresh these after instance transforms change.
      if (bounds) {
        mesh.boundingBox = bounds;
      } else {
        mesh.computeBoundingBox();
      }
      if (!mesh.geometry.boundingSphere) mesh.geometry.computeBoundingSphere();
      mesh.boundingSphere = mesh.boundingBox.getBoundingSphere(mesh.boundingSphere ?? mesh.geometry.boundingSphere.clone());
    }

    function pruneThreeBatches(scene, active) {
      for (const [key, object] of threeBatches(scene)) {
        if (!active.has(key)) {
          geometryDispose(object);
          scene.remove(object);
          threeBatches(scene).delete(key);
        }
      }
    }

    function threePatchSource(viewState) {
      const bytes = threeDrawingBytes(viewState.patchData);
      if (!bytes) {
        const patches = viewState.patches ?? [];
        return {
          length: patches.length,
          x: index => patches[index].x, y: index => patches[index].y, z: index => patches[index].z,
          alpha: index => Math.round(threeOpacity(patches[index]) * 255),
          color: index => threeColorHex(patches[index]), item: index => patches[index]
        };
      }
      if (bytes.byteLength % 24 !== 0 || bytes.byteLength / 24 !== viewState.patchCount) {
        throw new Error("Invalid packed NetLogo patches.");
      }
      const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      return {
        length: bytes.byteLength / 24,
        x: index => data.getInt32(index * 24, false),
        y: index => data.getInt32(index * 24 + 4, false),
        z: index => data.getInt32(index * 24 + 8, false),
        alpha: index => data.getUint8(index * 24 + 20),
        color: index => data.getUint32(index * 24 + 20, false) & 0xffffff,
        item: index => {
          const offset = index * 24;
          const color = data.getFloat64(offset + 12, false);
          return {
            x: data.getInt32(offset, false), y: data.getInt32(offset + 4, false), z: data.getInt32(offset + 8, false),
            color: Number.isFinite(color) ? color : undefined, alpha: data.getUint8(offset + 20),
            colorRgb: { red: data.getUint8(offset + 21), green: data.getUint8(offset + 22), blue: data.getUint8(offset + 23) }
          };
        }
      };
    }

    function sameThreeBytes(left, right) {
      const a = threeDrawingBytes(left);
      const b = threeDrawingBytes(right);
      if (!a || !b || a.byteLength !== b.byteLength) {
        return false;
      }
      for (let index = 0; index < a.length; index += 1) {
        if (a[index] !== b[index]) {
          return false;
        }
      }
      return true;
    }

    function threePatchGroups(patches, bounds) {
      const width = bounds.maxX - bounds.minX + 1;
      const height = bounds.maxY - bounds.minY + 1;
      const plane = width * height;
      const volume = plane * (bounds.maxZ - bounds.minZ + 1);
      const idAt = (x, y, z) => x - bounds.minX + (y - bounds.minY) * width + (z - bounds.minZ) * plane;
      // A dense occupancy map is faster for voxel worlds; sparse worlds retain
      // a set so a huge, mostly empty world cannot trigger a huge allocation.
      const dense = volume <= 16 * 1024 * 1024 && volume <= Math.max(65536, patches.length * 32)
        ? new Uint8Array(volume) : null;
      const opaque = dense ? null : new Set();
      const isOpaque = dense ? id => dense[id] === 1 : id => opaque.has(id);
      for (let index = 0; index < patches.length; index += 1) {
        if (patches.alpha(index) === 255) {
          const id = idAt(patches.x(index), patches.y(index), patches.z(index));
          if (dense) dense[id] = 1;
          else opaque.add(id);
        }
      }
      const groups = new Map();
      for (let index = 0; index < patches.length; index += 1) {
        const alpha = patches.alpha(index);
        if (alpha === 0) {
          continue;
        }
        const x = patches.x(index), y = patches.y(index), z = patches.z(index);
        const id = idAt(x, y, z);
        // BoxGeometry face order in the viewer's x/z/y coordinate system.
        const mask = alpha < 255 ? 63
          : (x === bounds.maxX || !isOpaque(id + 1) ? 1 : 0)
            | (x === bounds.minX || !isOpaque(id - 1) ? 2 : 0)
            | (z === bounds.maxZ || !isOpaque(id + plane) ? 4 : 0)
            | (z === bounds.minZ || !isOpaque(id - plane) ? 8 : 0)
            | (y === bounds.maxY || !isOpaque(id + width) ? 16 : 0)
            | (y === bounds.minY || !isOpaque(id - width) ? 32 : 0);
        if (mask === 0) {
          continue;
        }
        const key = mask + "|" + alpha;
        const group = groups.get(key) ?? { key, mask, opacity: alpha / 255, items: [] };
        group.items.push(index);
        groups.set(key, group);
      }
      return groups;
    }

    function threePatchGeometry(THREE, mask) {
      const geometry = new THREE.BoxGeometry(1, 1, 1);
      const indices = [];
      geometry.groups.forEach((group, face) => {
        if (mask & (1 << face)) {
          for (let index = group.start; index < group.start + group.count; index += 1) {
            indices.push(geometry.index.getX(index));
          }
        }
      });
      geometry.clearGroups();
      geometry.setIndex(indices);
      return geometry;
    }

    function addThreePatches(scene, THREE, viewState, pickables, opaqueOnly = false) {
      if (viewState.patchData && scene.userData.opaqueOnly === opaqueOnly && sameThreeBytes(scene.userData.patchData, viewState.patchData)) {
        scene.userData.patchData = viewState.patchData;
        pickables.push(...threeBatches(scene).values());
        return;
      }
      const patches = threePatchSource(viewState);
      const groups = threePatchGroups(patches, viewState.bounds);
      const active = new Set();
      const matrix = new THREE.Matrix4();
      const color = new THREE.Color();
      let instances = 0;
      let faces = 0;
      for (const group of groups.values()) {
        if (opaqueOnly && group.opacity < 1) continue;
        for (let start = 0; start < group.items.length; start += THREE_INSTANCE_CHUNK_SIZE) {
          const chunk = group.items.slice(start, start + THREE_INSTANCE_CHUNK_SIZE);
          const key = group.key + "|" + start;
          active.add(key);
          const mesh = threeInstanceBatch(scene, THREE, key, chunk.length, group.opacity,
            () => threePatchGeometry(THREE, group.mask), true);
          const bounds = new THREE.Box3();
          const position = new THREE.Vector3();
          chunk.forEach((patchIndex, index) => {
            position.set(patches.x(patchIndex), patches.z(patchIndex), patches.y(patchIndex));
            bounds.expandByPoint(position);
            matrix.makeTranslation(position.x, position.y, position.z);
            mesh.setMatrixAt(index, matrix);
            mesh.setColorAt(index, color.setHex(patches.color(patchIndex)));
          });
          finishThreeInstanceBatch(mesh, bounds.expandByScalar(0.5));
          mesh.userData = { kind: "patch", itemAt: index => patches.item(chunk[index]) };
          pickables.push(mesh);
          instances += chunk.length;
          faces += chunk.length * mesh.geometry.index.count / 6;
        }
      }
      pruneThreeBatches(scene, active);
      scene.userData.patchData = viewState.patchData;
      scene.userData.opaqueOnly = opaqueOnly;
      scene.userData.patchStats = { patches: patches.length, instances, faces };
    }

    function threeDistanceSquared(center, camera) {
      return (center.x - camera.position.x) ** 2 + (center.y - camera.position.y) ** 2
        + (center.z - camera.position.z) ** 2;
    }

    function threeTransparentObjectOrder(a, b, camera) {
      const center = object => object.userData.transparentCenter ?? {
        x: object.matrixWorld.elements[12], y: object.matrixWorld.elements[13], z: object.matrixWorld.elements[14]
      };
      return a.groupOrder - b.groupOrder
        || threeDistanceSquared(center(b.object), camera) - threeDistanceSquared(center(a.object), camera)
        || a.id - b.id;
    }

    function threeTransparentEntries(layer, viewState) {
      const entries = [];
      for (const turtle of viewState.turtles) {
        const alpha = threeOpacity(turtle);
        if (!turtle.hidden && Number(turtle.size) !== 0 && alpha > 0 && alpha < 1) {
          entries.push({ kind: "turtle", key: "turtle|" + turtle.who, geometry: turtleGeometryKey(turtle.shape),
            item: turtle, center: { x: turtle.x, y: turtle.z, z: turtle.y } });
        }
      }
      if (!viewState.patchData || !sameThreeBytes(layer.userData.patchData, viewState.patchData)) {
        const patches = threePatchSource(viewState);
        const transparentPatches = [];
        for (let index = 0; index < patches.length; index += 1) {
          const alpha = patches.alpha(index);
          if (alpha > 0 && alpha < 255) {
            const patch = patches.item(index);
            transparentPatches.push({ kind: "patch", key: "patch|" + patch.x + "|" + patch.y + "|" + patch.z,
              geometry: "patch", item: patch, center: { x: patch.x, y: patch.z, z: patch.y } });
          }
        }
        layer.userData.patchEntries = transparentPatches;
        layer.userData.patchData = viewState.patchData;
      }
      for (const patch of layer.userData.patchEntries ?? []) entries.push(patch);
      if (viewState.links.length) {
        const turtles = new Map(viewState.turtles.map(turtle => [turtle.who, turtle]));
        for (const [index, link] of viewState.links.entries()) {
          const alpha = threeOpacity(link);
          const a = turtles.get(link.end1), b = turtles.get(link.end2);
          if (!link.hidden && alpha > 0 && alpha < 1 && a && b) {
            entries.push({ kind: "link", key: "link|" + index, geometry: "line", item: link,
              center: { x: (a.x + b.x) / 2, y: (a.z + b.z) / 2, z: (a.y + b.y) / 2 } });
          }
        }
      }
      return entries;
    }

    function addThreeTransparency(layer, THREE, viewState, pickables, forceIndividual = false) {
      const entries = threeTransparentEntries(layer, viewState);
      // Meshes share one RGBA batch, sorted globally rather than per color/shape.
      // Lines and labels need to interleave with meshes: keep the native per-agent
      // draw order in that case instead of incorrectly drawing one entire batch first.
      const hasLabel = agent => !agent.hidden && String(agent.label ?? "").length > 0;
      const individual = forceIndividual || entries.some(entry => entry.geometry === "line")
        || viewState.turtles.some(hasLabel) || viewState.links.some(hasLabel);
      const mode = entries.length === 0 ? "empty" : individual ? "individual" : "batched";
      if (layer.userData.mode !== mode) {
        geometryDispose(layer);
        layer.clear();
        layer.userData.mesh = null;
        layer.userData.objects = new Map();
        layer.userData.mode = mode;
      }
      layer.userData.entries = entries;
      if (!entries.length) return;

      if (individual) {
        const objects = layer.userData.objects;
        const active = new Set();
        for (const entry of entries) {
          active.add(entry.key);
          let group = objects.get(entry.key);
          if (!group) {
            group = new THREE.Group();
            objects.set(entry.key, group);
            layer.add(group);
          }
          if (entry.kind === "turtle") {
            addThreeTurtles(group, THREE, [entry.item], pickables);
          } else if (entry.kind === "patch") {
            // An individual translucent cube retains all faces; do not allocate
            // a whole-world occupancy map for every cube in this fallback.
            const patch = entry.item;
            addThreePatches(group, THREE, { bounds: { minX: patch.x, maxX: patch.x,
              minY: patch.y, maxY: patch.y, minZ: patch.z, maxZ: patch.z }, patches: [patch] }, pickables);
          } else {
            geometryDispose(group);
            group.clear();
            addThreeLinks(group, THREE, [entry.item], viewState.turtles, pickables);
          }
          group.traverse(object => {
            if (object.material) {
              object.userData.transparentCenter = entry.center;
              object.material.depthWrite = true;
              object.material.side = THREE.FrontSide;
              object.material.polygonOffset = false;
              object.renderOrder = 0;
            }
          });
        }
        for (const [key, object] of objects) {
          if (!active.has(key)) {
            geometryDispose(object);
            layer.remove(object);
            objects.delete(key);
          }
        }
        return;
      }

      let mesh = layer.userData.mesh;
      const capacity = Math.pow(2, Math.ceil(Math.log2(Math.max(64, entries.length))));
      if (!mesh) {
        const geometries = new Map(["patch", "box", "sphere", "cone", "cylinder"].map(key => [key,
          key === "patch" ? new THREE.BoxGeometry(1, 1, 1) : turtleGeometryForKey(THREE, key)]));
        const vertices = [...geometries.values()].reduce((sum, geometry) => sum + geometry.getAttribute("position").count, 0);
        const indices = [...geometries.values()].reduce((sum, geometry) => sum + geometry.index.count, 0);
        const material = new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true,
          side: THREE.FrontSide, depthWrite: true });
        mesh = new THREE.BatchedMesh(capacity, vertices, indices, material);
        mesh.userData.geometryIds = new Map();
        for (const [key, geometry] of geometries) {
          mesh.userData.geometryIds.set(key, mesh.addGeometry(geometry));
          geometry.dispose();
        }
        mesh.userData.capacity = capacity;
        mesh.userData.instanceCount = 0;
        mesh.userData.itemAt = index => mesh.userData.entries[index]?.item;
        mesh.userData.kindAt = index => mesh.userData.entries[index]?.kind;
        mesh.setCustomSort((list, camera) => {
          for (const item of list) item.z = threeDistanceSquared(mesh.userData.entries[item.index].center, camera);
          list.sort((a, b) => b.z - a.z || a.index - b.index);
        });
        mesh.frustumCulled = false; // BatchedMesh performs per-instance culling.
        layer.userData.mesh = mesh;
        layer.add(mesh);
      } else if (capacity > mesh.userData.capacity) {
        mesh.setInstanceCount(capacity);
        mesh.userData.capacity = capacity;
      }
      mesh.userData.entries = entries;
      const matrix = new THREE.Matrix4(), position = new THREE.Vector3(), scale = new THREE.Vector3();
      const baseDirection = new THREE.Vector3(0, 1, 0), quaternion = new THREE.Quaternion(), roll = new THREE.Quaternion();
      const color = new THREE.Color(), rgba = new THREE.Vector4();
      entries.forEach((entry, index) => {
        const geometry = mesh.userData.geometryIds.get(entry.geometry);
        if (index >= mesh.userData.instanceCount) {
          mesh.addInstance(geometry);
          mesh.userData.instanceCount += 1;
        } else {
          mesh.setGeometryIdAt(index, geometry);
          mesh.setVisibleAt(index, true);
        }
        const item = entry.item;
        if (entry.kind === "patch") {
          matrix.makeTranslation(entry.center.x, entry.center.y, entry.center.z);
        } else {
          const size = Math.max(0.01, Number(item.size) || 1);
          position.set(entry.center.x, entry.center.y, entry.center.z);
          quaternion.setFromUnitVectors(baseDirection, turtleDirection(THREE, item.heading, item.pitch));
          quaternion.multiply(roll.setFromAxisAngle(baseDirection, -(Number(item.roll) || 0) * Math.PI / 180));
          matrix.compose(position, quaternion, scale.setScalar(size));
        }
        mesh.setMatrixAt(index, matrix);
        color.setHex(threeColorHex(item));
        mesh.setColorAt(index, rgba.set(color.r, color.g, color.b, threeOpacity(item)));
      });
      for (let index = entries.length; index < mesh.userData.instanceCount; index += 1) mesh.setVisibleAt(index, false);
      pickables.push(mesh);
    }

    function forEachThreeChunk(items, size, visit) {
      for (let start = 0; start < items.length; start += size) {
        visit(items.slice(start, start + size));
      }
    }

    function addThreeLinks(scene, THREE, links, turtles, pickables, opaqueOnly = false) {
      if (!links.length) {
        return;
      }

      const turtleByWho = new Map();
      for (const turtle of turtles) {
        turtleByWho.set(turtle.who, turtle);
      }

      for (const link of links) {
        if (link.hidden || threeOpacity(link) === 0 || (opaqueOnly && threeOpacity(link) < 1)) {
          continue;
        }
        const end1 = turtleByWho.get(link.end1);
        const end2 = turtleByWho.get(link.end2);
        if (!end1 || !end2) {
          continue;
        }

        const color = threeColorHex(link);
        const opacity = threeOpacity(link);
        const material = new THREE.LineBasicMaterial({
          color,
          linewidth: Math.max(1, link.thickness || 1),
          transparent: opacity < 1,
          opacity,
          depthWrite: opacity >= 1
        });
        const start = netLogoVector(THREE, end1.x, end1.y, end1.z);
        const end = netLogoVector(THREE, end2.x, end2.y, end2.z);
        const geometry = new THREE.BufferGeometry().setFromPoints([
          start,
          end
        ]);
        const line = new THREE.Line(geometry, material);
        line.userData = { kind: "link", item: link };
        scene.add(line);
        pickables.push(line);

        if (link.directed) {
          addThreeLinkArrow(scene, THREE, start, end, color, opacity, Math.max(0.45, link.thickness || 1));
        }
      }
    }

    function addThreeLinkArrow(scene, THREE, start, end, color, opacity, size) {
      const direction = new THREE.Vector3().subVectors(end, start);
      const length = direction.length();
      if (length <= 0.001) {
        return;
      }

      direction.normalize();
      const position = end.clone().addScaledVector(direction, -Math.min(0.45, length * 0.22));
      const geometry = new THREE.ConeGeometry(0.16 * size, 0.42 * size, 10);
      const material = new THREE.MeshLambertMaterial({
        color,
        side: THREE.DoubleSide,
        transparent: opacity < 1,
        opacity,
        depthWrite: opacity >= 1
      });
      const arrow = new THREE.Mesh(geometry, material);
      arrow.position.copy(position);
      arrow.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
      scene.add(arrow);
    }

    function addThreeLabels(scene, THREE, turtles, links) {
      for (const turtle of turtles) {
        if (turtle.hidden || String(turtle.label ?? "").length === 0) {
          continue;
        }
        const position = netLogoVector(THREE, turtle.x, turtle.y, turtle.z);
        position.y += Math.max(0.7, Number(turtle.size) || 1);
        scene.add(threeTextSprite(
          THREE,
          String(turtle.label),
          threeColorHex(turtle, "labelColor", "labelColorRgb"),
          threeOpacity(turtle, "labelAlpha"),
          position
        ));
      }

      if (!links.length) {
        return;
      }

      const turtleByWho = new Map();
      for (const turtle of turtles) {
        turtleByWho.set(turtle.who, turtle);
      }
      for (const link of links) {
        if (link.hidden || String(link.label ?? "").length === 0) {
          continue;
        }
        const end1 = turtleByWho.get(link.end1);
        const end2 = turtleByWho.get(link.end2);
        if (!end1 || !end2) {
          continue;
        }
        const start = netLogoVector(THREE, end1.x, end1.y, end1.z);
        const end = netLogoVector(THREE, end2.x, end2.y, end2.z);
        const position = start.clone().lerp(end, 0.5);
        position.y += 0.35;
        scene.add(threeTextSprite(
          THREE,
          String(link.label),
          threeColorHex(link, "labelColor", "labelColorRgb"),
          threeOpacity(link, "labelAlpha"),
          position
        ));
      }
    }

    function ensureThreeTrailState(bounds, span) {
      const boundsKey = threeBoundsKey(bounds);
      if (!state.threeTrailState || state.threeTrailState.boundsKey !== boundsKey) {
        state.threeTrailState = createThreeTrailState(boundsKey, span);
      } else {
        state.threeTrailState.maxDistance = Math.max(2, span * 0.42);
        state.threeTrailState.maxNewTurtleDistance = Math.max(3, span * 0.24);
      }
      return state.threeTrailState;
    }

    function createThreeTrailState(boundsKey, span) {
      return {
        boundsKey,
        previous: new Map(),
        segments: [],
        source: "turtle",
        maxSegments: 100000,
        maxDistance: Math.max(2, span * 0.42),
        maxNewTurtleDistance: Math.max(3, span * 0.24)
      };
    }

    function updateThreePenTrails(layer, THREE, trailState, viewState) {
      const drawingData = viewState.drawingData;
      if (drawingData && renderThreePackedTrailSegments(layer, THREE, drawingData)) {
        trailState.previous = new Map();
        trailState.source = "drawing-packed";
        trailState.segments = [];
        return;
      }

      const drawingLines = Array.isArray(viewState.drawingLines) ? viewState.drawingLines : [];
      if (drawingLines.length) {
        trailState.previous = new Map();
        trailState.source = "drawing";
        trailState.segments = threeDrawingLineSegments(drawingLines, Math.max(trailState.maxSegments, drawingLines.length));
        renderThreeTrailSegments(layer, THREE, trailState.segments);
        return;
      }

      if (trailState.source === "drawing" || trailState.source === "drawing-packed") {
        clearThreeTrailState(layer, trailState);
      }
      trailState.source = "turtle";

      const turtles = viewState.turtles ?? [];
      if (!turtles.length) {
        clearThreeTrailState(layer, trailState);
        return;
      }

      const hasPenDownTurtle = turtles.some(threePenIsDown);
      const sharesPreviousTurtle = turtles.some(turtle => trailState.previous.has(turtle.who));
      if (!hasPenDownTurtle && trailState.segments.length && !sharesPreviousTurtle) {
        clearThreeTrailState(layer, trailState);
      }

      const nextPrevious = new Map();
      for (const turtle of turtles) {
        const point = threeTrailPoint(turtle);
        if (!point) {
          continue;
        }
        const penDown = threePenIsDown(turtle);
        const previous = trailState.previous.get(turtle.who);
        if (previous?.penDown && penDown) {
          const distance = threeTrailDistance(previous.point, point);
          if (distance > 0.001 && distance <= trailState.maxDistance) {
            trailState.segments.push({
              start: previous.point,
              end: point,
              color: threeColorHex(turtle),
              opacity: threeOpacity(turtle)
            });
          }
        } else if (!previous && penDown) {
          const parent = nearestThreeTrailPrevious(point, trailState.previous, trailState.maxNewTurtleDistance);
          if (parent) {
            trailState.segments.push({
              start: parent.point,
              end: point,
              color: threeColorHex(turtle),
              opacity: threeOpacity(turtle)
            });
          }
        }
        nextPrevious.set(turtle.who, { point, penDown });
      }

      trailState.previous = nextPrevious;
      if (trailState.segments.length > trailState.maxSegments) {
        trailState.segments.splice(0, trailState.segments.length - trailState.maxSegments);
      }
      renderThreeTrailSegments(layer, THREE, trailState.segments);
    }

    function renderThreePackedTrailSegments(layer, THREE, data) {
      if (sameThreeBytes(layer.userData.drawingData, data)) {
        return true;
      }
      layer.userData.drawingData = undefined;
      geometryDispose(layer);
      layer.clear();

      const bytes = threeDrawingBytes(data);
      if (!bytes) {
        return false;
      }

      if (bytes.byteLength < 16) {
        return false;
      }
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const magic = view.getUint32(0, false);
      const version = view.getUint32(4, false);
      const headerSize = version === 1 ? 16 : 20;
      const count = version === 1 ? view.getUint32(8, false) : bytes.byteLength >= 20 ? view.getUint32(12, false) : 0;
      const recordSize = version === 1 ? view.getUint32(12, false) : bytes.byteLength >= 20 ? view.getUint32(16, false) : 0;
      if (magic !== 0x4e4c4433 || ![1, 2].includes(version) || recordSize !== 32 || bytes.byteLength < headerSize + count * recordSize) {
        return false;
      }

      const batches = [];
      for (let index = 0; index < count; index += 1) {
        const offset = headerSize + index * recordSize;
        const width = normalizedThreeLineWidth(view.getFloat32(offset + 24, false));
        const alpha = view.getUint8(offset + 28);
        const previous = batches[batches.length - 1];
        if (previous && previous.width === width && previous.alpha === alpha) {
          previous.count += 1;
        } else {
          batches.push({ start: index, count: 1, width, alpha });
        }
      }

      const linearColor = new Uint16Array(256);
      for (let channel = 0; channel < linearColor.length; channel += 1) {
        const srgb = channel / 255;
        const linear = srgb <= 0.04045
          ? srgb / 12.92
          : Math.pow((srgb + 0.055) / 1.055, 2.4);
        linearColor[channel] = Math.round(linear * 65535);
      }

      batches.forEach((batch, batchIndex) => {
        const positions = new Float32Array(batch.count * 6);
        const colors = new Uint16Array(batch.count * 6);
        let positionCursor = 0;
        let colorCursor = 0;
        for (let index = batch.start; index < batch.start + batch.count; index += 1) {
          const offset = headerSize + index * recordSize;
          positions[positionCursor++] = view.getFloat32(offset, false);
          positions[positionCursor++] = view.getFloat32(offset + 8, false);
          positions[positionCursor++] = view.getFloat32(offset + 4, false);
          positions[positionCursor++] = view.getFloat32(offset + 12, false);
          positions[positionCursor++] = view.getFloat32(offset + 20, false);
          positions[positionCursor++] = view.getFloat32(offset + 16, false);
          const red = linearColor[view.getUint8(offset + 29)];
          const green = linearColor[view.getUint8(offset + 30)];
          const blue = linearColor[view.getUint8(offset + 31)];
          colors[colorCursor++] = red;
          colors[colorCursor++] = green;
          colors[colorCursor++] = blue;
          colors[colorCursor++] = red;
          colors[colorCursor++] = green;
          colors[colorCursor++] = blue;
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute("color", new THREE.Uint16BufferAttribute(colors, 3, true));
        const opacity = batch.alpha / 255;
        const material = new THREE.LineBasicMaterial({
          color: 0xffffff,
          vertexColors: true,
          linewidth: batch.width,
          transparent: opacity < 1,
          opacity,
          depthWrite: opacity >= 1
        });
        const lines = new THREE.LineSegments(geometry, material);
        lines.renderOrder = batchIndex;
        layer.add(lines);
      });
      layer.userData.drawingData = data;
      return true;
    }

    function threeDrawingBytes(data) {
      if (data instanceof ArrayBuffer) {
        return new Uint8Array(data);
      }
      if (ArrayBuffer.isView(data)) {
        return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
      }
      if (typeof data !== "string") {
        return undefined;
      }

      try {
        const binary = atob(data);
        const bytes = new Uint8Array(binary.length);
        for (let index = 0; index < binary.length; index += 1) {
          bytes[index] = binary.charCodeAt(index);
        }
        return bytes;
      } catch {
        return undefined;
      }
    }

    function normalizedThreeLineWidth(value) {
      return Math.max(1, Math.round((Number(value) || 1) * 1000) / 1000);
    }

    function threeDrawingLineSegments(lines, maxSegments) {
      const segments = [];
      const start = Math.max(0, lines.length - maxSegments);
      for (let index = start; index < lines.length; index += 1) {
        const line = lines[index];
        const segment = {
          start: {
            x: Number(line.x0),
            y: Number(line.y0),
            z: Number(line.z0)
          },
          end: threeDrawingLineEnd(line),
          color: threeColorHex(line),
          opacity: threeOpacity(line),
          width: Math.max(1, Number(line.width) || 1)
        };
        if (threeTrailPointIsValid(segment.start) && threeTrailPointIsValid(segment.end)) {
          segments.push(segment);
        }
      }
      return segments;
    }

    function threeDrawingLineEnd(line) {
      const fallback = {
        x: Number(line.x1),
        y: Number(line.y1),
        z: Number(line.z1)
      };
      const x0 = Number(line.x0);
      const y0 = Number(line.y0);
      const z0 = Number(line.z0);
      const heading = Number(line.heading);
      const pitch = Number(line.pitch);
      const length = Number(line.length);
      if (![x0, y0, z0, heading, pitch, length].every(Number.isFinite) || length <= 0) {
        return fallback;
      }

      const headingRadians = heading * Math.PI / 180;
      const pitchRadians = pitch * Math.PI / 180;
      const horizontalLength = length * Math.cos(pitchRadians);
      return {
        x: x0 + Math.sin(headingRadians) * horizontalLength,
        y: y0 + Math.cos(headingRadians) * horizontalLength,
        z: z0 + Math.sin(pitchRadians) * length
      };
    }

    function clearThreeTrailState(layer, trailState) {
      trailState.previous = new Map();
      trailState.segments = [];
      trailState.source = "turtle";
      layer.userData.drawingData = undefined;
      geometryDispose(layer);
      layer.clear();
    }

    function renderThreeTrailSegments(layer, THREE, segments) {
      geometryDispose(layer);
      layer.clear();
      if (!segments.length) {
        return;
      }

      const groups = new Map();
      for (const segment of segments) {
        const width = Math.max(1, Number(segment.width) || 1);
        const opacity = Number.isFinite(Number(segment.opacity)) ? clampNumber(Number(segment.opacity), 0, 1) : 1;
        const key = segment.color + "|" + width + "|" + opacity;
        const group = groups.get(key) ?? {
          color: segment.color,
          width,
          opacity,
          positions: []
        };
        const positions = group.positions;
        positions.push(
          segment.start.x, segment.start.z, segment.start.y,
          segment.end.x, segment.end.z, segment.end.y
        );
        groups.set(key, group);
      }

      for (const group of groups.values()) {
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute("position", new THREE.Float32BufferAttribute(group.positions, 3));
        const material = new THREE.LineBasicMaterial({
          color: group.color,
          linewidth: group.width,
          transparent: group.opacity < 1,
          opacity: group.opacity,
          depthWrite: group.opacity >= 1
        });
        layer.add(new THREE.LineSegments(geometry, material));
      }
    }

    function threeTrailPoint(turtle) {
      const x = Number(turtle.x);
      const y = Number(turtle.y);
      const z = Number(turtle.z);
      if (![x, y, z].every(Number.isFinite)) {
        return undefined;
      }
      return { x, y, z };
    }

    function threeTrailPointIsValid(point) {
      return [point.x, point.y, point.z].every(Number.isFinite);
    }

    function threePenIsDown(turtle) {
      return String(turtle.penMode ?? "").trim().toLowerCase() === "down";
    }

    function nearestThreeTrailPrevious(point, previous, maxDistance) {
      let nearest;
      let nearestDistance = maxDistance;
      for (const entry of previous.values()) {
        const distance = threeTrailDistance(entry.point, point);
        if (distance > 0.001 && distance <= nearestDistance) {
          nearest = entry;
          nearestDistance = distance;
        }
      }
      return nearest;
    }

    function threeTrailDistance(left, right) {
      const dx = right.x - left.x;
      const dy = right.y - left.y;
      const dz = right.z - left.z;
      return Math.hypot(dx, dy, dz);
    }

    function threeBoundsKey(bounds) {
      return [
        bounds.minX,
        bounds.maxX,
        bounds.minY,
        bounds.maxY,
        bounds.minZ,
        bounds.maxZ
      ].join("|");
    }

    function threeTextSprite(THREE, text, color, opacity, position) {
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d");
      const fontSize = 28;
      context.font = "600 " + fontSize + "px sans-serif";
      const metrics = context.measureText(text);
      canvas.width = Math.max(64, Math.ceil(metrics.width + 20));
      canvas.height = 42;
      context.font = "600 " + fontSize + "px sans-serif";
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillStyle = "rgba(0, 0, 0, 0.58)";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = "#" + color.toString(16).padStart(6, "0");
      context.fillText(text, canvas.width / 2, canvas.height / 2);

      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      const material = new THREE.SpriteMaterial({ map: texture, transparent: true, opacity });
      const sprite = new THREE.Sprite(material);
      sprite.position.copy(position);
      sprite.scale.set(canvas.width / 28, canvas.height / 28, 1);
      return sprite;
    }

    function describeThreeHit(hit) {
      const object = hit.object;
      const kind = object.userData?.kindAt?.(hit.batchId) ?? object.userData?.kind;
      if (kind === "turtle") {
        const turtle = threeHitItem(hit);
        return turtle
          ? "Turtle " + turtle.who + " · " + pointText(turtle.x, turtle.y, turtle.z) + (turtle.shape ? " · " + turtle.shape : "")
          : "Turtle";
      }
      if (kind === "patch") {
        const patch = threeHitItem(hit);
        return patch ? "Patch · " + pointText(patch.x, patch.y, patch.z) : "Patch";
      }
      if (kind === "link") {
        const link = object.userData.item;
        return link
          ? "Link " + link.end1 + " → " + link.end2 + (link.label ? " · " + link.label : "")
          : "Link";
      }
      return "3D";
    }

    function threeHitItem(hit) {
      const userData = hit.object?.userData;
      if (userData?.item) {
        return userData.item;
      }
      const rawIndex = userData?.lineItems
        ? Math.floor((Number(hit.index) || 0) / 2)
        : (hit.batchId ?? hit.instanceId ?? 0);
      return userData?.itemAt ? userData.itemAt(rawIndex) : userData?.items?.[rawIndex];
    }

    function renderThreeInspector(container, hit) {
      if (!hit) {
        container.hidden = true;
        container.replaceChildren();
        return;
      }

      const details = threeInspectionDetails(hit);
      if (!details) {
        container.hidden = true;
        container.replaceChildren();
        return;
      }

      container.hidden = false;
      container.replaceChildren(
        node("div", "three-inspector-title", details.title),
        ...details.rows.map(row => node("div", "three-inspector-row", [
          node("span", "three-inspector-key", row[0]),
          node("span", "three-inspector-value", row[1])
        ]))
      );
    }

    function threeInspectionDetails(hit) {
      const object = hit.object;
      const kind = object.userData?.kindAt?.(hit.batchId) ?? object.userData?.kind;
      if (kind === "turtle") {
        const turtle = threeHitItem(hit);
        if (!turtle) {
          return undefined;
        }
        return {
          title: "Turtle " + turtle.who,
          rows: compactRows([
            ["xyz", pointText(turtle.x, turtle.y, turtle.z)],
            ["color", formatThreeColor(turtle.color, turtle.colorRgb)],
            ["heading", format3DNumber(turtle.heading)],
            ["pitch", format3DNumber(turtle.pitch)],
            ["shape", turtle.shape || "default"],
            ["size", format3DNumber(turtle.size)],
            ["label", String(turtle.label ?? "")]
          ])
        };
      }
      if (kind === "patch") {
        const patch = threeHitItem(hit);
        if (!patch) {
          return undefined;
        }
        return {
          title: "Patch",
          rows: [
            ["xyz", pointText(patch.x, patch.y, patch.z)],
            ["pcolor", formatThreeColor(patch.color, patch.colorRgb)]
          ]
        };
      }
      if (kind === "link") {
        const link = object.userData.item;
        if (!link) {
          return undefined;
        }
        return {
          title: "Link " + link.end1 + " -> " + link.end2,
          rows: compactRows([
            ["color", formatThreeColor(link.color, link.colorRgb)],
            ["thickness", format3DNumber(link.thickness)],
            ["directed", link.directed ? "true" : "false"],
            ["shape", link.shape || ""],
            ["label", String(link.label ?? "")]
          ])
        };
      }
      return undefined;
    }

    function compactRows(rows) {
      return rows.filter(row => String(row[1] ?? "").length > 0);
    }

    function pointText(x, y, z) {
      return "(" + format3DNumber(x) + ", " + format3DNumber(y) + ", " + format3DNumber(z) + ")";
    }

    function format3DNumber(value) {
      const number = Number(value);
      return Number.isFinite(number) ? number.toFixed(Math.abs(number) < 10 ? 2 : 1).replace(/\.0+$/, "").replace(/(\.\d)0$/, "$1") : "?";
    }

    function formatThreeColor(value, rgb) {
      const label = Number.isFinite(Number(value)) ? format3DNumber(value) : String(value ?? "?");
      return label + " / #" + threeColorHex({ color: value, colorRgb: rgb }).toString(16).padStart(6, "0");
    }

    function netLogoVector(THREE, x, y, z) {
      return new THREE.Vector3(Number(x) || 0, Number(z) || 0, Number(y) || 0);
    }

    function turtleDirection(THREE, heading, pitch) {
      const headingRad = ((Number(heading) || 0) * Math.PI) / 180;
      const pitchRad = ((Number(pitch) || 0) * Math.PI) / 180;
      const cosPitch = Math.cos(pitchRad);
      const direction = new THREE.Vector3(
        Math.sin(headingRad) * cosPitch,
        Math.sin(pitchRad),
        Math.cos(headingRad) * cosPitch
      );
      return direction.normalize();
    }

    function netLogoColorHex(value) {
      const color = Number(value);
      if (!Number.isFinite(color)) {
        return 0x5aa7ff;
      }

      const wrapped = ((color % 140) + 140) % 140;
      const colorIndex = Math.trunc(wrapped * 10);
      if (colorIndex === 0) {
        return 0x000000;
      }
      if (colorIndex === 99) {
        return 0xffffff;
      }

      const rawPalette = [
        [140, 140, 140],
        [215, 48, 39],
        [241, 105, 19],
        [156, 109, 70],
        [237, 237, 47],
        [87, 176, 58],
        [42, 209, 57],
        [27, 158, 119],
        [82, 196, 196],
        [43, 140, 190],
        [50, 92, 168],
        [123, 78, 163],
        [166, 25, 105],
        [224, 126, 149]
      ];
      const rgb = rawPalette[Math.floor(colorIndex / 100)] ?? rawPalette[0];
      const shade = ((colorIndex % 100) - 50) / 50.48 + 0.012;
      const shaded = rgb.map(channel => shade < 0
        ? channel + Math.trunc(channel * shade)
        : channel + Math.trunc((255 - channel) * shade));
      return rgbToHex(shaded[0], shaded[1], shaded[2]);
    }

    function threeColorHex(item, colorKey = "color", rgbKey = "colorRgb") {
      const rgbHex = rgbValueToHex(item?.[rgbKey]);
      return rgbHex ?? netLogoColorHex(item?.[colorKey]);
    }

    function threeOpacity(item, alphaKey = "alpha") {
      const alpha = Number(item?.[alphaKey]);
      return Number.isFinite(alpha) ? clampNumber(alpha / 255, 0, 1) : 1;
    }

    function rgbValueToHex(rgb) {
      if (!rgb) {
        return undefined;
      }
      const red = Number(rgb.red);
      const green = Number(rgb.green);
      const blue = Number(rgb.blue);
      if (![red, green, blue].every(Number.isFinite)) {
        return undefined;
      }
      return rgbToHex(clampRgbChannel(red), clampRgbChannel(green), clampRgbChannel(blue));
    }

    function clampRgbChannel(value) {
      return Math.trunc(clampNumber(value, 0, 255));
    }

    function rgbToHex(red, green, blue) {
      return ((red & 255) << 16) | ((green & 255) << 8) | (blue & 255);
    }

    function renderPlotBody(widget) {
      const runtimePlot = state.plotData[widget.id];
      const configurationDirty = state.dirtyPlotWidgets.has(widget.id);
      const series = plotSeriesForWidget(widget, runtimePlot, configurationDirty);
      const points = series.flatMap(pen => pen.points ?? []);
      const body = node("div", "plot-body" + (points.length > 0 ? " has-runtime" : ""), "");
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("class", "plot-svg");
      svg.setAttribute("viewBox", "0 0 160 120");
      svg.setAttribute("preserveAspectRatio", "none");

      const xDomain = plotDomain(points, widget, runtimePlot, "x", configurationDirty);
      const yDomain = plotDomain(points, widget, runtimePlot, "y", configurationDirty);
      const plotFrame = plotFrameForDomains(xDomain, yDomain);
      renderPlotAxes(svg, plotFrame, xDomain, yDomain, widget);
      const seriesLayer = plotSeriesLayer(svg, plotFrame, widget.id);

      if (points.length === 0) {
        svg.append(svgText("No numeric data", 89, 50, "plot-no-data"));
      } else {
        for (const pen of series) {
          renderPlotSeries(seriesLayer, pen, plotFrame, xDomain, yDomain);
        }
      }

      const legendEnabled = !configurationDirty && typeof runtimePlot?.legend === "boolean"
        ? runtimePlot.legend
        : widget.details?.legend !== false;
      if (legendEnabled) {
        renderPlotLegend(svg, series.filter(pen => pen.inLegend !== false));
      }
      body.append(svg);
      return body;
    }

    function plotSeriesLayer(svg, frame, widgetId) {
      const clipId = "plot-clip-" + String(widgetId ?? "plot").replace(/[^a-zA-Z0-9_-]/g, "-");
      // Keep the full anti-aliased stroke visible when a series coincides with
      // a plot boundary. The series layer is painted after the axes, but a clip
      // that ends exactly on an axis would otherwise discard half of the line.
      const clipPadding = 1;
      const definitions = document.createElementNS("http://www.w3.org/2000/svg", "defs");
      const clipPath = document.createElementNS("http://www.w3.org/2000/svg", "clipPath");
      clipPath.setAttribute("id", clipId);
      clipPath.setAttribute("clipPathUnits", "userSpaceOnUse");
      const clipRect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      clipRect.setAttribute("x", String(frame.left - clipPadding));
      clipRect.setAttribute("y", String(frame.top - clipPadding));
      clipRect.setAttribute("width", String(frame.right - frame.left + clipPadding * 2));
      clipRect.setAttribute("height", String(frame.bottom - frame.top + clipPadding * 2));
      clipPath.append(clipRect);
      definitions.append(clipPath);
      svg.append(definitions);

      const layer = document.createElementNS("http://www.w3.org/2000/svg", "g");
      layer.setAttribute("clip-path", "url(#" + clipId + ")");
      svg.append(layer);
      return layer;
    }

    function plotSeriesForWidget(widget, runtimePlot, configurationDirty) {
      const configuredPens = Array.isArray(widget.details?.pens)
        ? widget.details.pens.filter(pen => pen && typeof pen === "object")
        : [];
      const runtimePens = Array.isArray(runtimePlot?.pens) ? runtimePlot.pens : [];
      if (runtimePens.length === 0) {
        return configuredPens.map(pen => ({ ...pen, points: [] }));
      }

      if (configurationDirty) {
        const usedRuntimePens = new Set();
        return configuredPens.map((configured, index) => {
          let runtimeIndex = runtimePens.findIndex((runtime, candidateIndex) =>
            !usedRuntimePens.has(candidateIndex)
            && String(runtime.name ?? "") === String(configured.name ?? "")
          );
          if (runtimeIndex < 0 && !usedRuntimePens.has(index) && runtimePens[index]) {
            runtimeIndex = index;
          }
          if (runtimeIndex >= 0) {
            usedRuntimePens.add(runtimeIndex);
          }
          const runtime = runtimeIndex >= 0 ? runtimePens[runtimeIndex] : {};
          return {
            ...runtime,
            ...configured,
            points: Array.isArray(runtime.points) ? runtime.points : []
          };
        });
      }

      return runtimePens.map((pen, index) => {
        const configured = configuredPens[index] ?? {};
        return {
          ...configured,
          ...pen,
          inLegend: configured.inLegend !== false,
          points: Array.isArray(pen.points) ? pen.points : []
        };
      });
    }

    function renderPlotSeries(svg, pen, frame, xDomain, yDomain) {
      const points = Array.isArray(pen.points) ? pen.points : [];
      const mode = Number(pen.mode ?? 0);
      const fallbackColor = pen.color;
      if (mode === 1) {
        const baseline = scaleLinear(0, yDomain, frame.bottom, frame.top);
        const interval = Number.isFinite(Number(pen.interval)) ? Number(pen.interval) : 0;
        for (const point of points) {
          const normalized = normalizePlotPoint(point, frame, xDomain, yDomain);
          const barEndX = scaleLinear(point.x + interval, xDomain, frame.left, frame.right);
          const bar = document.createElementNS("http://www.w3.org/2000/svg", "rect");
          bar.setAttribute("x", String(Math.min(normalized[0], barEndX)));
          bar.setAttribute("y", String(Math.min(baseline, normalized[1])));
          bar.setAttribute("width", String(Math.abs(barEndX - normalized[0])));
          bar.setAttribute("height", String(Math.abs(normalized[1] - baseline)));
          bar.setAttribute("fill", plotCssColor(point.color ?? fallbackColor));
          bar.setAttribute("class", "plot-series-bar");
          svg.append(bar);
        }
        return;
      }

      if (mode === 2) {
        for (const point of points) {
          const normalized = normalizePlotPoint(point, frame, xDomain, yDomain);
          svg.append(svgPlotPoint(normalized[0], normalized[1], plotCssColor(point.color ?? fallbackColor)));
        }
        return;
      }

      let previous;
      let path;
      let pathColor;
      let pathData = "";
      for (const point of points) {
        const normalized = normalizePlotPoint(point, frame, xDomain, yDomain);
        const color = plotCssColor(point.color ?? fallbackColor);
        if (point.penDown === false) {
          previous = normalized;
          path = undefined;
          pathColor = undefined;
          pathData = "";
          continue;
        }

        if (!previous) {
          svg.append(svgPlotPoint(normalized[0], normalized[1], color));
          previous = normalized;
          continue;
        } else if (!path || pathColor !== color) {
          path = document.createElementNS("http://www.w3.org/2000/svg", "path");
          pathColor = color;
          pathData = "M " + previous[0] + " " + previous[1] + " L " + normalized[0] + " " + normalized[1];
          path.setAttribute("fill", "none");
          path.setAttribute("stroke", color);
          path.setAttribute("stroke-width", "1");
          path.setAttribute("vector-effect", "non-scaling-stroke");
          path.setAttribute("d", pathData);
          svg.append(path);
        } else {
          pathData += " L " + normalized[0] + " " + normalized[1];
          path.setAttribute("d", pathData);
        }
        previous = normalized;
      }
    }

    function svgPlotPoint(x, y, fill) {
      const point = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      point.setAttribute("x", String(x - 0.6));
      point.setAttribute("y", String(y - 0.6));
      point.setAttribute("width", "1.2");
      point.setAttribute("height", "1.2");
      point.setAttribute("fill", fill);
      return point;
    }

    function renderPlotLegend(svg, series) {
      const columnCount = Math.max(1, Math.ceil(series.length / 8));
      const columnWidth = Math.min(42, 140 / columnCount);
      const legendLeft = Math.max(8, 150 - columnWidth * columnCount);
      series.forEach((pen, index) => {
        const column = Math.floor(index / 8);
        const row = index % 8;
        const x = legendLeft + column * columnWidth;
        const y = 9 + row * 9;
        const swatch = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        swatch.setAttribute("x", String(x));
        swatch.setAttribute("y", String(y - 5));
        swatch.setAttribute("width", "6");
        swatch.setAttribute("height", "6");
        swatch.setAttribute("fill", plotCssColor(pen.color));
        swatch.setAttribute("class", "plot-legend-swatch");
        svg.append(swatch);
        const labelText = String(pen.name ?? "Pen");
        const label = svgText(labelText, x + 9, y, "plot-legend-label");
        label.setAttribute("text-anchor", "start");
        const availableWidth = Math.max(4, columnWidth - 10);
        if (labelText.length * 3.8 > availableWidth) {
          label.setAttribute("textLength", String(availableWidth));
          label.setAttribute("lengthAdjust", "spacingAndGlyphs");
        }
        svg.append(label);
      });
    }

    function plotCssColor(value) {
      const numeric = Number(value);
      const hex = Number.isFinite(numeric) && (numeric < 0 || numeric > 140)
        ? ((numeric >>> 0) & 0xffffff)
        : netLogoColorHex(numeric);
      return "#" + hex.toString(16).padStart(6, "0");
    }

    function renderPlotAxes(svg, frame, xDomain, yDomain, widget) {
      const xTicks = axisTicks(xDomain);
      const yTicks = axisTicks(yDomain);

      xTicks.forEach((tick, index) => {
        const x = scaleLinear(tick, xDomain, frame.left, frame.right);
        svg.append(svgLine(x, frame.top, x, frame.bottom, "plot-grid-line"));
        svg.append(svgLine(x, frame.bottom, x, frame.bottom + 3, "plot-tick"));
        const label = svgText(formatTick(tick), x, frame.xTickY, "plot-tick-label");
        label.setAttribute("text-anchor", index === 0 ? "start" : index === xTicks.length - 1 ? "end" : "middle");
        svg.append(label);
      });

      for (const tick of yTicks) {
        const y = scaleLinear(tick, yDomain, frame.bottom, frame.top);
        svg.append(svgLine(frame.left, y, frame.right, y, "plot-grid-line"));
        svg.append(svgLine(frame.left - 3, y, frame.left, y, "plot-tick"));
        const label = svgText(formatTick(tick), frame.left - 5, y + 2, "plot-tick-label");
        label.setAttribute("text-anchor", "end");
        svg.append(label);
      }

      svg.append(svgLine(frame.left, frame.top, frame.left, frame.bottom, "plot-axis"));
      svg.append(svgLine(frame.left, frame.bottom, frame.right, frame.bottom, "plot-axis"));

      const xLabel = svgText(axisLabel(widget.details?.xAxis, "x"), (frame.left + frame.right) / 2, frame.xLabelY, "plot-axis-label");
      xLabel.setAttribute("text-anchor", "middle");
      svg.append(xLabel);

      const yLabel = svgText(axisLabel(widget.details?.yAxis, "y"), 7, (frame.top + frame.bottom) / 2, "plot-axis-label");
      yLabel.setAttribute("text-anchor", "middle");
      yLabel.setAttribute("transform", "rotate(-90 7 " + ((frame.top + frame.bottom) / 2) + ")");
      svg.append(yLabel);
    }

    function normalizePlotPoint(point, frame, xDomain, yDomain) {
      return [
        scaleLinear(point.x, xDomain, frame.left, frame.right),
        scaleLinear(point.y, yDomain, frame.bottom, frame.top)
      ];
    }

    function plotDomain(points, widget, runtimePlot, axis, configurationDirty) {
      const details = widget.details ?? {};
      const runtimeMin = Number(runtimePlot?.[axis + "Min"]);
      const runtimeMax = Number(runtimePlot?.[axis + "Max"]);
      if (!configurationDirty && Number.isFinite(runtimeMin) && Number.isFinite(runtimeMax) && runtimeMax > runtimeMin) {
        return [runtimeMin, runtimeMax];
      }

      const configuredMin = Number(details[axis + "Min"]);
      const configuredMax = Number(details[axis + "Max"]);
      const hasConfiguredRange = Number.isFinite(configuredMin) && Number.isFinite(configuredMax) && configuredMax > configuredMin;
      if (details.autoplot === false && hasConfiguredRange) {
        return [configuredMin, configuredMax];
      }
      let dataMin = Infinity;
      let dataMax = -Infinity;
      let hasFiniteValue = false;
      for (const point of points) {
        const value = axis === "x" ? point.x : point.y;
        if (!Number.isFinite(value)) {
          continue;
        }
        hasFiniteValue = true;
        if (value < dataMin) {
          dataMin = value;
        }
        if (value > dataMax) {
          dataMax = value;
        }
      }
      if (!hasFiniteValue) {
        if (hasConfiguredRange) {
          return [configuredMin, configuredMax];
        }
        return [0, 10];
      }
      if (hasConfiguredRange && dataMin >= configuredMin && dataMax <= configuredMax) {
        return [configuredMin, configuredMax];
      }

      const min = hasConfiguredRange ? Math.min(dataMin, configuredMin) : dataMin;
      const max = hasConfiguredRange ? Math.max(dataMax, configuredMax) : dataMax;
      if (min === max) {
        const delta = Math.abs(min) > 1 ? Math.abs(min) * 0.1 : 1;
        return [min - delta, max + delta];
      }

      const padding = (max - min) * 0.08;
      const lower = hasConfiguredRange && dataMin >= configuredMin ? configuredMin : min - padding;
      const upper = hasConfiguredRange && dataMax <= configuredMax ? configuredMax : max + padding;
      return [configuredMin === 0 && lower < 0 && dataMin >= 0 ? 0 : lower, upper];
    }

    function plotFrameForDomains(xDomain, yDomain) {
      const yLabelWidth = Math.max(...axisTicks(yDomain).map(tick => estimateTickLabelWidth(formatTick(tick))));
      return {
        left: clampNumber(16 + yLabelWidth, 28, 76),
        top: 10,
        right: 150,
        bottom: 80,
        xTickY: 93,
        xLabelY: 110
      };
    }

    function estimateTickLabelWidth(label) {
      return String(label ?? "").length * 4.4;
    }

    function axisTicks(domain) {
      const [min, max] = domain;
      return [min, min + (max - min) / 2, max];
    }

    function scaleLinear(value, domain, outputMin, outputMax) {
      const [min, max] = domain;
      const range = max === min ? 1 : max - min;
      return outputMin + ((value - min) / range) * (outputMax - outputMin);
    }

    function formatTick(value) {
      const absolute = Math.abs(value);
      const formatterOptions = { useGrouping: true, maximumFractionDigits: 2 };
      if (absolute >= 1000) {
        formatterOptions.maximumFractionDigits = 0;
        return new Intl.NumberFormat("en-US", formatterOptions).format(value);
      }
      if (absolute >= 10) {
        formatterOptions.maximumFractionDigits = 0;
        return new Intl.NumberFormat("en-US", formatterOptions).format(value);
      }
      if (absolute >= 1) {
        formatterOptions.maximumFractionDigits = 1;
        return new Intl.NumberFormat("en-US", formatterOptions).format(value);
      }
      return new Intl.NumberFormat("en-US", formatterOptions).format(value);
    }

    function axisLabel(value, fallback) {
      const text = String(value ?? "").trim();
      return text && text.toUpperCase() !== "NIL" ? text : fallback;
    }

    function svgLine(x1, y1, x2, y2, className) {
      const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
      line.setAttribute("x1", String(x1));
      line.setAttribute("y1", String(y1));
      line.setAttribute("x2", String(x2));
      line.setAttribute("y2", String(y2));
      line.setAttribute("class", className);
      return line;
    }

    function svgText(value, x, y, className) {
      const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
      text.setAttribute("x", String(x));
      text.setAttribute("y", String(y));
      text.setAttribute("class", className);
      text.textContent = value;
      return text;
    }

    function svgCircle(cx, cy, radius, fill = "var(--vscode-charts-blue)") {
      const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      circle.setAttribute("cx", String(cx));
      circle.setAttribute("cy", String(cy));
      circle.setAttribute("r", String(radius));
      circle.setAttribute("fill", fill);
      circle.setAttribute("vector-effect", "non-scaling-stroke");
      return circle;
    }

    function renderRuntimeSlider(widget) {
      const details = widget.details ?? {};
      const input = node("input", "runtime-slider", "");
      input.type = "range";
      input.disabled = state.interfaceMode === "layout";
      input.min = finiteString(details.min, "0");
      input.max = finiteString(details.max, "100");
      input.step = finiteString(details.step, "1");
      input.value = finiteString(details.value, input.min);
      wireRuntimeControl(input);
      input.addEventListener("change", () => {
        const value = Number(input.value);
        commitWidgetProperties(widget, "value", Number.isFinite(value) ? value : input.value);
      });
      return input;
    }

    function renderRuntimeSwitch(widget) {
      const input = node("input", "runtime-checkbox", "");
      input.type = "checkbox";
      input.disabled = state.interfaceMode === "layout";
      input.checked = Boolean(widget.details?.on);
      wireRuntimeControl(input);
      input.addEventListener("change", () => {
        commitWidgetProperties(widget, "on", input.checked);
      });
      return input;
    }

    function renderRuntimeChooser(widget) {
      const select = node("select", "runtime-select", "");
      select.disabled = state.interfaceMode === "layout";
      const choices = Array.isArray(widget.details?.choices) ? widget.details.choices : [];
      const selectedIndex = Number(widget.details?.selectedIndex ?? 0);
      choices.forEach((choice, index) => {
        const option = node("option", "", choice);
        option.value = String(index);
        option.selected = index === selectedIndex;
        select.append(option);
      });
      if (choices.length === 0) {
        select.append(node("option", "", ""));
      }
      wireRuntimeControl(select);
      select.addEventListener("change", () => {
        const index = Number(select.value);
        commitWidgetProperties(widget, "selectedIndex", Number.isFinite(index) ? index : 0);
      });
      return select;
    }

    function wireRuntimeControl(element) {
      for (const eventName of ["pointerdown", "click", "keydown"]) {
        element.addEventListener(eventName, event => {
          event.stopPropagation();
        });
      }
    }

    function finiteString(value, fallback) {
      const numeric = Number(value);
      return Number.isFinite(numeric) ? String(value) : fallback;
    }

    function monitorValueElement(widget) {
      const value = node(
        "div",
        "monitor-value",
        formatMonitorValue(state.runtimeValues[widget.id] ?? "...", widget.details?.precision)
      );
      const fontSize = Number(widget.details?.fontSize);
      if (Number.isFinite(fontSize)) {
        value.style.fontSize = clampNumber(fontSize, 8, 48) + "px";
      }
      return value;
    }

    function labelWithType(widget) {
      return fragment([
        node("span", "widget-label", displayName(widget)),
        node("span", "widget-type", widget.type)
      ]);
    }

    function displayName(widget) {
      return widget.details?.variable || widget.label || widget.type;
    }

    function detailText(widget, keys, fallback) {
      const details = widget.details ?? {};
      const parts = keys
        .map(key => details[key])
        .filter(value => value !== undefined && value !== "");
      return parts.length > 0 ? parts.join(" ") : fallback;
    }

    function viewWorldLabel(widget) {
      const details = widget.details ?? {};
      const parts = [];
      const xRange = worldRangeText(details.minPxcor, details.maxPxcor);
      const yRange = worldRangeText(details.minPycor, details.maxPycor);
      const zRange = worldRangeText(details.minPzcor, details.maxPzcor);

      if (xRange) {
        parts.push("x: " + xRange);
      }
      if (yRange) {
        parts.push("y: " + yRange);
      }
      if (zRange) {
        parts.push("z: " + zRange);
      }

      return parts.length > 0 ? parts.join("   ") : "World";
    }

    function worldRangeText(min, max) {
      if (!isPresentWorldValue(min) || !isPresentWorldValue(max)) {
        return "";
      }

      return worldNumberText(min) + ".." + worldNumberText(max);
    }

    function isPresentWorldValue(value) {
      return value !== undefined && value !== "";
    }

    function worldNumberText(value) {
      const numeric = Number(value);
      if (!Number.isFinite(numeric)) {
        return String(value);
      }

      return Number.isInteger(numeric) ? String(numeric) : String(Number(numeric.toFixed(3)));
    }

    function selectedChoice(widget) {
      const choices = widget.details?.choices;
      const selectedIndex = widget.details?.selectedIndex;
      if (Array.isArray(choices) && typeof selectedIndex === "number" && choices[selectedIndex] !== undefined) {
        return choices[selectedIndex];
      }
      return Array.isArray(choices) ? choices.join(", ") : "";
    }

    function sliderPercent(widget) {
      const details = widget.details ?? {};
      const min = Number(details.min);
      const max = Number(details.max);
      const value = Number(details.value);
      if (!Number.isFinite(min) || !Number.isFinite(max) || !Number.isFinite(value) || max === min) {
        return 50;
      }
      return Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100));
    }

    function node(tagName, className, children, style) {
      const element = document.createElement(tagName);
      if (className) {
        element.className = className;
      }
      if (style) {
        Object.assign(element.style, style);
      }
      if (Array.isArray(children)) {
        element.append(...children);
      } else if (children instanceof Node) {
        element.append(children);
      } else {
        element.textContent = children ?? "";
      }
      return element;
    }

    function fragment(children) {
      const element = document.createDocumentFragment();
      element.append(...children);
      return element;
    }

    function setInputValue(input, value) {
      if (input.value !== value) {
        input.value = value;
      }
    }
  </script>
</body>
</html>`;
  }
}

function getNonce(): string {
  let text = "";
  const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let index = 0; index < 32; index += 1) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
