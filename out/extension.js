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
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const child_process_1 = require("child_process");
const commandPrompt_1 = require("./commandPrompt");
const modelDefinitions_1 = require("./modelDefinitions");
const modelDiagnostics_1 = require("./modelDiagnostics");
const modelSymbols_1 = require("./modelSymbols");
const modelFormat_1 = require("./modelFormat");
const netlogoCompletions_1 = require("./netlogoCompletions");
const netlogoEditor_1 = require("./netlogoEditor");
const netlogoInstallation_1 = require("./netlogoInstallation");
const runner_1 = require("./runner");
function activate(context) {
    const output = vscode.window.createOutputChannel("NetLogo");
    const runner = new runner_1.NetLogoRunner(context, output);
    const diagnostics = vscode.languages.createDiagnosticCollection("netlogo");
    context.subscriptions.push(output, runner, diagnostics, vscode.languages.registerCompletionItemProvider({ language: "netlogo", scheme: "file" }, (0, netlogoCompletions_1.createNetLogoCompletionProvider)()), vscode.languages.registerDocumentSymbolProvider({ language: "netlogo", scheme: "file" }, createNetLogoDocumentSymbolProvider()), vscode.languages.registerHoverProvider({ language: "netlogo", scheme: "file" }, createNetLogoHoverProvider()), vscode.languages.registerDefinitionProvider({ language: "netlogo", scheme: "file" }, createNetLogoDefinitionProvider()), vscode.languages.registerReferenceProvider({ language: "netlogo", scheme: "file" }, createNetLogoReferenceProvider()), vscode.languages.registerDocumentHighlightProvider({ language: "netlogo", scheme: "file" }, createNetLogoDocumentHighlightProvider()), vscode.languages.registerRenameProvider({ language: "netlogo", scheme: "file" }, createNetLogoRenameProvider()), vscode.languages.registerCodeActionsProvider({ language: "netlogo", scheme: "file" }, createNetLogoCodeActionProvider(), { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] }), netlogoEditor_1.NetLogoModelEditorProvider.register(context, runner), vscode.workspace.onDidOpenTextDocument(document => updateNetLogoDiagnostics(document, diagnostics)), vscode.workspace.onDidChangeTextDocument(event => updateNetLogoDiagnostics(event.document, diagnostics)), vscode.workspace.onDidCloseTextDocument(document => diagnostics.delete(document.uri)), vscode.commands.registerCommand("netlogo.openModelEditor", async (resource) => {
        const uri = await resolveModelUri(resource);
        if (uri) {
            await vscode.commands.executeCommand("vscode.openWith", uri, netlogoEditor_1.NetLogoModelEditorProvider.viewType);
        }
    }), vscode.commands.registerCommand("netlogo.openInNetLogo", async (resource) => {
        await openInNativeNetLogo(resource);
    }), vscode.commands.registerCommand("netlogo.showOutput", () => {
        output.show(true);
    }), vscode.commands.registerCommand("netlogo.configure", async () => {
        await configureNetLogo();
    }), vscode.commands.registerCommand("netlogo.runSetup", async (resource) => {
        await (0, commandPrompt_1.rememberNetLogoCommand)(context, "setup");
        return runner.run(resource, "setup");
    }), vscode.commands.registerCommand("netlogo.runGoOnce", async (resource) => {
        await (0, commandPrompt_1.rememberNetLogoCommand)(context, "go");
        return runner.run(resource, "go");
    }), vscode.commands.registerCommand("netlogo.runCommand", async (resource, providedCommand) => {
        const command = providedCommand?.trim() ?? await (0, commandPrompt_1.promptForNetLogoCommand)(context, {
            prompt: "Command to run once in a headless workspace"
        });
        if (command) {
            if (providedCommand) {
                await (0, commandPrompt_1.rememberNetLogoCommand)(context, command);
            }
            return runner.run(resource, command);
        }
        return undefined;
    }), vscode.commands.registerCommand("netlogo.clearCommandHistory", async () => {
        await (0, commandPrompt_1.clearNetLogoCommandHistory)(context);
        void vscode.window.showInformationMessage("NetLogo command history cleared.");
    }));
    for (const document of vscode.workspace.textDocuments) {
        updateNetLogoDiagnostics(document, diagnostics);
    }
}
function deactivate() {
}
async function resolveModelUri(resource) {
    if (resource instanceof vscode.Uri) {
        return resource;
    }
    const activeDocument = vscode.window.activeTextEditor?.document;
    if (activeDocument && isNetLogoUri(activeDocument.uri)) {
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
function isNetLogoUri(uri) {
    const path = uri.fsPath.toLowerCase();
    return path.endsWith(".nlogo") || path.endsWith(".nlogox") || path.endsWith(".nlogo3d");
}
function updateNetLogoDiagnostics(document, collection) {
    if (!isNetLogoUri(document.uri)) {
        return;
    }
    const text = document.getText();
    const model = (0, modelFormat_1.parseNetLogoModel)(text, document.fileName);
    const codeOffset = codeSectionOffset(text, document.fileName);
    const diagnostics = (0, modelDiagnostics_1.analyzeNetLogoCode)(model.code).map(item => {
        const diagnostic = new vscode.Diagnostic(new vscode.Range(document.positionAt(codeOffset + item.start), document.positionAt(codeOffset + item.end)), item.message, vscode.DiagnosticSeverity.Warning);
        diagnostic.source = "NetLogo";
        diagnostic.code = item.code;
        return diagnostic;
    });
    collection.set(document.uri, diagnostics);
}
function createNetLogoCodeActionProvider() {
    return {
        provideCodeActions(document, _range, context) {
            if (!isNetLogoUri(document.uri)) {
                return [];
            }
            const actions = [];
            for (const diagnostic of context.diagnostics) {
                if (diagnostic.source !== "NetLogo") {
                    continue;
                }
                const code = diagnosticCode(diagnostic);
                if (code === "netlogo.missingEnd") {
                    actions.push(insertMissingEndAction(document, diagnostic));
                }
                else if (code === "netlogo.unexpectedEnd") {
                    actions.push(removeUnexpectedEndAction(document, diagnostic));
                }
                else if (code === "netlogo.unterminatedString") {
                    actions.push(insertClosingQuoteAction(document, diagnostic));
                }
                else if (code === "netlogo.unexpectedClosingDelimiter") {
                    actions.push(removeDiagnosticTextAction(document, diagnostic, `Remove unexpected '${document.getText(diagnostic.range)}'`));
                }
                else if (code === "netlogo.mismatchedClosingDelimiter") {
                    const expected = expectedDelimiter(diagnostic);
                    if (expected) {
                        actions.push(replaceDiagnosticTextAction(document, diagnostic, `Replace with '${expected}'`, expected));
                    }
                }
                else if (code === "netlogo.unclosedDelimiter") {
                    const expected = expectedDelimiter(diagnostic);
                    if (expected) {
                        actions.push(insertMissingDelimiterAction(document, diagnostic, expected));
                    }
                }
            }
            return actions;
        }
    };
}
function insertMissingEndAction(document, diagnostic) {
    const action = new vscode.CodeAction("Insert missing 'end'", vscode.CodeActionKind.QuickFix);
    action.diagnostics = [diagnostic];
    action.isPreferred = true;
    const text = document.getText();
    const section = codeSectionOffsets(text, document.fileName);
    const insertion = missingEndInsertionPosition(document, diagnostic, section);
    const edit = new vscode.WorkspaceEdit();
    edit.insert(document.uri, insertion, missingEndInsertionText(text, document.offsetAt(insertion), section));
    action.edit = edit;
    return action;
}
function insertClosingQuoteAction(document, diagnostic) {
    const action = new vscode.CodeAction("Insert closing quote", vscode.CodeActionKind.QuickFix);
    action.diagnostics = [diagnostic];
    action.isPreferred = true;
    const text = document.getText();
    const section = codeSectionOffsets(text, document.fileName);
    const lineEnd = document.lineAt(diagnostic.range.start.line).range.end;
    const insertionOffset = Math.min(document.offsetAt(lineEnd), section.end);
    const edit = new vscode.WorkspaceEdit();
    edit.insert(document.uri, document.positionAt(insertionOffset), "\"");
    action.edit = edit;
    return action;
}
function insertMissingDelimiterAction(document, diagnostic, expected) {
    const action = new vscode.CodeAction(`Insert missing '${expected}'`, vscode.CodeActionKind.QuickFix);
    action.diagnostics = [diagnostic];
    action.isPreferred = true;
    const text = document.getText();
    const section = codeSectionOffsets(text, document.fileName);
    const insertion = missingDelimiterInsertionPosition(document, diagnostic, section);
    const edit = new vscode.WorkspaceEdit();
    edit.insert(document.uri, insertion, missingDelimiterInsertionText(text, document.offsetAt(insertion), section, expected));
    action.edit = edit;
    return action;
}
function removeDiagnosticTextAction(document, diagnostic, title) {
    const action = new vscode.CodeAction(title, vscode.CodeActionKind.QuickFix);
    action.diagnostics = [diagnostic];
    action.isPreferred = true;
    const edit = new vscode.WorkspaceEdit();
    edit.delete(document.uri, diagnostic.range);
    action.edit = edit;
    return action;
}
function replaceDiagnosticTextAction(document, diagnostic, title, replacement) {
    const action = new vscode.CodeAction(title, vscode.CodeActionKind.QuickFix);
    action.diagnostics = [diagnostic];
    action.isPreferred = true;
    const edit = new vscode.WorkspaceEdit();
    edit.replace(document.uri, diagnostic.range, replacement);
    action.edit = edit;
    return action;
}
function removeUnexpectedEndAction(document, diagnostic) {
    const action = new vscode.CodeAction("Remove unexpected 'end'", vscode.CodeActionKind.QuickFix);
    action.diagnostics = [diagnostic];
    action.isPreferred = true;
    const edit = new vscode.WorkspaceEdit();
    edit.delete(document.uri, document.lineAt(diagnostic.range.start.line).rangeIncludingLineBreak);
    action.edit = edit;
    return action;
}
function diagnosticCode(diagnostic) {
    if (typeof diagnostic.code === "string") {
        return diagnostic.code;
    }
    if (typeof diagnostic.code === "number") {
        return diagnostic.code.toString();
    }
    return diagnostic.code?.value?.toString();
}
function expectedDelimiter(diagnostic) {
    return /Expected '([)\]}])'\./.exec(diagnostic.message)?.[1];
}
function missingEndInsertionPosition(document, diagnostic, section) {
    const text = document.getText();
    const code = text.slice(section.start, section.end);
    const diagnosticOffset = document.offsetAt(diagnostic.range.start) - section.start;
    const nextCallable = nextCallableOffset(code, diagnosticOffset);
    return document.positionAt(section.start + (nextCallable ?? code.length));
}
function missingEndInsertionText(text, insertionOffset, section) {
    if (insertionOffset < section.end) {
        return "end\n";
    }
    const needsLeadingNewline = insertionOffset > section.start && text[insertionOffset - 1] !== "\n";
    return `${needsLeadingNewline ? "\n" : ""}end`;
}
function missingDelimiterInsertionPosition(document, diagnostic, section) {
    const text = document.getText();
    const code = text.slice(section.start, section.end);
    const diagnosticOffset = document.offsetAt(diagnostic.range.start) - section.start;
    const nextEnd = nextStandaloneEndOffset(code, diagnosticOffset);
    return document.positionAt(section.start + (nextEnd ?? code.length));
}
function missingDelimiterInsertionText(text, insertionOffset, section, delimiter) {
    if (insertionOffset < section.end) {
        return `${delimiter}\n`;
    }
    const needsLeadingNewline = insertionOffset > section.start && text[insertionOffset - 1] !== "\n";
    return `${needsLeadingNewline ? "\n" : ""}${delimiter}`;
}
function nextCallableOffset(code, afterOffset) {
    const lines = splitSourceLines(code);
    const currentLineIndex = Math.max(0, lines.findIndex(line => afterOffset >= line.start && afterOffset <= line.end));
    for (let index = currentLineIndex + 1; index < lines.length; index += 1) {
        const line = lines[index];
        if (/^\s*(to-report|to)\s+[^\s\[\];]+/i.test(stripInlineComment(line.text))) {
            return line.start;
        }
    }
    return undefined;
}
function nextStandaloneEndOffset(code, afterOffset) {
    const lines = splitSourceLines(code);
    const currentLineIndex = Math.max(0, lines.findIndex(line => afterOffset >= line.start && afterOffset <= line.end));
    for (let index = currentLineIndex + 1; index < lines.length; index += 1) {
        const line = lines[index];
        if (/^\s*end\s*$/i.test(stripInlineComment(line.text))) {
            return line.start;
        }
    }
    return undefined;
}
function splitSourceLines(source) {
    if (source.length === 0) {
        return [];
    }
    const lines = [];
    let start = 0;
    while (start <= source.length) {
        const newline = source.indexOf("\n", start);
        if (newline < 0) {
            lines.push({ text: source.slice(start), start, end: source.length });
            break;
        }
        lines.push({ text: source.slice(start, newline), start, end: newline });
        start = newline + 1;
    }
    return lines;
}
function createNetLogoDocumentSymbolProvider() {
    return {
        provideDocumentSymbols(document) {
            if (!isNetLogoUri(document.uri)) {
                return [];
            }
            const text = document.getText();
            const model = (0, modelFormat_1.parseNetLogoModel)(text, document.fileName);
            const codeOffset = codeSectionOffset(text, document.fileName);
            return (0, modelSymbols_1.analyzeNetLogoCodeSymbols)(model.code).map(symbol => new vscode.DocumentSymbol(symbol.name, symbol.kind, vscodeSymbolKind(symbol.kind), new vscode.Range(document.positionAt(codeOffset + symbol.start), document.positionAt(codeOffset + symbol.end)), new vscode.Range(document.positionAt(codeOffset + symbol.selectionStart), document.positionAt(codeOffset + symbol.selectionEnd))));
        }
    };
}
function vscodeSymbolKind(kind) {
    switch (kind) {
        case "reporter":
            return vscode.SymbolKind.Function;
        case "declaration":
            return vscode.SymbolKind.Variable;
        case "procedure":
        default:
            return vscode.SymbolKind.Method;
    }
}
function createNetLogoHoverProvider() {
    return {
        provideHover(document, position) {
            const context = netLogoCodeContext(document, position);
            const definition = context ? (0, modelDefinitions_1.findNetLogoDefinition)(context.code, context.offset) : undefined;
            if (!context || !definition) {
                return undefined;
            }
            const markdown = new vscode.MarkdownString();
            markdown.appendMarkdown(`**NetLogo ${definition.kind}**\n\n`);
            markdown.appendCodeblock(definition.signature, "netlogo");
            return new vscode.Hover(markdown, new vscode.Range(document.positionAt(context.codeOffset + definition.sourceStart), document.positionAt(context.codeOffset + definition.sourceEnd)));
        }
    };
}
function createNetLogoDefinitionProvider() {
    return {
        provideDefinition(document, position) {
            if (!isNetLogoUri(document.uri)) {
                return undefined;
            }
            const text = document.getText();
            const model = (0, modelFormat_1.parseNetLogoModel)(text, document.fileName);
            const codeOffset = codeSectionOffset(text, document.fileName);
            const definition = (0, modelDefinitions_1.findNetLogoDefinition)(model.code, document.offsetAt(position) - codeOffset);
            if (!definition) {
                return undefined;
            }
            return new vscode.Location(document.uri, new vscode.Range(document.positionAt(codeOffset + definition.targetStart), document.positionAt(codeOffset + definition.targetEnd)));
        }
    };
}
function createNetLogoReferenceProvider() {
    return {
        provideReferences(document, position, context) {
            if (!isNetLogoUri(document.uri)) {
                return [];
            }
            const text = document.getText();
            const model = (0, modelFormat_1.parseNetLogoModel)(text, document.fileName);
            const codeOffset = codeSectionOffset(text, document.fileName);
            return (0, modelDefinitions_1.findNetLogoReferences)(model.code, document.offsetAt(position) - codeOffset, context.includeDeclaration)
                .map(reference => new vscode.Location(document.uri, new vscode.Range(document.positionAt(codeOffset + reference.start), document.positionAt(codeOffset + reference.end))));
        }
    };
}
function createNetLogoDocumentHighlightProvider() {
    return {
        provideDocumentHighlights(document, position) {
            if (!isNetLogoUri(document.uri)) {
                return [];
            }
            const text = document.getText();
            const model = (0, modelFormat_1.parseNetLogoModel)(text, document.fileName);
            const codeOffset = codeSectionOffset(text, document.fileName);
            return (0, modelDefinitions_1.findNetLogoReferences)(model.code, document.offsetAt(position) - codeOffset)
                .map(reference => new vscode.DocumentHighlight(new vscode.Range(document.positionAt(codeOffset + reference.start), document.positionAt(codeOffset + reference.end)), vscode.DocumentHighlightKind.Text));
        }
    };
}
function createNetLogoRenameProvider() {
    return {
        prepareRename(document, position) {
            const context = netLogoCodeContext(document, position);
            const definition = context ? (0, modelDefinitions_1.findNetLogoDefinition)(context.code, context.offset) : undefined;
            if (!context || !definition) {
                throw new Error("No user-defined NetLogo procedure or reporter at this location.");
            }
            return {
                range: new vscode.Range(document.positionAt(context.codeOffset + definition.sourceStart), document.positionAt(context.codeOffset + definition.sourceEnd)),
                placeholder: definition.name
            };
        },
        provideRenameEdits(document, position, newName) {
            if (!(0, modelDefinitions_1.isValidNetLogoProcedureName)(newName)) {
                throw new Error("NetLogo procedure and reporter names cannot be empty or contain whitespace, brackets, quotes, semicolons, or commas.");
            }
            const context = netLogoCodeContext(document, position);
            const references = context ? (0, modelDefinitions_1.findNetLogoReferences)(context.code, context.offset, true) : [];
            if (!context || references.length === 0) {
                throw new Error("No user-defined NetLogo procedure or reporter at this location.");
            }
            const edit = new vscode.WorkspaceEdit();
            for (const reference of references) {
                edit.replace(document.uri, new vscode.Range(document.positionAt(context.codeOffset + reference.start), document.positionAt(context.codeOffset + reference.end)), newName);
            }
            return edit;
        }
    };
}
function netLogoCodeContext(document, position) {
    if (!isNetLogoUri(document.uri)) {
        return undefined;
    }
    const text = document.getText();
    const model = (0, modelFormat_1.parseNetLogoModel)(text, document.fileName);
    const codeOffset = codeSectionOffset(text, document.fileName);
    return {
        code: model.code,
        codeOffset,
        offset: document.offsetAt(position) - codeOffset
    };
}
function codeSectionOffset(text, fileName) {
    return codeSectionOffsets(text, fileName).start;
}
function codeSectionOffsets(text, fileName) {
    if (!isXmlText(text, fileName)) {
        return { start: 0, end: text.length };
    }
    const match = /<code\b[^>]*>([\s\S]*?)<\/code>/i.exec(text);
    if (!match || match.index === undefined) {
        return { start: 0, end: text.length };
    }
    const contentStart = match.index + match[0].indexOf(">") + 1;
    const raw = match[1] ?? "";
    const cdata = raw.match(/^(\s*)<!\[CDATA\[/);
    if (!cdata) {
        return { start: contentStart, end: contentStart + raw.length };
    }
    const start = contentStart + cdata[1].length + "<![CDATA[".length;
    const cdataEnd = raw.lastIndexOf("]]>");
    const end = cdataEnd < 0 ? contentStart + raw.length : contentStart + cdataEnd;
    return { start, end };
}
function isXmlText(text, fileName) {
    return fileName.toLowerCase().endsWith(".nlogox") || /^\s*<\?xml[\s\S]*<netlogo/i.test(text) || /^\s*<netlogo/i.test(text);
}
function stripInlineComment(line) {
    let inString = false;
    for (let index = 0; index < line.length; index += 1) {
        const current = line[index];
        if (current === "\\" && inString) {
            index += 1;
            continue;
        }
        if (current === "\"") {
            inString = !inString;
            continue;
        }
        if (current === ";" && !inString) {
            return line.slice(0, index);
        }
    }
    return line;
}
async function openInNativeNetLogo(resource) {
    const uri = await resolveModelUri(resource);
    if (!uri) {
        return;
    }
    if (uri.scheme !== "file") {
        await vscode.env.openExternal(uri);
        return;
    }
    const appPath = process.platform === "darwin" ? nativeNetLogoAppForResource(uri) : undefined;
    if (!appPath) {
        await vscode.env.openExternal(uri);
        return;
    }
    await openFileWithMacApp(appPath, uri.fsPath);
}
function nativeNetLogoAppForResource(resource) {
    const config = vscode.workspace.getConfiguration("netlogo", resource);
    const installation = (0, netlogoInstallation_1.resolveNetLogoClassPath)({
        configuredClassPath: config.get("classPath", []),
        home: config.get("home", ""),
        autoDetect: config.get("autoDetect", true)
    });
    return installation ? (0, netlogoInstallation_1.findNativeNetLogoApp)(installation.home, { threeD: resource.fsPath.toLowerCase().endsWith(".nlogo3d") }) : undefined;
}
function openFileWithMacApp(appPath, filePath) {
    return new Promise((resolve, reject) => {
        const child = (0, child_process_1.spawn)("open", ["-a", appPath, filePath], {
            stdio: "ignore",
            detached: true
        });
        child.once("error", reject);
        child.once("close", code => {
            if (code === 0) {
                resolve();
            }
            else {
                reject(new Error(`open exited with code ${code ?? "unknown"}`));
            }
        });
        child.unref();
    }).catch(async () => {
        await vscode.env.openExternal(vscode.Uri.file(filePath));
    });
}
async function configureNetLogo() {
    const detected = (0, netlogoInstallation_1.detectNetLogoInstallations)();
    const picks = detected.map(installation => ({
        label: installation.home,
        description: installation.jarPath
    }));
    picks.push({
        label: "Browse...",
        description: "Choose a NetLogo folder or app"
    });
    const selected = await vscode.window.showQuickPick(picks, {
        title: "Configure NetLogo",
        placeHolder: detected.length > 0 ? "Select a detected NetLogo installation" : "Browse for a NetLogo installation"
    });
    if (!selected) {
        return;
    }
    let home = selected.label;
    if (selected.label === "Browse...") {
        const folders = await vscode.window.showOpenDialog({
            canSelectFiles: false,
            canSelectFolders: true,
            canSelectMany: false,
            title: "Select NetLogo folder or app"
        });
        if (!folders?.[0]) {
            return;
        }
        home = folders[0].fsPath;
    }
    const installation = (0, netlogoInstallation_1.installationFromHome)(home);
    if (!installation) {
        void vscode.window.showErrorMessage("Could not find NetLogo.jar in the selected location.");
        return;
    }
    const config = vscode.workspace.getConfiguration("netlogo");
    await config.update("home", installation.home, vscode.ConfigurationTarget.Global);
    await config.update("classPath", installation.classPath, vscode.ConfigurationTarget.Global);
    await config.update("jvmArgs", installation.jvmArgs, vscode.ConfigurationTarget.Global);
    await config.update("autoDetect", true, vscode.ConfigurationTarget.Global);
    void vscode.window.showInformationMessage(`Configured NetLogo: ${installation.home}`);
}
//# sourceMappingURL=extension.js.map