const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const test = require("node:test");

const source = fs.readFileSync(require.resolve("../out/netlogoEditor"), "utf8");
function fragment(from, to) {
  const start = source.indexOf(from), end = source.indexOf(to, start);
  assert.ok(start >= 0 && end > start);
  return source.slice(start, end);
}

test("status transitions go to Output without a DOM badge or one log per Forever tick", () => {
  const state = { lastStatusMessage: null, runLoop: null };
  const messages = [];
  const vscode = { postMessage: message => messages.push(message) };
  const { setStatus, postRunCommand } = new Function("state", "vscode", "updateRuntimeBanner", [
    fragment("function setStatus(", "function updateEditorLayout("),
    fragment("function postRunCommand(", "function updateSpeedControl("),
    "return {setStatus, postRunCommand};"
  ].join("\n"))(state, vscode, () => {});
  setStatus("Classic model");
  setStatus("Classic model");
  setStatus("");
  state.runLoop = { label: "go", command: "ask turtles [ go ]" };
  setStatus("Running go");
  for (let tick = 0; tick < 100; tick++) {
    postRunCommand(state.runLoop.command, true);
    setStatus("Running go");
  }
  state.runLoop = null;
  setStatus("Stopping");
  setStatus("Updated after go");
  setStatus("An error occurred");
  assert.deepEqual(messages.filter(message => message.type === "editor-status").map(message => message.message),
    ["Classic model", "Running go", "Stopping", "Updated after go", "An error occurred"]);
  assert.equal(messages.filter(message => message.type === "run-command").length, 100);
  assert.doesNotMatch(source, /id="status"/);
});

test("the editor sends status messages to the shared NetLogo output channel, with model context", async () => {
  const originalLoad = Module._load;
  const lines = [], commands = [];
  const disposable = { dispose() {} };
  const vscode = {
    Uri: { joinPath: (_base, ...parts) => ({ toString: () => parts.join("/") }) },
    commands: { executeCommand: async (...args) => commands.push(args) },
    workspace: { onDidChangeTextDocument: () => disposable }
  };
  let Provider;
  try {
    Module._load = (request, parent, isMain) => request === "vscode" ? vscode : originalLoad.call(Module, request, parent, isMain);
    Provider = require("../out/netlogoEditor").NetLogoModelEditorProvider;
  } finally {
    Module._load = originalLoad;
  }
  const provider = new Provider({ extensionUri: {} }, {}, { appendLine: line => lines.push(line) });
  provider.isRuntimeConfigured = () => true;
  let receive;
  await provider.resolveCustomTextEditor({
    fileName: "/models/Traffic.nlogo", uri: { toString: () => "traffic" }, version: 1,
    getText: () => "to setup\nend\n@#$#@#$#@\n@#$#@#$#@\n"
  }, {
    webview: { cspSource: "test", asWebviewUri: value => value, postMessage: async () => true,
      onDidReceiveMessage: listener => { receive = listener; } },
    onDidChangeViewState: () => disposable, onDidDispose: () => disposable
  });
  await receive({ type: "editor-status", message: "Updated after go" });
  await receive({ type: "editor-status", message: "Failed: invalid reporter" });
  await receive({ type: "editor-status", message: " " });
  await receive({ type: "editor-status", message: 42 });
  assert.deepEqual(lines, ["[Traffic.nlogo] Updated after go", "[Traffic.nlogo] Failed: invalid reporter"]);
  assert.equal(commands.filter(([name]) => name === "netlogo.showOutput").length, 0, "Logging must not steal focus each tick");
  await receive({ type: "show-output" });
  assert.equal(commands.at(-1)[0], "netlogo.showOutput");
  const extension = fs.readFileSync(require.resolve("../out/extension"), "utf8");
  assert.match(extension, /NetLogoModelEditorProvider\.register\(context, runner, output\)/);
});

test("Properties explains Interact mode and only shows selection details in Layout", () => {
  const widget = { id: "slider", kind: "slider", type: "SLIDER" };
  const state = { interfaceMode: "interact", selectedWidgetId: widget.id };
  const nodes = [], deleteWidgetButton = {};
  const propertiesPanel = { replaceChildren: () => { nodes.length = 0; }, append: (...children) => nodes.push(...children) };
  const render = new Function("state", "findWidget", "propertiesPanel", "deleteWidgetButton", "node", "renderBoundsFields", "getPropertyDescriptors",
    fragment("function renderProperties(", "function renderBoundsFields(") + "return renderProperties;")(
    state, id => id === widget.id ? widget : null, propertiesPanel, deleteWidgetButton,
    (tag, className, text) => ({ tag, className, text }), () => ({ bounds: true }), () => []
  );
  render();
  assert.equal(nodes[1].text, "Switch to Layout to edit widget properties.");
  assert.equal(deleteWidgetButton.disabled, true);
  assert.ok(!nodes.some(node => node.bounds), "A restored selection must not reopen Properties in Interact");
  state.interfaceMode = "layout"; state.selectedWidgetId = null;
  render();
  assert.equal(nodes[1].text, "No selection");
  state.selectedWidgetId = widget.id;
  render();
  assert.equal(nodes[0].text, "SLIDER");
  assert.equal(nodes[1].bounds, true);
  assert.equal(deleteWidgetButton.disabled, false);
});
