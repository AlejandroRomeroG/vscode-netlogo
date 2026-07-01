const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const root = path.join(__dirname, "..");

test("NetLogo files open with the model editor by default", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const editor = manifest.contributes.customEditors.find(candidate => candidate.viewType === "netlogo.modelEditor");

  assert.equal(editor.priority, "default");
  assert.match(manifest.description, /editing and running NetLogo models/);
  assert.equal(manifest.contributes.configuration.properties["netlogo.jvmArgs"].type, "array");
  assert.equal(manifest.contributes.configuration.properties["netlogo.verboseOutput"].default, false);
  assert.equal(manifest.contributes.configuration.properties["netlogo.commandTimeoutMs"].default, 60000);
  assert.ok(manifest.activationEvents.includes("onLanguage:netlogo"));
  assert.ok(manifest.activationEvents.includes("onCommand:netlogo.openInNetLogo"));
  assert.ok(manifest.activationEvents.includes("onCommand:netlogo.showOutput"));
  assert.ok(manifest.activationEvents.includes("onCommand:netlogo.clearCommandHistory"));
  assert.ok(manifest.contributes.commands.some(command => command.command === "netlogo.openInNetLogo"));
  assert.ok(manifest.contributes.commands.some(command => command.command === "netlogo.showOutput"));
  assert.ok(manifest.contributes.commands.some(command => command.command === "netlogo.clearCommandHistory"));
  assert.ok(manifest.contributes.languages[0].extensions.includes(".nlogox"));
  assert.equal(manifest.icon, "resources/icon.png");
  const icon = fs.readFileSync(path.join(root, manifest.icon));
  assert.equal(icon.subarray(1, 4).toString("ascii"), "PNG");
  assert.equal(icon.readUInt32BE(16), 128);
  assert.equal(icon.readUInt32BE(20), 128);
  assert.equal(icon[25], 6);
});

test("webview starts in traditional NetLogo tab order", () => {
  const source = fs.readFileSync(path.join(root, "src", "netlogoEditor.ts"), "utf8");
  const nav = source.match(/<nav class="tabs"[\s\S]*?<\/nav>/)?.[0] ?? "";

  const interfaceIndex = nav.indexOf('data-tab="interface"');
  const infoIndex = nav.indexOf('data-tab="info"');
  const codeIndex = nav.indexOf('data-tab="code"');

  assert.ok(interfaceIndex >= 0);
  assert.ok(infoIndex > interfaceIndex);
  assert.ok(codeIndex > infoIndex);
  assert.match(source, /<section id="interfacePane" class="pane active" role="tabpanel">/);
  assert.match(source, /activeTab:\s*validUiTab\(restoredUiState\.activeTab\)/);
});

test("model editor webviews retain running state and rehydrate when needed", () => {
  const source = fs.readFileSync(path.join(root, "src", "netlogoEditor.ts"), "utf8");

  assert.match(source, /supportsMultipleEditorsPerDocument:\s*true/);
  assert.match(source, /retainContextWhenHidden:\s*true/);
  assert.match(source, /workbench\.action\.keepEditor/);
  assert.match(source, /webviewPanel\.onDidChangeViewState/);
  assert.match(source, /event\.webviewPanel\.visible/);
  assert.match(source, /viewStateSubscription\.dispose\(\)/);
  assert.match(source, /message\.type === "ready"/);
  assert.match(source, /vscode\.postMessage\(\{ type: "ready" \}\)/);
});

test("extension opens NetLogo model editor tabs as pinned editors", () => {
  const source = fs.readFileSync(path.join(root, "src", "extension.ts"), "utf8");

  assert.match(source, /vscode\.openWith", uri, NetLogoModelEditorProvider\.viewType, \{ preview: false \}/);
  assert.match(source, /tabGroups\.onDidChangeTabs\(\(\) => keepActivePreviewTabWhenNetLogoEditorsAreOpen\(\)\)/);
  assert.match(source, /function keepActivePreviewTabWhenNetLogoEditorsAreOpen\(\): void/);
  assert.match(source, /activeTab\?\.isPreview/);
  assert.match(source, /!hasOpenNetLogoModelEditorTab\(\)/);
  assert.match(source, /workbench\.action\.keepEditor/);
  assert.match(source, /function hasOpenNetLogoModelEditorTab\(\): boolean/);
  assert.match(source, /function isNetLogoModelEditorTab\(tab: vscode\.Tab\): boolean/);
  assert.match(source, /tab\.input instanceof vscode\.TabInputCustom/);
  assert.match(source, /tab\.input\.viewType === NetLogoModelEditorProvider\.viewType/);
});

test("extension registers native NetLogo open command", () => {
  const source = fs.readFileSync(path.join(root, "src", "extension.ts"), "utf8");

  assert.match(source, /registerCommand\("netlogo\.openInNetLogo"/);
  assert.match(source, /function openInNativeNetLogo\(resource\?: vscode\.Uri\)/);
  assert.match(source, /function nativeNetLogoAppForResource\(resource: vscode\.Uri\)/);
  assert.match(source, /findNativeNetLogoApp\(installation\.home, \{ threeD: resource\.fsPath\.toLowerCase\(\)\.endsWith\("\.nlogo3d"\) \}\)/);
  assert.match(source, /await runMacOpen\(\["-a", appPath\]\)/);
  assert.match(source, /await runMacOpen\(\["-a", appPath, filePath\]\)/);
  assert.match(source, /spawn\("open", args/);
  assert.match(source, /vscode\.env\.openExternal\(uri\)/);
});

test("extension registers output channel command", () => {
  const source = fs.readFileSync(path.join(root, "src", "extension.ts"), "utf8");

  assert.match(source, /registerCommand\("netlogo\.showOutput"/);
  assert.match(source, /output\.show\(true\)/);
});

test("extension registers NetLogo code diagnostics", () => {
  const source = fs.readFileSync(path.join(root, "src", "extension.ts"), "utf8");
  const diagnosticsSource = fs.readFileSync(path.join(root, "src", "modelDiagnostics.ts"), "utf8");

  assert.match(source, /createDiagnosticCollection\("netlogo"\)/);
  assert.match(source, /onDidOpenTextDocument\(document => updateNetLogoDiagnostics\(document, diagnostics\)\)/);
  assert.match(source, /onDidChangeTextDocument\(event => updateNetLogoDiagnostics\(event\.document, diagnostics\)\)/);
  assert.match(source, /onDidCloseTextDocument\(document => diagnostics\.delete\(document\.uri\)\)/);
  assert.match(source, /for \(const document of vscode\.workspace\.textDocuments\)/);
  assert.match(source, /function updateNetLogoDiagnostics/);
  assert.match(source, /parseNetLogoModel\(text, document\.fileName\)/);
  assert.match(source, /analyzeNetLogoCode\(model\.code\)/);
  assert.match(source, /vscode\.DiagnosticSeverity\.Warning/);
  assert.match(source, /diagnostic\.source = "NetLogo"/);
  assert.match(source, /diagnostic\.code = item\.code/);
  assert.match(source, /registerCodeActionsProvider\(/);
  assert.match(source, /createNetLogoCodeActionProvider\(\)/);
  assert.match(source, /vscode\.CodeActionKind\.QuickFix/);
  assert.match(source, /Insert missing 'end'/);
  assert.match(source, /Remove unexpected 'end'/);
  assert.match(source, /Insert closing quote/);
  assert.match(source, /Remove unexpected '\$\{document\.getText\(diagnostic\.range\)\}'/);
  assert.match(source, /Replace with '\$\{expected\}'/);
  assert.match(source, /Insert missing '\$\{expected\}'/);
  assert.match(source, /function codeSectionOffset\(text: string, fileName: string\)/);
  assert.match(diagnosticsSource, /analyzeNetLogoCodeSymbols/);
  assert.match(diagnosticsSource, /function duplicateCallableDiagnostics/);
  assert.match(diagnosticsSource, /function callableBoundaryDiagnostics/);
  assert.match(diagnosticsSource, /Duplicate NetLogo/);
  assert.match(diagnosticsSource, /Missing 'end' for NetLogo/);
  assert.match(diagnosticsSource, /Unexpected 'end' outside a NetLogo procedure or reporter\./);
  assert.match(diagnosticsSource, /netlogo\.unterminatedString/);
  assert.match(diagnosticsSource, /netlogo\.unexpectedClosingDelimiter/);
  assert.match(diagnosticsSource, /netlogo\.mismatchedClosingDelimiter/);
  assert.match(diagnosticsSource, /netlogo\.unclosedDelimiter/);
  assert.match(diagnosticsSource, /netlogo\.missingEnd/);
  assert.match(diagnosticsSource, /netlogo\.unexpectedEnd/);
});

test("extension registers NetLogo text completions", () => {
  const source = fs.readFileSync(path.join(root, "src", "extension.ts"), "utf8");

  assert.match(source, /createNetLogoCompletionProvider/);
  assert.match(source, /registerCompletionItemProvider\(/);
  assert.match(source, /\{ language: "netlogo", scheme: "file" \}/);
});

test("extension registers NetLogo document symbols", () => {
  const source = fs.readFileSync(path.join(root, "src", "extension.ts"), "utf8");

  assert.match(source, /analyzeNetLogoCodeSymbols/);
  assert.match(source, /registerDocumentSymbolProvider\(/);
  assert.match(source, /createNetLogoDocumentSymbolProvider\(\)/);
  assert.match(source, /function createNetLogoDocumentSymbolProvider\(\): vscode\.DocumentSymbolProvider/);
  assert.match(source, /parseNetLogoModel\(text, document\.fileName\)/);
  assert.match(source, /codeSectionOffset\(text, document\.fileName\)/);
  assert.match(source, /new vscode\.DocumentSymbol/);
  assert.match(source, /function vscodeSymbolKind\(kind: CodeSymbolKind\): vscode\.SymbolKind/);
  assert.match(source, /vscode\.SymbolKind\.Method/);
  assert.match(source, /vscode\.SymbolKind\.Function/);
  assert.match(source, /vscode\.SymbolKind\.Variable/);
});

test("extension registers NetLogo hover provider", () => {
  const source = fs.readFileSync(path.join(root, "src", "extension.ts"), "utf8");

  assert.match(source, /registerHoverProvider\(/);
  assert.match(source, /createNetLogoHoverProvider\(\)/);
  assert.match(source, /function createNetLogoHoverProvider\(\): vscode\.HoverProvider/);
  assert.match(source, /provideHover\(document, position\)/);
  assert.match(source, /NetLogo \$\{definition\.kind\}/);
  assert.match(source, /appendCodeblock\(definition\.signature, "netlogo"\)/);
  assert.match(source, /new vscode\.Hover/);
});

test("extension registers NetLogo definition provider", () => {
  const source = fs.readFileSync(path.join(root, "src", "extension.ts"), "utf8");

  assert.match(source, /findNetLogoDefinition/);
  assert.match(source, /registerDefinitionProvider\(/);
  assert.match(source, /createNetLogoDefinitionProvider\(\)/);
  assert.match(source, /function createNetLogoDefinitionProvider\(\): vscode\.DefinitionProvider/);
  assert.match(source, /document\.offsetAt\(position\) - codeOffset/);
  assert.match(source, /new vscode\.Location/);
});

test("extension registers NetLogo references and highlights", () => {
  const source = fs.readFileSync(path.join(root, "src", "extension.ts"), "utf8");

  assert.match(source, /findNetLogoReferences/);
  assert.match(source, /registerReferenceProvider\(/);
  assert.match(source, /createNetLogoReferenceProvider\(\)/);
  assert.match(source, /function createNetLogoReferenceProvider\(\): vscode\.ReferenceProvider/);
  assert.match(source, /context\.includeDeclaration/);
  assert.match(source, /registerDocumentHighlightProvider\(/);
  assert.match(source, /createNetLogoDocumentHighlightProvider\(\)/);
  assert.match(source, /function createNetLogoDocumentHighlightProvider\(\): vscode\.DocumentHighlightProvider/);
  assert.match(source, /new vscode\.DocumentHighlight/);
  assert.match(source, /vscode\.DocumentHighlightKind\.Text/);
});

test("extension registers NetLogo rename provider", () => {
  const source = fs.readFileSync(path.join(root, "src", "extension.ts"), "utf8");

  assert.match(source, /isValidNetLogoProcedureName/);
  assert.match(source, /registerRenameProvider\(/);
  assert.match(source, /createNetLogoRenameProvider\(\)/);
  assert.match(source, /function createNetLogoRenameProvider\(\): vscode\.RenameProvider/);
  assert.match(source, /prepareRename\(document, position\)/);
  assert.match(source, /provideRenameEdits\(document, position, newName\)/);
  assert.match(source, /new vscode\.WorkspaceEdit\(\)/);
  assert.match(source, /edit\.replace\(/);
});

test("extension command prompt remembers the last NetLogo command", () => {
  const source = fs.readFileSync(path.join(root, "src", "extension.ts"), "utf8");
  const commandPromptSource = fs.readFileSync(path.join(root, "src", "commandPrompt.ts"), "utf8");

  assert.match(source, /promptForNetLogoCommand\(context/);
  assert.match(source, /rememberNetLogoCommand\(context, command\)/);
  assert.match(source, /rememberNetLogoCommand\(context, "setup"\)/);
  assert.match(source, /rememberNetLogoCommand\(context, "go"\)/);
  assert.match(commandPromptSource, /COMMAND_HISTORY_KEY = "netlogo\.commandHistory"/);
  assert.match(commandPromptSource, /LEGACY_LAST_COMMAND_KEY = "netlogo\.lastCommand"/);
  assert.match(commandPromptSource, /MAX_COMMAND_HISTORY = 8/);
  assert.match(commandPromptSource, /COMMON_NETLOGO_COMMANDS = \[/);
  assert.match(commandPromptSource, /showQuickPick<NetLogoCommandPick>/);
  assert.match(commandPromptSource, /buildNetLogoCommandPicks\(history\)/);
  assert.match(commandPromptSource, /QuickPickItemKind\.Separator/);
  assert.match(commandPromptSource, /value: lastCommand/);
  assert.match(commandPromptSource, /globalState\.update\(COMMAND_HISTORY_KEY, nextHistory\)/);
  assert.match(commandPromptSource, /globalState\.update\(LEGACY_LAST_COMMAND_KEY, normalizedCommand\)/);
});

test("extension registers command history clearing", () => {
  const source = fs.readFileSync(path.join(root, "src", "extension.ts"), "utf8");
  const commandPromptSource = fs.readFileSync(path.join(root, "src", "commandPrompt.ts"), "utf8");

  assert.match(source, /registerCommand\("netlogo\.clearCommandHistory"/);
  assert.match(source, /clearNetLogoCommandHistory\(context\)/);
  assert.match(source, /NetLogo command history cleared\./);
  assert.match(commandPromptSource, /export async function clearNetLogoCommandHistory/);
  assert.match(commandPromptSource, /globalState\.update\(COMMAND_HISTORY_KEY, undefined\)/);
  assert.match(commandPromptSource, /globalState\.update\(LEGACY_LAST_COMMAND_KEY, undefined\)/);
});
