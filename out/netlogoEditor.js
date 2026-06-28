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
exports.NetLogoModelEditorProvider = void 0;
const path = __importStar(require("path"));
const vscode = __importStar(require("vscode"));
const commandPrompt_1 = require("./commandPrompt");
const classicInterface_1 = require("./classicInterface");
const modelFormat_1 = require("./modelFormat");
const netlogoInstallation_1 = require("./netlogoInstallation");
const runner_1 = require("./runner");
class NetLogoModelEditorProvider {
    static register(context, runner) {
        return vscode.window.registerCustomEditorProvider(NetLogoModelEditorProvider.viewType, new NetLogoModelEditorProvider(context, runner), {
            supportsMultipleEditorsPerDocument: false,
            webviewOptions: {
                retainContextWhenHidden: false
            }
        });
    }
    constructor(context, runner) {
        this.context = context;
        this.runner = runner;
        this.runtimeConfiguredCache = new Map();
    }
    async resolveCustomTextEditor(document, webviewPanel) {
        webviewPanel.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                vscode.Uri.joinPath(this.context.extensionUri, "resources")
            ]
        };
        webviewPanel.webview.html = this.getHtml(webviewPanel.webview);
        const updateWebview = () => {
            const model = (0, modelFormat_1.parseNetLogoModel)(document.getText(), document.fileName);
            const interfacePreview = (0, classicInterface_1.parseInterfacePreview)(model.interfaceSource, model.format);
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
        webviewPanel.onDidDispose(() => {
            documentChangeSubscription.dispose();
        });
        webviewPanel.webview.onDidReceiveMessage(async (message) => {
            if (message.type === "update") {
                await this.updateDocument(document, message.section, message.value);
                return;
            }
            if (message.type === "run") {
                const command = message.command === "setup" ? "setup" : "go";
                await (0, commandPrompt_1.rememberNetLogoCommand)(this.context, command);
                await this.runAndPost(webviewPanel.webview, document.uri, command, { showProgress: message.silent !== true });
                return;
            }
            if (message.type === "run-command") {
                const command = message.command.trim();
                if (command) {
                    await (0, commandPrompt_1.rememberNetLogoCommand)(this.context, command);
                    await this.runAndPost(webviewPanel.webview, document.uri, command, { showProgress: message.silent !== true });
                }
                return;
            }
            if (message.type === "prompt-command") {
                const command = await (0, commandPrompt_1.promptForNetLogoCommand)(this.context, {
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
                await vscode.commands.executeCommand("netlogo.openInNetLogo", document.uri);
                return;
            }
            if (message.type === "save-document") {
                await document.save();
                return;
            }
        });
        updateWebview();
    }
    async runAndPost(webview, resource, command, options) {
        try {
            const result = await this.runner.run(resource, command, options);
            this.postRuntimeResult(webview, result);
        }
        catch (error) {
            this.postRuntimeError(webview, error);
        }
    }
    postRuntimeResult(webview, result) {
        void webview.postMessage({
            type: "runtime-result",
            result: result ?? null
        });
    }
    postRuntimeError(webview, error) {
        void webview.postMessage({
            type: "runtime-error",
            message: (0, runner_1.formatNetLogoErrorMessage)(error)
        });
    }
    isRuntimeConfigured(resource) {
        const config = vscode.workspace.getConfiguration("netlogo", resource);
        const configuredClassPath = config.get("classPath", []);
        const home = config.get("home", "");
        const autoDetect = config.get("autoDetect", true);
        const cacheKey = JSON.stringify({ resource: resource.toString(), configuredClassPath, home, autoDetect });
        const cached = this.runtimeConfiguredCache.get(cacheKey);
        if (cached !== undefined) {
            return cached;
        }
        const configured = Boolean((0, netlogoInstallation_1.resolveNetLogoClassPath)({ configuredClassPath, home, autoDetect }));
        if (this.runtimeConfiguredCache.size > 16) {
            this.runtimeConfiguredCache.clear();
        }
        this.runtimeConfiguredCache.set(cacheKey, configured);
        return configured;
    }
    async updateDocument(document, section, value) {
        const current = (0, modelFormat_1.parseNetLogoModel)(document.getText(), document.fileName);
        const next = {
            ...current,
            [section]: value
        };
        const replacement = (0, modelFormat_1.serializeNetLogoModel)(next);
        if (replacement === document.getText()) {
            return;
        }
        const edit = new vscode.WorkspaceEdit();
        edit.replace(document.uri, new vscode.Range(0, 0, document.lineCount, 0), replacement);
        await vscode.workspace.applyEdit(edit);
    }
    async addWidget(document, kind, bounds) {
        const current = (0, modelFormat_1.parseNetLogoModel)(document.getText(), document.fileName);
        const interfaceSource = (0, classicInterface_1.createInterfaceWidget)(current.interfaceSource, current.format, kind, bounds);
        if (interfaceSource === current.interfaceSource) {
            return;
        }
        const replacement = (0, modelFormat_1.serializeNetLogoModel)({
            ...current,
            interfaceSource
        });
        const edit = new vscode.WorkspaceEdit();
        edit.replace(document.uri, new vscode.Range(0, 0, document.lineCount, 0), replacement);
        await vscode.workspace.applyEdit(edit);
    }
    async deleteWidget(document, widgetId) {
        const current = (0, modelFormat_1.parseNetLogoModel)(document.getText(), document.fileName);
        const interfaceSource = (0, classicInterface_1.deleteInterfaceWidget)(current.interfaceSource, current.format, widgetId);
        if (interfaceSource === current.interfaceSource) {
            return;
        }
        const replacement = (0, modelFormat_1.serializeNetLogoModel)({
            ...current,
            interfaceSource
        });
        const edit = new vscode.WorkspaceEdit();
        edit.replace(document.uri, new vscode.Range(0, 0, document.lineCount, 0), replacement);
        await vscode.workspace.applyEdit(edit);
    }
    async updateWidgetProperties(document, widgetId, updates) {
        const current = (0, modelFormat_1.parseNetLogoModel)(document.getText(), document.fileName);
        const interfaceSource = (0, classicInterface_1.updateInterfaceWidgetProperties)(current.interfaceSource, current.format, widgetId, updates);
        if (interfaceSource === current.interfaceSource) {
            return;
        }
        const replacement = (0, modelFormat_1.serializeNetLogoModel)({
            ...current,
            interfaceSource
        });
        const edit = new vscode.WorkspaceEdit();
        edit.replace(document.uri, new vscode.Range(0, 0, document.lineCount, 0), replacement);
        await vscode.workspace.applyEdit(edit);
    }
    async updateWidgetBounds(document, widgetId, bounds) {
        const current = (0, modelFormat_1.parseNetLogoModel)(document.getText(), document.fileName);
        const interfaceSource = (0, classicInterface_1.updateInterfaceWidgetBounds)(current.interfaceSource, current.format, widgetId, bounds);
        if (interfaceSource === current.interfaceSource) {
            return;
        }
        const replacement = (0, modelFormat_1.serializeNetLogoModel)({
            ...current,
            interfaceSource
        });
        const edit = new vscode.WorkspaceEdit();
        edit.replace(document.uri, new vscode.Range(0, 0, document.lineCount, 0), replacement);
        await vscode.workspace.applyEdit(edit);
    }
    getHtml(webview) {
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
    }

    .speed-control {
      display: flex;
      align-items: center;
      gap: 6px;
      min-width: 124px;
      color: var(--vscode-descriptionForeground);
      font-size: 11px;
      user-select: none;
    }

    .speed-control input {
      width: 78px;
      min-width: 0;
    }

    .tick-counter {
      display: inline-flex;
      align-items: baseline;
      gap: 5px;
      min-height: 28px;
      padding: 4px 8px;
      border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
      border-radius: 4px;
      color: var(--vscode-descriptionForeground);
      background: var(--vscode-editorWidget-background);
      font-size: 11px;
    }

    .tick-counter strong {
      color: var(--vscode-editor-foreground);
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 12px;
      font-weight: 600;
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
      background: #050507;
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
      background: #050507;
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
      color: var(--vscode-descriptionForeground);
      min-width: 64px;
      text-align: right;
    }

    .runtime-banner {
      display: flex;
      align-items: center;
      gap: 8px;
      min-height: 34px;
      padding: 5px 12px;
      border-bottom: 1px solid var(--vscode-panel-border);
      color: var(--vscode-editorWarning-foreground, var(--vscode-editor-foreground));
      background: var(--vscode-editorWarning-background, var(--vscode-inputValidation-warningBackground, var(--vscode-editorWidget-background)));
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
        <button id="commandButton" type="button" title="Run NetLogo command">Command...</button>
        <button id="openNativeButton" type="button" title="Open in native NetLogo">Open in NetLogo</button>
        <label class="speed-control" title="Forever speed">
          <span>Speed</span>
          <input id="speedSlider" type="range" min="-5" max="5" step="1" value="0" aria-label="Forever speed">
        </label>
        <span class="tick-counter" title="NetLogo ticks"><span>ticks</span><strong id="tickCount">-</strong></span>
        <button id="setupButton" type="button">Setup</button>
        <button id="goButton" type="button">Go once</button>
        <button id="foreverButton" type="button">Forever</button>
        <span id="status" class="status">Ready</span>
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
              <button id="deleteWidgetButton" type="button" disabled>Delete widget</button>
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

    const state = {
      version: 0,
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
      threeBackground: restoredUiState.threeBackground === "light" ? "light" : "dark",
      threeInteractionMode: validThreeInteractionMode(restoredUiState.threeInteractionMode),
      threeCamera: sanitizeThreeCamera(restoredUiState.threeCamera),
      plotCsv: {}
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
      vscode.postMessage({ type: "open-native" });
    });

    foreverButton.addEventListener("click", () => {
      if (state.runLoop) {
        stopRunLoop();
      } else {
        startRunLoop(toolbarGoCommand(), "go");
      }
    });

    speedSlider.addEventListener("input", () => {
      state.runSpeed = Number(speedSlider.value);
      persistUiState();
      updateSpeedControl();
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
      if (!message || message.type !== "model") {
        if (message?.type === "runtime-result") {
          applyRuntimeResult(message.result);
        } else if (message?.type === "runtime-error") {
          applyRuntimeError(message.message);
        }
        return;
      }

      const codeEditorActive = document.activeElement === codeEditorSurface;
      const infoEditorActive = document.activeElement === infoEditorSurface;
      const sourceEditorActive = codeEditorActive || infoEditorActive;
      const nextCode = message.code ?? "";
      const nextInfo = message.info ?? "";

      state.version = message.version;
      if (!codeEditorActive || nextCode === state.code) {
        state.code = nextCode;
      }
      state.interfaceSource = message.interfaceSource ?? "";
      if (!infoEditorActive || nextInfo === state.info) {
        state.info = nextInfo;
      }
      state.interfacePreview = message.interfacePreview ?? { widgets: [], bounds: { width: 820, height: 560 } };
      state.runtimeConfigured = message.runtimeConfigured !== false;
      if (state.selectedWidgetId && !findWidget(state.selectedWidgetId)) {
        state.selectedWidgetId = null;
      }

      fileName.textContent = message.fileName ?? "NetLogo";
      if (!codeEditorActive) {
        setInputValue(inputs.code, state.code);
      }
      setInputValue(inputs.interfaceSource, state.interfaceSource);
      if (!infoEditorActive) {
        setInputValue(inputs.info, state.info);
      }
      if (!codeEditorActive) {
        renderCodeHighlight();
      }
      if (!infoEditorActive) {
        renderInfo();
      }
      if (!sourceEditorActive) {
        updateEditorLayout();
      }
      setStatus(state.runLoop ? "Running " + state.runLoop.label : message.format === "xml" ? "XML model" : "Classic model");
      updateRuntimeBanner();
      updateRunControls();
      if (!sourceEditorActive) {
        renderInterface();
      }
    });

    function persistUiState() {
      vscode.setState?.({
        activeTab: state.activeTab,
        infoEditing: state.infoEditing,
        interfaceMode: state.interfaceMode,
        runSpeed: state.runSpeed,
        threeBackground: state.threeBackground,
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

    function validThreeInteractionMode(mode) {
      return ["orbit", "zoom", "move"].includes(mode) ? mode : "orbit";
    }

    function restoredRunSpeed(value) {
      const number = Number(value);
      return Number.isFinite(number) ? clampNumber(number, -5, 5) : 0;
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
      const text = message || (state.runtimeConfigured ? "" : "NetLogo runtime not configured.");
      runtimeBanner.classList.toggle("hidden", !text);
      runtimeBannerText.textContent = text;
      configureRuntimeButton.hidden = state.runtimeStatus !== "not-configured";
      showOutputButton.hidden = !text;
    }

    function setInterfaceMode(mode) {
      state.interfaceMode = mode === "layout" ? "layout" : "interact";
      interactModeButton.classList.toggle("active", state.interfaceMode === "interact");
      layoutModeButton.classList.toggle("active", state.interfaceMode === "layout");
      interactModeButton.setAttribute("aria-pressed", String(state.interfaceMode === "interact"));
      layoutModeButton.setAttribute("aria-pressed", String(state.interfaceMode === "layout"));
      addWidgetButton.disabled = state.interfaceMode !== "layout";
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

    function postRunCommand(command, silent) {
      state.runtimeStatus = "running";
      updateRuntimeBanner();
      setStatus("Running " + command);
      vscode.postMessage({ type: "run-command", command, silent });
    }

    function updateSpeedControl() {
      speedSlider.value = String(state.runSpeed);
      const delay = runLoopDelayMs();
      speedSlider.title = delay === 0 ? "Fastest" : delay + " ms";
      speedSlider.setAttribute("aria-valuetext", delay === 0 ? "fastest" : delay + " milliseconds");
    }

    function runLoopDelayMs() {
      const speed = clampNumber(Number(state.runSpeed), -5, 5);
      if (speed >= 0) {
        return Math.max(0, 120 - speed * 24);
      }
      return [250, 500, 900, 1400, 2200][Math.abs(speed) - 1] ?? 120;
    }

    function startRunLoop(command, label) {
      if (state.runLoop?.command === command) {
        stopRunLoop();
        return;
      }

      state.runLoop = {
        command,
        label: label || command,
        waiting: false
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
      postRunCommand(loop.command, true);
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
            value.textContent = state.runtimeValues[widget.id] ?? widget.details?.source ?? "...";
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
      state.plotCsv = {};
      for (const plot of result.plotValues ?? []) {
        state.plotCsv[plot.widgetId] = plot.csv;
      }
      const loop = state.runLoop;
      updateRuntimeBanner();
      setStatus(loop ? "Running " + loop.label : result.command ? "Updated after " + result.command : "Updated");
      if (loop) {
        loop.waiting = false;
        setTimeout(() => {
          if (state.runLoop === loop) {
            scheduleRunLoop();
          }
        }, runLoopDelayMs());
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
      updateWidgetPropertyInState(widget, key, value);
      setStatus("Editing");
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
            descriptor("yMax", "Y max", details.yMax, "number")
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
            labelWithType(widget),
            node("div", "monitor-value", state.runtimeValues[widget.id] ?? widget.details?.source ?? "...")
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

      const bounds = viewState.bounds;
      const spanX = Math.max(1, bounds.maxX - bounds.minX);
      const spanY = Math.max(1, bounds.maxY - bounds.minY);
      const spanZ = Math.max(1, bounds.maxZ - bounds.minZ);
      const span = Math.max(spanX, spanY, spanZ);
      const baseTarget = new THREE.Vector3(
        (bounds.minX + bounds.maxX) / 2,
        (bounds.minZ + bounds.maxZ) / 2,
        (bounds.minY + bounds.maxY) / 2
      );
      const target = baseTarget.clone();

      const camera = new THREE.PerspectiveCamera(45, 1, 0.1, span * 12);
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

      const pickables = [];
      const agentLayer = new THREE.Group();
      scene.add(agentLayer);
      addThreeWorldBox(scene, THREE, bounds);
      rebuildAgentLayer(currentViewState);

      const raycaster = new THREE.Raycaster();
      raycaster.params.Line = { threshold: Math.max(0.18, span * 0.01) };
      const pointer = new THREE.Vector2();

      function resize() {
        const width = Math.max(1, host.clientWidth);
        const height = Math.max(1, host.clientHeight);
        renderer.setSize(width, height, false);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
      }

      function updateCamera() {
        controls.phi = Math.max(0.08, Math.min(Math.PI - 0.08, controls.phi));
        controls.radius = Math.max(span * 0.35, Math.min(span * 8, controls.radius));
        target.set(controls.targetX, controls.targetY, controls.targetZ);
        const sinPhi = Math.sin(controls.phi);
        camera.position.set(
          target.x + controls.radius * sinPhi * Math.sin(controls.theta),
          target.y + controls.radius * Math.cos(controls.phi),
          target.z + controls.radius * sinPhi * Math.cos(controls.theta)
        );
        camera.lookAt(target);
      }

      function setCameraPose(pose) {
        const next = cameraPose(pose, span, baseTarget);
        controls.theta = next.theta;
        controls.phi = next.phi;
        controls.radius = next.radius;
        controls.targetX = next.targetX;
        controls.targetY = next.targetY;
        controls.targetZ = next.targetZ;
        saveThreeCamera();
        draw();
      }

      function saveThreeCamera() {
        state.threeCamera = { ...controls };
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
          controls.radius = drag.radius * Math.exp(dy * 0.012);
        } else if (drag.mode === "move") {
          panThreeCamera(dx, dy, drag);
        } else {
          controls.theta = drag.theta - dx * 0.01;
          controls.phi = drag.phi + dy * 0.01;
        }
        saveThreeCamera();
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
        controls.radius *= event.deltaY > 0 ? 1.12 : 0.88;
        saveThreeCamera();
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
          renderInterface();
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
        pickables.length = 0;
        geometryDispose(agentLayer);
        agentLayer.clear();
        addThreePatches(agentLayer, THREE, currentViewState.patches ?? [], pickables);
        addThreeTurtles(agentLayer, THREE, currentViewState.turtles, pickables);
        addThreeLinks(agentLayer, THREE, currentViewState.links, currentViewState.turtles, pickables);
        addThreeLabels(agentLayer, THREE, currentViewState.turtles, currentViewState.links);
        label.textContent = threeStatusText(currentViewState);
        draw();
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
        }
      }
    }

    function threeStatusText(viewState) {
      const parts = [viewState.turtles.length + " turtles"];
      if (viewState.links.length) {
        parts.push(viewState.links.length + " links");
      }
      if (viewState.patches?.length) {
        parts.push(viewState.patches.length + " patches");
      }
      return parts.join(" · ");
    }

    function threeTheme() {
      return state.threeBackground === "light"
        ? { background: 0xf7f7f4, box: 0xb8bcc6 }
        : { background: 0x050507, box: 0x8f929a };
    }

    function cameraPose(pose, span, baseTarget) {
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
          return { theta: Math.PI / 4, phi: Math.PI / 3, radius: span * 1.9, targetX: baseTarget.x, targetY: baseTarget.y, targetZ: baseTarget.z };
      }
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

    function geometryDispose(scene) {
      scene.traverse(object => {
        if (object.geometry) {
          object.geometry.dispose();
        }
        if (object.material) {
          if (Array.isArray(object.material)) {
            object.material.forEach(disposeThreeMaterial);
          } else {
            disposeThreeMaterial(object.material);
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
      const box = new THREE.Box3(
        new THREE.Vector3(bounds.minX, bounds.minZ, bounds.minY),
        new THREE.Vector3(bounds.maxX, bounds.maxZ, bounds.maxY)
      );
      const helper = new THREE.Box3Helper(box, 0x4d4658);
      helper.material.color.setHex(theme.box);
      scene.add(helper);
    }

    function addThreeTurtles(scene, THREE, turtles, pickables) {
      if (!turtles.length) {
        return;
      }

      const groups = new Map();
      for (const turtle of turtles) {
        const geometryKey = turtleGeometryKey(turtle.shape);
        const color = threeColorHex(turtle);
        const key = geometryKey + "|" + color;
        const group = groups.get(key) ?? { geometryKey, color, items: [] };
        group.items.push(turtle);
        groups.set(key, group);
      }

      const baseDirection = new THREE.Vector3(0, 1, 0);
      const matrix = new THREE.Matrix4();

      for (const group of groups.values()) {
        const geometry = turtleGeometryForKey(THREE, group.geometryKey);
        const material = new THREE.MeshBasicMaterial({
          color: group.color,
          side: THREE.DoubleSide
        });
        const mesh = new THREE.InstancedMesh(geometry, material, group.items.length);
        mesh.userData = { kind: "turtle", items: group.items };

        group.items.forEach((turtle, index) => {
          const size = Math.max(0.35, Number(turtle.size) || 1);
          const position = netLogoVector(THREE, turtle.x, turtle.y, turtle.z);
          const direction = turtleDirection(THREE, turtle.heading, turtle.pitch);
          const quaternion = group.geometryKey === "sphere"
            ? new THREE.Quaternion()
            : new THREE.Quaternion().setFromUnitVectors(baseDirection, direction);
          const scale = group.geometryKey === "line"
            ? new THREE.Vector3(size * 0.35, size * 1.2, size * 0.35)
            : new THREE.Vector3(size, size, size);
          matrix.compose(position, quaternion, scale);
          mesh.setMatrixAt(index, matrix);
        });
        mesh.instanceMatrix.needsUpdate = true;
        scene.add(mesh);
        pickables.push(mesh);
      }
    }

    function turtleGeometryKey(shape) {
      const normalized = String(shape ?? "").trim().toLowerCase();
      if (["circle", "dot", "sphere"].includes(normalized)) {
        return "sphere";
      }
      if (["box", "cube", "square"].includes(normalized)) {
        return "box";
      }
      if (["line", "cylinder"].includes(normalized)) {
        return "line";
      }
      return "cone";
    }

    function turtleGeometryForKey(THREE, key) {
      switch (key) {
        case "sphere":
          return new THREE.SphereGeometry(0.42, 16, 12);
        case "box":
          return new THREE.BoxGeometry(0.78, 0.78, 0.78);
        case "line":
          return new THREE.CylinderGeometry(0.08, 0.08, 0.95, 8);
        default:
          return new THREE.ConeGeometry(0.28, 0.9, 12);
      }
    }

    function addThreePatches(scene, THREE, patches, pickables) {
      if (!patches.length) {
        return;
      }

      const geometry = new THREE.BoxGeometry(0.92, 0.92, 0.92);
      const material = new THREE.MeshBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 0.88
      });
      const mesh = new THREE.InstancedMesh(geometry, material, patches.length);
      const matrix = new THREE.Matrix4();
      const color = new THREE.Color();

      patches.forEach((patch, index) => {
        matrix.makeTranslation(Number(patch.x) || 0, Number(patch.z) || 0, Number(patch.y) || 0);
        mesh.setMatrixAt(index, matrix);
        color.setHex(threeColorHex(patch));
        mesh.setColorAt(index, color);
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) {
        mesh.instanceColor.needsUpdate = true;
      }
      mesh.userData = { kind: "patch", items: patches };
      scene.add(mesh);
      pickables.push(mesh);
    }

    function addThreeLinks(scene, THREE, links, turtles, pickables) {
      if (!links.length) {
        return;
      }

      const turtleByWho = new Map();
      for (const turtle of turtles) {
        turtleByWho.set(turtle.who, turtle);
      }

      for (const link of links) {
        const end1 = turtleByWho.get(link.end1);
        const end2 = turtleByWho.get(link.end2);
        if (!end1 || !end2) {
          continue;
        }

        const color = threeColorHex(link);
        const material = new THREE.LineBasicMaterial({ color, linewidth: Math.max(1, link.thickness || 1) });
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
          addThreeLinkArrow(scene, THREE, start, end, color, Math.max(0.45, link.thickness || 1));
        }
      }
    }

    function addThreeLinkArrow(scene, THREE, start, end, color, size) {
      const direction = new THREE.Vector3().subVectors(end, start);
      const length = direction.length();
      if (length <= 0.001) {
        return;
      }

      direction.normalize();
      const position = end.clone().addScaledVector(direction, -Math.min(0.45, length * 0.22));
      const geometry = new THREE.ConeGeometry(0.16 * size, 0.42 * size, 10);
      const material = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide });
      const arrow = new THREE.Mesh(geometry, material);
      arrow.position.copy(position);
      arrow.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
      scene.add(arrow);
    }

    function addThreeLabels(scene, THREE, turtles, links) {
      for (const turtle of turtles) {
        if (String(turtle.label ?? "").length === 0) {
          continue;
        }
        const position = netLogoVector(THREE, turtle.x, turtle.y, turtle.z);
        position.y += Math.max(0.7, Number(turtle.size) || 1);
        scene.add(threeTextSprite(THREE, String(turtle.label), threeColorHex(turtle, "labelColor", "labelColorRgb"), position));
      }

      if (!links.length) {
        return;
      }

      const turtleByWho = new Map();
      for (const turtle of turtles) {
        turtleByWho.set(turtle.who, turtle);
      }
      for (const link of links) {
        if (String(link.label ?? "").length === 0) {
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
        scene.add(threeTextSprite(THREE, String(link.label), threeColorHex(link, "labelColor", "labelColorRgb"), position));
      }
    }

    function threeTextSprite(THREE, text, color, position) {
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
      const material = new THREE.SpriteMaterial({ map: texture, transparent: true });
      const sprite = new THREE.Sprite(material);
      sprite.position.copy(position);
      sprite.scale.set(canvas.width / 28, canvas.height / 28, 1);
      return sprite;
    }

    function describeThreeHit(hit) {
      const object = hit.object;
      const kind = object.userData?.kind;
      if (kind === "turtle") {
        const turtle = object.userData.items?.[hit.instanceId ?? 0];
        return turtle
          ? "Turtle " + turtle.who + " · " + pointText(turtle.x, turtle.y, turtle.z) + (turtle.shape ? " · " + turtle.shape : "")
          : "Turtle";
      }
      if (kind === "patch") {
        const patch = object.userData.items?.[hit.instanceId ?? 0];
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
      const kind = object.userData?.kind;
      if (kind === "turtle") {
        const turtle = object.userData.items?.[hit.instanceId ?? 0];
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
        const patch = object.userData.items?.[hit.instanceId ?? 0];
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

      if (color < 10) {
        const channel = Math.round(clampNumber(color / 9.9, 0, 1) * 255);
        return rgbToHex(channel, channel, channel);
      }

      const palette = new Map([
        [15, [215, 48, 39]],
        [25, [255, 149, 40]],
        [35, [139, 91, 45]],
        [45, [255, 242, 0]],
        [55, [46, 176, 73]],
        [65, [139, 212, 57]],
        [75, [36, 190, 150]],
        [85, [49, 197, 210]],
        [95, [92, 164, 255]],
        [105, [46, 82, 220]],
        [115, [137, 91, 215]],
        [125, [214, 83, 196]],
        [135, [255, 123, 164]]
      ]);
      const base = Math.round((color - 5) / 10) * 10 + 5;
      const rgb = palette.get(base) ?? [90, 167, 255];
      const shade = clampNumber(color - base, -4.9, 4.9);
      const shaded = shade < 0
        ? mixRgb(rgb, [0, 0, 0], Math.min(0.55, Math.abs(shade) * 0.085))
        : mixRgb(rgb, [255, 255, 255], Math.min(0.68, shade * 0.12));
      return rgbToHex(shaded[0], shaded[1], shaded[2]);
    }

    function threeColorHex(item, colorKey = "color", rgbKey = "colorRgb") {
      const rgbHex = rgbValueToHex(item?.[rgbKey]);
      return rgbHex ?? netLogoColorHex(item?.[colorKey]);
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
      return Math.round(clampNumber(value, 0, 255));
    }

    function mixRgb(left, right, amount) {
      return left.map((channel, index) => Math.round(channel + (right[index] - channel) * amount));
    }

    function rgbToHex(red, green, blue) {
      return ((red & 255) << 16) | ((green & 255) << 8) | (blue & 255);
    }

    function renderPlotBody(widget) {
      const csv = state.plotCsv[widget.id];
      const points = csv ? parsePlotPoints(csv) : [];
      const body = node("div", "plot-body" + (points.length > 0 ? " has-runtime" : ""), "");
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("class", "plot-svg");
      svg.setAttribute("viewBox", "0 0 160 120");
      svg.setAttribute("preserveAspectRatio", "none");

      const xDomain = plotDomain(points, widget, "x");
      const yDomain = plotDomain(points, widget, "y");
      const plotFrame = plotFrameForDomains(xDomain, yDomain);
      renderPlotAxes(svg, plotFrame, xDomain, yDomain, widget);

      const normalizedPoints = normalizePlotPoints(points, plotFrame, xDomain, yDomain);
      if (points.length === 0) {
        svg.append(svgText("No numeric data", 89, 50, "plot-no-data"));
      } else if (normalizedPoints.length === 1) {
        svg.append(svgCircle(normalizedPoints[0][0], normalizedPoints[0][1], 2.5));
      } else {
        const polyline = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
        polyline.setAttribute("fill", "none");
        polyline.setAttribute("stroke", "var(--vscode-charts-blue)");
        polyline.setAttribute("stroke-width", "2");
        polyline.setAttribute("vector-effect", "non-scaling-stroke");
        polyline.setAttribute("points", normalizedPoints.map(point => point.join(",")).join(" "));
        svg.append(polyline);
      }
      body.append(svg);
      return body;
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

    function parsePlotPoints(csv) {
      const points = [];
      let inPenData = false;
      for (const row of csv.split(/\\r?\\n/)) {
        const cells = parseCsvLine(row);
        if (cells.length === 0) {
          inPenData = false;
          continue;
        }

        if (cells[0]?.toLowerCase() === "x" && cells[1]?.toLowerCase() === "y") {
          inPenData = true;
          continue;
        }

        if (!inPenData) {
          continue;
        }

        const x = Number(cells[0]);
        const y = Number(cells[1]);
        if (Number.isFinite(x) && Number.isFinite(y)) {
          points.push([x, y]);
        }
      }
      return points;
    }

    function parseCsvLine(row) {
      const cells = [];
      let cell = "";
      let quoted = false;
      for (let index = 0; index < row.length; index += 1) {
        const character = row[index];
        if (quoted) {
          if (character === '"' && row[index + 1] === '"') {
            cell += '"';
            index += 1;
          } else if (character === '"') {
            quoted = false;
          } else {
            cell += character;
          }
          continue;
        }

        if (character === '"') {
          quoted = true;
        } else if (character === ",") {
          cells.push(cell.trim());
          cell = "";
        } else {
          cell += character;
        }
      }
      if (cell.length > 0 || row.endsWith(",")) {
        cells.push(cell.trim());
      }
      return cells.filter(value => value.length > 0);
    }

    function normalizePlotPoints(points, frame, xDomain, yDomain) {
      return points.map(point => [
        clampPlotCoordinate(scaleLinear(point[0], xDomain, frame.left, frame.right), frame.left, frame.right),
        clampPlotCoordinate(scaleLinear(point[1], yDomain, frame.bottom, frame.top), frame.top, frame.bottom)
      ]);
    }

    function plotDomain(points, widget, axis) {
      const details = widget.details ?? {};
      const configuredMin = Number(details[axis + "Min"]);
      const configuredMax = Number(details[axis + "Max"]);
      const hasConfiguredRange = Number.isFinite(configuredMin) && Number.isFinite(configuredMax) && configuredMax > configuredMin;
      const values = points
        .map(point => axis === "x" ? point[0] : point[1])
        .filter(value => Number.isFinite(value));
      if (values.length === 0) {
        if (hasConfiguredRange) {
          return [configuredMin, configuredMax];
        }
        return [0, 10];
      }

      const dataMin = Math.min(...values);
      const dataMax = Math.max(...values);
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

    function clampPlotCoordinate(value, min, max) {
      return Math.min(Math.max(value, min), max);
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

    function svgCircle(cx, cy, radius) {
      const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      circle.setAttribute("cx", String(cx));
      circle.setAttribute("cy", String(cy));
      circle.setAttribute("r", String(radius));
      circle.setAttribute("fill", "var(--vscode-charts-blue)");
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
exports.NetLogoModelEditorProvider = NetLogoModelEditorProvider;
NetLogoModelEditorProvider.viewType = "netlogo.modelEditor";
function getNonce() {
    let text = "";
    const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    for (let index = 0; index < 32; index += 1) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}
//# sourceMappingURL=netlogoEditor.js.map