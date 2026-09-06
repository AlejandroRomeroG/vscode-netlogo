const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Module = require("node:module");
const test = require("node:test");
const { bridgeSourcePaths } = require("../out/javaBridge");

const root = path.resolve(__dirname, "..");
const originalLoad = Module._load;
let NetLogoRunner;
try {
  Module._load = function (request, parent, isMain) {
    return request === "vscode"
      ? { Uri: { joinPath: (base, ...parts) => ({ fsPath: path.join(base.fsPath, ...parts) }) }, window: {} }
      : originalLoad.call(this, request, parent, isMain);
  };
  ({ NetLogoRunner } = require("../out/runner"));
} finally {
  Module._load = originalLoad;
}

test("mouse messages only reach existing sessions of their own local model", () => {
  const runner = new NetLogoRunner({}, {}), sent = [];
  runner.getSession = () => assert.fail("Hovering a view must not start a workspace");
  runner.sessions.set("model-a", { matchesModelPath: file => file === "a.nlogo", updateViewMouse: value => sent.push(value) });
  runner.sessions.set("model-b", { matchesModelPath: file => file === "b.nlogo", updateViewMouse: () => assert.fail("Wrong model") });
  const state = { inside: true, down: true, u: 0.25, v: 0.75 };
  runner.updateViewMouse({ scheme: "file", fsPath: "a.nlogo" }, state);
  runner.updateViewMouse({ scheme: "file", fsPath: "missing.nlogo" }, state);
  runner.updateViewMouse({ scheme: "https", fsPath: "a.nlogo" }, state);
  runner.updateViewMouse({ scheme: "file", fsPath: "a.nlogo" }, { ...state, u: NaN });
  assert.deepEqual(sent, [state]);
});

test("mouse transport bypasses pending model commands and ignores disposed/3D sessions", () => {
  const source = fs.readFileSync(path.join(root, "out/runner.js"), "utf8");
  const start = source.indexOf("updateViewMouse(state) {");
  const end = source.indexOf("matchesModelPath(candidatePath)", start);
  assert.ok(start > 0 && end > start);
  const Session = new Function("return class {" + source.slice(start, end) + "}")();
  const session = new Session(), writes = [], logs = [];
  session.child = { stdin: { write: (...args) => writes.push(args) } };
  session.output = { appendLine: line => logs.push(line) };
  session.dispose = () => { session.isDisposed = true; };
  const chain = new Promise(() => {});
  session.commandChain = chain;
  const state = { inside: true, down: false, u: 0.25, v: 0.75 };
  session.updateViewMouse(state);
  assert.equal(writes.length, 1);
  assert.equal(writes[0][0], "MOUSE 1 0 0.25 0.75\n");
  assert.equal(session.commandChain, chain);
  session.isThreeDModel = true;
  session.updateViewMouse(state);
  assert.equal(writes.length, 1);
  session.isThreeDModel = false;
  writes[0][2](new Error("Closed input"));
  assert.equal(session.isDisposed, true);
  assert.match(logs[0], /Closed input/);
  session.updateViewMouse(state);
  assert.equal(writes.length, 1);
});

test("bridge compilation includes every mouse adapter and rebuilds an incomplete cache", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "netlogo-bridge-cache-test-"));
  const sourceDir = path.join(root, "resources/java");
  const sources = bridgeSourcePaths(sourceDir);
  const runner = new NetLogoRunner({ extensionUri: { fsPath: root }, globalStorageUri: { fsPath: directory } }, {});
  let compiles = 0;
  runner.spawnLogged = async (_command, args) => {
    compiles++;
    const target = args[args.indexOf("-d") + 1];
    assert.deepEqual(args.slice(args.indexOf("-d") + 2), sources);
    for (const source of sources) {
      assert.equal(fs.existsSync(source), true);
      const file = path.join(target, path.relative(sourceDir, source).replace(/\.java$/, ".class"));
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, "test class");
    }
  };
  try {
    await runner.ensureBridgeCompiled("javac", ["netlogo.jar"], false, 1000);
    await runner.ensureBridgeCompiled("javac", ["netlogo.jar"], false, 1000);
    assert.equal(compiles, 1);
    fs.unlinkSync(path.join(directory, "netlogo-bridge/org/nlogo/prim/gui/_mousexcor.class"));
    await runner.ensureBridgeCompiled("javac", ["netlogo.jar"], false, 1000);
    assert.equal(compiles, 2);
    await runner.ensureBridgeCompiled("javac", ["different-netlogo.jar"], false, 1000);
    assert.equal(compiles, 3);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
