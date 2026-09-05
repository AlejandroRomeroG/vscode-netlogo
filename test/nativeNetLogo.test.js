const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { NativeNetLogoLauncher } = require("../out/nativeNetLogo");

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "netlogo-native-open-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const model = path.join(directory, "Árbol's $model 3D.nlogo3d");
  fs.writeFileSync(model, "test model");
  return { directory, model, app: "/Applications/NetLogo 6.4.0/NetLogo 3D 6.4.0.app" };
}

test("native opening uses one startup path with isolated argv, never an OpenFiles event", async t => {
  const { model, app } = fixture(t);
  const calls = [];
  const launcher = new NativeNetLogoLauncher(async (...args) => calls.push(args));
  await launcher.openMacModel(app, model);
  assert.deepEqual(calls, [["/usr/bin/open", ["-n", "-a", app, "--args", "--open", model]]]);
});

test("concurrent clicks for the same native model share a launch", async t => {
  const { model, app } = fixture(t);
  let finish, calls = 0;
  const launcher = new NativeNetLogoLauncher(() => {
    calls++;
    return new Promise(resolve => { finish = resolve; });
  });
  const first = launcher.openMacModel(app, model);
  const second = launcher.openMacModel(app, model);
  assert.equal(first, second);
  while (!finish) await new Promise(setImmediate);
  finish();
  await Promise.all([first, second]);
  assert.equal(calls, 1);
  const next = launcher.openMacModel(app, model);
  while (calls < 2) await new Promise(setImmediate);
  finish();
  await next;
  assert.equal(calls, 2, "a later deliberate request can open a new copy");
});

test("a failed launch is reported without silent retries and permits an explicit retry", async t => {
  const { model, app } = fixture(t);
  let calls = 0;
  const launcher = new NativeNetLogoLauncher(async () => {
    calls++;
    if (calls === 1) throw new Error("Launch Services rejected the application");
  });
  await assert.rejects(launcher.openMacModel(app, model), /Launch Services rejected/);
  assert.equal(calls, 1);
  await launcher.openMacModel(app, model);
  assert.equal(calls, 2);
});

test("missing files and directories fail before starting NetLogo's splash screen", async t => {
  const { directory, app } = fixture(t);
  let calls = 0;
  const launcher = new NativeNetLogoLauncher(async () => { calls++; });
  await assert.rejects(launcher.openMacModel(app, path.join(directory, "missing.nlogo")), /ENOENT/);
  await assert.rejects(launcher.openMacModel(app, directory), /must be a file/);
  assert.equal(calls, 0);
});

test("separate model requests do not block or replace each other's launches", async t => {
  const { model, app, directory } = fixture(t);
  const other = path.join(directory, "Other.nlogo");
  fs.writeFileSync(other, "test model");
  const calls = [];
  const launcher = new NativeNetLogoLauncher(async (_command, args) => calls.push(args));
  await Promise.all([launcher.openMacModel(app, model), launcher.openMacModel(app, other)]);
  assert.deepEqual(calls.map(args => args.at(-1)).sort(), [model, other].sort());
  assert.ok(calls.every(args => args[0] === "-n"));
});

function openWorkflow(options = {}) {
  // Execute the compiled command workflow with a VS Code adapter, not a copy of its logic.
  const compiled = fs.readFileSync(path.join(__dirname, "../out/extension.js"), "utf8");
  const source = compiled.slice(compiled.indexOf("async function openInNativeNetLogo("), compiled.indexOf("function nativeNetLogoAppForResource("));
  const calls = [];
  const uri = { scheme: "file", fsPath: "/models/Tree.nlogo3d" };
  const vscode = {
    workspace: { openTextDocument: async () => ({ isDirty: options.dirty ?? false, save: async () => { calls.push("save"); return options.save ?? true; } }) },
    env: { openExternal: async () => { calls.push("external"); return options.external ?? true; } },
    ProgressLocation: { Notification: 15 },
    window: { withProgress: async (_options, task) => { calls.push("progress"); return task(); } }
  };
  const launcher = { openMacModel: async () => { calls.push("launch"); } };
  const run = new Function("vscode", "path", "process", "nativeNetLogoLauncher", "nativeNetLogoAppForResource", "resolveModelUri", source + "\nreturn openInNativeNetLogo;")(
    vscode, path, { platform: "darwin" }, launcher, () => options.noApp ? undefined : "/NetLogo.app", async resource => resource ?? uri
  );
  return { run, calls };
}

test("native command saves dirty editor content before launching", async () => {
  const { run, calls } = openWorkflow({ dirty: true });
  assert.equal(await run(), true);
  assert.deepEqual(calls, ["save", "progress", "launch"]);
});

test("cancelled saves do not launch a stale on-disk model", async () => {
  const { run, calls } = openWorkflow({ dirty: true, save: false });
  assert.equal(await run(), false);
  assert.deepEqual(calls, ["save"]);
});

test("clean models open without unnecessary saves", async () => {
  const { run, calls } = openWorkflow();
  assert.equal(await run(), true);
  assert.deepEqual(calls, ["progress", "launch"]);
});

test("unavailable native file associations produce an error", async () => {
  const { run, calls } = openWorkflow({ noApp: true, external: false });
  await assert.rejects(run(), /No native application/);
  assert.deepEqual(calls, ["external"]);
});

test("non-file URIs retain platform external-opening behavior", async () => {
  const { run, calls } = openWorkflow();
  assert.equal(await run({ scheme: "https", fsPath: "" }), true);
  assert.deepEqual(calls, ["external"]);
});
