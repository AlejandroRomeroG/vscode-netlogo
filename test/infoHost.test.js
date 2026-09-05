const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Module = require("node:module");
const test = require("node:test");

test("Info host validates navigation and local image messages without starting or changing a model", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "netlogo-info-host-"));
  const originalLoad = Module._load;
  try {
    const opened = [], commands = [], messages = [], warnings = [];
    const disposable = { dispose() {} };
    const vscode = {
      Uri: { joinPath: (_base, ...parts) => ({ toString: () => parts.join("/") }), parse: value => value, file: value => value },
      env: { openExternal: async uri => { opened.push(uri); return true; } },
      commands: { executeCommand: async (...args) => commands.push(args) },
      window: { showWarningMessage: async message => warnings.push(message) },
      workspace: { onDidChangeTextDocument: () => disposable }
    };
    Module._load = (request, parent, isMain) => request === "vscode" ? vscode : originalLoad.call(Module, request, parent, isMain);
    const Provider = require("../out/netlogoEditor").NetLogoModelEditorProvider;
    Module._load = originalLoad;
    const provider = new Provider({ extensionUri: {} }, {}, { appendLine() {} });
    provider.isRuntimeConfigured = () => true;
    let receive;
    await provider.resolveCustomTextEditor({
      fileName: path.join(directory, "Example.nlogo"), uri: { toString: () => "example" }, version: 1,
      getText: () => "to setup\nend\n@#$#@#$#@\n@#$#@#$#@\n"
    }, {
      webview: { cspSource: "test", asWebviewUri: value => value, postMessage: async message => { messages.push(message); return true; },
        onDidReceiveMessage: listener => { receive = listener; } },
      onDidChangeViewState: () => disposable, onDidDispose: () => disposable
    });
    commands.length = 0; // Ignore the editor's existing keep-preview-tab action.
    const bytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aSncAAAAASUVORK5CYII=", "base64");
    const file = path.join(directory, "Example.png");
    fs.writeFileSync(file, bytes);
    await receive({ type: "info-image", requestId: "1", href: "file:Example.png" });
    assert.deepEqual(messages.at(-1), { type: "info-image-result", requestId: "1", data: "data:image/png;base64," + bytes.toString("base64") });
    await receive({ type: "info-image", requestId: "2", href: "../outside.png" });
    assert.equal(messages.at(-1).requestId, "2");
    assert.match(messages.at(-1).error, /inside the model directory/);
    await receive({ type: "info-link", href: "https://example.org/documentation" });
    await receive({ type: "info-link", href: "file:Example.png" });
    await receive({ type: "info-link", href: "command:workbench.action.closeWindow" });
    assert.deepEqual(opened, ["https://example.org/documentation"]);
    assert.deepEqual(commands, [["vscode.open", fs.realpathSync(file)]]);
    assert.equal(warnings.length, 1);
    const count = messages.length;
    await receive({ type: "info-image", requestId: {}, href: "Example.png" });
    await receive({ type: "info-link", href: 42 });
    assert.equal(messages.length, count);
  } finally {
    Module._load = originalLoad;
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
