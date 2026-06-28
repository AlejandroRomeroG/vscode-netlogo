import * as vscode from "vscode";
import { spawn } from "child_process";
import { clearNetLogoCommandHistory, promptForNetLogoCommand, rememberNetLogoCommand } from "./commandPrompt";
import { findNetLogoDefinition, findNetLogoReferences, isValidNetLogoProcedureName } from "./modelDefinitions";
import { analyzeNetLogoCode } from "./modelDiagnostics";
import { analyzeNetLogoCodeSymbols, type CodeSymbolKind } from "./modelSymbols";
import { parseNetLogoModel } from "./modelFormat";
import { createNetLogoCompletionProvider } from "./netlogoCompletions";
import { NetLogoModelEditorProvider } from "./netlogoEditor";
import { detectNetLogoInstallations, findNativeNetLogoApp, installationFromHome, resolveNetLogoClassPath } from "./netlogoInstallation";
import { NetLogoRunner } from "./runner";

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel("NetLogo");
  const runner = new NetLogoRunner(context, output);
  const diagnostics = vscode.languages.createDiagnosticCollection("netlogo");

  context.subscriptions.push(
    output,
    runner,
    diagnostics,
    vscode.languages.registerCompletionItemProvider(
      { language: "netlogo", scheme: "file" },
      createNetLogoCompletionProvider()
    ),
    vscode.languages.registerDocumentSymbolProvider(
      { language: "netlogo", scheme: "file" },
      createNetLogoDocumentSymbolProvider()
    ),
    vscode.languages.registerHoverProvider(
      { language: "netlogo", scheme: "file" },
      createNetLogoHoverProvider()
    ),
    vscode.languages.registerDefinitionProvider(
      { language: "netlogo", scheme: "file" },
      createNetLogoDefinitionProvider()
    ),
    vscode.languages.registerReferenceProvider(
      { language: "netlogo", scheme: "file" },
      createNetLogoReferenceProvider()
    ),
    vscode.languages.registerDocumentHighlightProvider(
      { language: "netlogo", scheme: "file" },
      createNetLogoDocumentHighlightProvider()
    ),
    vscode.languages.registerRenameProvider(
      { language: "netlogo", scheme: "file" },
      createNetLogoRenameProvider()
    ),
    vscode.languages.registerCodeActionsProvider(
      { language: "netlogo", scheme: "file" },
      createNetLogoCodeActionProvider(),
      { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] }
    ),
    NetLogoModelEditorProvider.register(context, runner),
    vscode.workspace.onDidOpenTextDocument(document => updateNetLogoDiagnostics(document, diagnostics)),
    vscode.workspace.onDidChangeTextDocument(event => updateNetLogoDiagnostics(event.document, diagnostics)),
    vscode.workspace.onDidCloseTextDocument(document => diagnostics.delete(document.uri)),
    vscode.commands.registerCommand("netlogo.openModelEditor", async (resource?: vscode.Uri) => {
      const uri = await resolveModelUri(resource);
      if (uri) {
        await vscode.commands.executeCommand("vscode.openWith", uri, NetLogoModelEditorProvider.viewType);
      }
    }),
    vscode.commands.registerCommand("netlogo.openInNetLogo", async (resource?: vscode.Uri) => {
      await openInNativeNetLogo(resource);
    }),
    vscode.commands.registerCommand("netlogo.showOutput", () => {
      output.show(true);
    }),
    vscode.commands.registerCommand("netlogo.configure", async () => {
      await configureNetLogo();
    }),
    vscode.commands.registerCommand("netlogo.runSetup", async (resource?: vscode.Uri) => {
      await rememberNetLogoCommand(context, "setup");
      return runner.run(resource, "setup");
    }),
    vscode.commands.registerCommand("netlogo.runGoOnce", async (resource?: vscode.Uri) => {
      await rememberNetLogoCommand(context, "go");
      return runner.run(resource, "go");
    }),
    vscode.commands.registerCommand("netlogo.runCommand", async (resource?: vscode.Uri, providedCommand?: string) => {
      const command = providedCommand?.trim() ?? await promptForNetLogoCommand(context, {
        prompt: "Command to run once in a headless workspace"
      });

      if (command) {
        if (providedCommand) {
          await rememberNetLogoCommand(context, command);
        }
        return runner.run(resource, command);
      }

      return undefined;
    }),
    vscode.commands.registerCommand("netlogo.clearCommandHistory", async () => {
      await clearNetLogoCommandHistory(context);
      void vscode.window.showInformationMessage("NetLogo command history cleared.");
    })
  );

  for (const document of vscode.workspace.textDocuments) {
    updateNetLogoDiagnostics(document, diagnostics);
  }
}

export function deactivate(): void {
}

async function resolveModelUri(resource?: vscode.Uri): Promise<vscode.Uri | undefined> {
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

function isNetLogoUri(uri: vscode.Uri): boolean {
  const path = uri.fsPath.toLowerCase();
  return path.endsWith(".nlogo") || path.endsWith(".nlogox") || path.endsWith(".nlogo3d");
}

function updateNetLogoDiagnostics(
  document: vscode.TextDocument,
  collection: vscode.DiagnosticCollection
): void {
  if (!isNetLogoUri(document.uri)) {
    return;
  }

  const text = document.getText();
  const model = parseNetLogoModel(text, document.fileName);
  const codeOffset = codeSectionOffset(text, document.fileName);
  const diagnostics = analyzeNetLogoCode(model.code).map(item => {
    const diagnostic = new vscode.Diagnostic(
      new vscode.Range(
        document.positionAt(codeOffset + item.start),
        document.positionAt(codeOffset + item.end)
      ),
      item.message,
      vscode.DiagnosticSeverity.Warning
    );
    diagnostic.source = "NetLogo";
    diagnostic.code = item.code;
    return diagnostic;
  });
  collection.set(document.uri, diagnostics);
}

function createNetLogoCodeActionProvider(): vscode.CodeActionProvider {
  return {
    provideCodeActions(document, _range, context) {
      if (!isNetLogoUri(document.uri)) {
        return [];
      }

      const actions: vscode.CodeAction[] = [];
      for (const diagnostic of context.diagnostics) {
        if (diagnostic.source !== "NetLogo") {
          continue;
        }

        const code = diagnosticCode(diagnostic);
        if (code === "netlogo.missingEnd") {
          actions.push(insertMissingEndAction(document, diagnostic));
        } else if (code === "netlogo.unexpectedEnd") {
          actions.push(removeUnexpectedEndAction(document, diagnostic));
        } else if (code === "netlogo.unterminatedString") {
          actions.push(insertClosingQuoteAction(document, diagnostic));
        } else if (code === "netlogo.unexpectedClosingDelimiter") {
          actions.push(removeDiagnosticTextAction(document, diagnostic, `Remove unexpected '${document.getText(diagnostic.range)}'`));
        } else if (code === "netlogo.mismatchedClosingDelimiter") {
          const expected = expectedDelimiter(diagnostic);
          if (expected) {
            actions.push(replaceDiagnosticTextAction(document, diagnostic, `Replace with '${expected}'`, expected));
          }
        } else if (code === "netlogo.unclosedDelimiter") {
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

function insertMissingEndAction(document: vscode.TextDocument, diagnostic: vscode.Diagnostic): vscode.CodeAction {
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

function insertClosingQuoteAction(document: vscode.TextDocument, diagnostic: vscode.Diagnostic): vscode.CodeAction {
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

function insertMissingDelimiterAction(
  document: vscode.TextDocument,
  diagnostic: vscode.Diagnostic,
  expected: string
): vscode.CodeAction {
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

function removeDiagnosticTextAction(
  document: vscode.TextDocument,
  diagnostic: vscode.Diagnostic,
  title: string
): vscode.CodeAction {
  const action = new vscode.CodeAction(title, vscode.CodeActionKind.QuickFix);
  action.diagnostics = [diagnostic];
  action.isPreferred = true;

  const edit = new vscode.WorkspaceEdit();
  edit.delete(document.uri, diagnostic.range);
  action.edit = edit;
  return action;
}

function replaceDiagnosticTextAction(
  document: vscode.TextDocument,
  diagnostic: vscode.Diagnostic,
  title: string,
  replacement: string
): vscode.CodeAction {
  const action = new vscode.CodeAction(title, vscode.CodeActionKind.QuickFix);
  action.diagnostics = [diagnostic];
  action.isPreferred = true;

  const edit = new vscode.WorkspaceEdit();
  edit.replace(document.uri, diagnostic.range, replacement);
  action.edit = edit;
  return action;
}

function removeUnexpectedEndAction(document: vscode.TextDocument, diagnostic: vscode.Diagnostic): vscode.CodeAction {
  const action = new vscode.CodeAction("Remove unexpected 'end'", vscode.CodeActionKind.QuickFix);
  action.diagnostics = [diagnostic];
  action.isPreferred = true;

  const edit = new vscode.WorkspaceEdit();
  edit.delete(document.uri, document.lineAt(diagnostic.range.start.line).rangeIncludingLineBreak);
  action.edit = edit;
  return action;
}

function diagnosticCode(diagnostic: vscode.Diagnostic): string | undefined {
  if (typeof diagnostic.code === "string") {
    return diagnostic.code;
  }
  if (typeof diagnostic.code === "number") {
    return diagnostic.code.toString();
  }
  return diagnostic.code?.value?.toString();
}

function expectedDelimiter(diagnostic: vscode.Diagnostic): string | undefined {
  return /Expected '([)\]}])'\./.exec(diagnostic.message)?.[1];
}

interface CodeSectionOffsets {
  readonly start: number;
  readonly end: number;
}

interface SourceLine {
  readonly text: string;
  readonly start: number;
  readonly end: number;
}

function missingEndInsertionPosition(
  document: vscode.TextDocument,
  diagnostic: vscode.Diagnostic,
  section: CodeSectionOffsets
): vscode.Position {
  const text = document.getText();
  const code = text.slice(section.start, section.end);
  const diagnosticOffset = document.offsetAt(diagnostic.range.start) - section.start;
  const nextCallable = nextCallableOffset(code, diagnosticOffset);
  return document.positionAt(section.start + (nextCallable ?? code.length));
}

function missingEndInsertionText(text: string, insertionOffset: number, section: CodeSectionOffsets): string {
  if (insertionOffset < section.end) {
    return "end\n";
  }

  const needsLeadingNewline = insertionOffset > section.start && text[insertionOffset - 1] !== "\n";
  return `${needsLeadingNewline ? "\n" : ""}end`;
}

function missingDelimiterInsertionPosition(
  document: vscode.TextDocument,
  diagnostic: vscode.Diagnostic,
  section: CodeSectionOffsets
): vscode.Position {
  const text = document.getText();
  const code = text.slice(section.start, section.end);
  const diagnosticOffset = document.offsetAt(diagnostic.range.start) - section.start;
  const nextEnd = nextStandaloneEndOffset(code, diagnosticOffset);
  return document.positionAt(section.start + (nextEnd ?? code.length));
}

function missingDelimiterInsertionText(
  text: string,
  insertionOffset: number,
  section: CodeSectionOffsets,
  delimiter: string
): string {
  if (insertionOffset < section.end) {
    return `${delimiter}\n`;
  }

  const needsLeadingNewline = insertionOffset > section.start && text[insertionOffset - 1] !== "\n";
  return `${needsLeadingNewline ? "\n" : ""}${delimiter}`;
}

function nextCallableOffset(code: string, afterOffset: number): number | undefined {
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

function nextStandaloneEndOffset(code: string, afterOffset: number): number | undefined {
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

function splitSourceLines(source: string): SourceLine[] {
  if (source.length === 0) {
    return [];
  }

  const lines: SourceLine[] = [];
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

function createNetLogoDocumentSymbolProvider(): vscode.DocumentSymbolProvider {
  return {
    provideDocumentSymbols(document) {
      if (!isNetLogoUri(document.uri)) {
        return [];
      }

      const text = document.getText();
      const model = parseNetLogoModel(text, document.fileName);
      const codeOffset = codeSectionOffset(text, document.fileName);
      return analyzeNetLogoCodeSymbols(model.code).map(symbol => new vscode.DocumentSymbol(
        symbol.name,
        symbol.kind,
        vscodeSymbolKind(symbol.kind),
        new vscode.Range(
          document.positionAt(codeOffset + symbol.start),
          document.positionAt(codeOffset + symbol.end)
        ),
        new vscode.Range(
          document.positionAt(codeOffset + symbol.selectionStart),
          document.positionAt(codeOffset + symbol.selectionEnd)
        )
      ));
    }
  };
}

function vscodeSymbolKind(kind: CodeSymbolKind): vscode.SymbolKind {
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

function createNetLogoHoverProvider(): vscode.HoverProvider {
  return {
    provideHover(document, position) {
      const context = netLogoCodeContext(document, position);
      const definition = context ? findNetLogoDefinition(context.code, context.offset) : undefined;
      if (!context || !definition) {
        return undefined;
      }

      const markdown = new vscode.MarkdownString();
      markdown.appendMarkdown(`**NetLogo ${definition.kind}**\n\n`);
      markdown.appendCodeblock(definition.signature, "netlogo");
      return new vscode.Hover(
        markdown,
        new vscode.Range(
          document.positionAt(context.codeOffset + definition.sourceStart),
          document.positionAt(context.codeOffset + definition.sourceEnd)
        )
      );
    }
  };
}

function createNetLogoDefinitionProvider(): vscode.DefinitionProvider {
  return {
    provideDefinition(document, position) {
      if (!isNetLogoUri(document.uri)) {
        return undefined;
      }

      const text = document.getText();
      const model = parseNetLogoModel(text, document.fileName);
      const codeOffset = codeSectionOffset(text, document.fileName);
      const definition = findNetLogoDefinition(model.code, document.offsetAt(position) - codeOffset);
      if (!definition) {
        return undefined;
      }

      return new vscode.Location(
        document.uri,
        new vscode.Range(
          document.positionAt(codeOffset + definition.targetStart),
          document.positionAt(codeOffset + definition.targetEnd)
        )
      );
    }
  };
}

function createNetLogoReferenceProvider(): vscode.ReferenceProvider {
  return {
    provideReferences(document, position, context) {
      if (!isNetLogoUri(document.uri)) {
        return [];
      }

      const text = document.getText();
      const model = parseNetLogoModel(text, document.fileName);
      const codeOffset = codeSectionOffset(text, document.fileName);
      return findNetLogoReferences(model.code, document.offsetAt(position) - codeOffset, context.includeDeclaration)
        .map(reference => new vscode.Location(
          document.uri,
          new vscode.Range(
            document.positionAt(codeOffset + reference.start),
            document.positionAt(codeOffset + reference.end)
          )
        ));
    }
  };
}

function createNetLogoDocumentHighlightProvider(): vscode.DocumentHighlightProvider {
  return {
    provideDocumentHighlights(document, position) {
      if (!isNetLogoUri(document.uri)) {
        return [];
      }

      const text = document.getText();
      const model = parseNetLogoModel(text, document.fileName);
      const codeOffset = codeSectionOffset(text, document.fileName);
      return findNetLogoReferences(model.code, document.offsetAt(position) - codeOffset)
        .map(reference => new vscode.DocumentHighlight(
          new vscode.Range(
            document.positionAt(codeOffset + reference.start),
            document.positionAt(codeOffset + reference.end)
          ),
          vscode.DocumentHighlightKind.Text
        ));
    }
  };
}

function createNetLogoRenameProvider(): vscode.RenameProvider {
  return {
    prepareRename(document, position) {
      const context = netLogoCodeContext(document, position);
      const definition = context ? findNetLogoDefinition(context.code, context.offset) : undefined;
      if (!context || !definition) {
        throw new Error("No user-defined NetLogo procedure or reporter at this location.");
      }

      return {
        range: new vscode.Range(
          document.positionAt(context.codeOffset + definition.sourceStart),
          document.positionAt(context.codeOffset + definition.sourceEnd)
        ),
        placeholder: definition.name
      };
    },
    provideRenameEdits(document, position, newName) {
      if (!isValidNetLogoProcedureName(newName)) {
        throw new Error("NetLogo procedure and reporter names cannot be empty or contain whitespace, brackets, quotes, semicolons, or commas.");
      }

      const context = netLogoCodeContext(document, position);
      const references = context ? findNetLogoReferences(context.code, context.offset, true) : [];
      if (!context || references.length === 0) {
        throw new Error("No user-defined NetLogo procedure or reporter at this location.");
      }

      const edit = new vscode.WorkspaceEdit();
      for (const reference of references) {
        edit.replace(
          document.uri,
          new vscode.Range(
            document.positionAt(context.codeOffset + reference.start),
            document.positionAt(context.codeOffset + reference.end)
          ),
          newName
        );
      }
      return edit;
    }
  };
}

function netLogoCodeContext(
  document: vscode.TextDocument,
  position: vscode.Position
): { code: string; codeOffset: number; offset: number } | undefined {
  if (!isNetLogoUri(document.uri)) {
    return undefined;
  }

  const text = document.getText();
  const model = parseNetLogoModel(text, document.fileName);
  const codeOffset = codeSectionOffset(text, document.fileName);
  return {
    code: model.code,
    codeOffset,
    offset: document.offsetAt(position) - codeOffset
  };
}

function codeSectionOffset(text: string, fileName: string): number {
  return codeSectionOffsets(text, fileName).start;
}

function codeSectionOffsets(text: string, fileName: string): CodeSectionOffsets {
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

function isXmlText(text: string, fileName: string): boolean {
  return fileName.toLowerCase().endsWith(".nlogox") || /^\s*<\?xml[\s\S]*<netlogo/i.test(text) || /^\s*<netlogo/i.test(text);
}

function stripInlineComment(line: string): string {
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

async function openInNativeNetLogo(resource?: vscode.Uri): Promise<void> {
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

function nativeNetLogoAppForResource(resource: vscode.Uri): string | undefined {
  const config = vscode.workspace.getConfiguration("netlogo", resource);
  const installation = resolveNetLogoClassPath({
    configuredClassPath: config.get<string[]>("classPath", []),
    home: config.get<string>("home", ""),
    autoDetect: config.get<boolean>("autoDetect", true)
  });
  return installation ? findNativeNetLogoApp(installation.home, { threeD: resource.fsPath.toLowerCase().endsWith(".nlogo3d") }) : undefined;
}

function openFileWithMacApp(appPath: string, filePath: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const child = spawn("open", ["-a", appPath, filePath], {
      stdio: "ignore",
      detached: true
    });
    child.once("error", reject);
    child.once("close", code => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`open exited with code ${code ?? "unknown"}`));
      }
    });
    child.unref();
  }).catch(async () => {
    await vscode.env.openExternal(vscode.Uri.file(filePath));
  });
}

async function configureNetLogo(): Promise<void> {
  const detected = detectNetLogoInstallations();
  const picks: vscode.QuickPickItem[] = detected.map(installation => ({
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

  const installation = installationFromHome(home);
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
