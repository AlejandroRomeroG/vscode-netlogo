const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const childProcess = require("node:child_process");
const { NativeNetLogoLauncher, launchMacNetLogoModel, listMacNetLogoInstances } = require("../out/nativeNetLogo");

function fixture(t) {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "netlogo-native-open-")));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const model = path.join(directory, "Árbol's $model 3D.nlogo3d");
  fs.writeFileSync(model, "test model");
  const app = path.join(directory, "NetLogo 3D.app");
  fs.mkdirSync(app);
  return { directory, model, app };
}

function instance(appPath, pid = 100) {
  return { pid, appPath, startedAt: pid + 0.125 };
}

function storage(initial) {
  return {
    value: initial, writes: 0,
    read() { return this.value; },
    async write(records) { this.value = JSON.parse(JSON.stringify(records)); this.writes++; }
  };
}

function desktop(initial = []) {
  let nextPid = 200;
  return {
    instances: [...initial], activated: [], launches: [],
    async list() { return [...this.instances]; },
    async launch(appPath, modelPath) {
      this.launches.push({ appPath, modelPath });
      const started = instance(appPath, nextPid++);
      this.instances.push(started);
      return started;
    },
    async activate(value) { this.activated.push(value.pid); }
  };
}

test("native launches persist canonical file and exact process identity", async t => {
  const { model, app } = fixture(t);
  const native = desktop(), store = storage();
  const result = await new NativeNetLogoLauncher(store, native).openMacModel(app, model);
  assert.deepEqual(result, { action: "opened", pid: 200 });
  assert.deepEqual(native.launches, [{ appPath: app, modelPath: model }]);
  assert.deepEqual(store.value, [{ ...instance(app, 200), modelPath: model }]);
});

test("concurrent and repeated same-file clicks never launch a second registered session", async t => {
  const { model, app } = fixture(t);
  const native = desktop(), store = storage();
  const launcher = new NativeNetLogoLauncher(store, native);
  await Promise.all(Array.from({ length: 5 }, () => launcher.openMacModel(app, model)));
  for (let i = 0; i < 3; i++) assert.equal((await launcher.openMacModel(app, model)).action, "activated");
  assert.equal(native.launches.length, 1);
  assert.equal(store.value.length, 1);
});

test("a fresh launcher reuses its persisted registry after a VS Code reload", async t => {
  const { model, app } = fixture(t);
  const native = desktop(), store = storage();
  await new NativeNetLogoLauncher(store, native).openMacModel(app, model);
  assert.deepEqual(await new NativeNetLogoLauncher(store, native).openMacModel(app, model),
    { action: "activated", pid: 200 });
  assert.equal(native.launches.length, 1);
});

test("closed sessions are pruned and the model can be opened again", async t => {
  const { model, app } = fixture(t);
  const native = desktop(), store = storage();
  const launcher = new NativeNetLogoLauncher(store, native);
  await launcher.openMacModel(app, model);
  native.instances = [];
  assert.deepEqual(await launcher.openMacModel(app, model), { action: "opened", pid: 201 });
  assert.deepEqual(store.value, [{ ...instance(app, 201), modelPath: model }]);
});

test("a recycled PID or a different application never inherits the old model association", async t => {
  const { model, app } = fixture(t);
  for (const replacement of [{ ...instance(app), startedAt: 999 }, instance(app + ".other")]) {
    const native = desktop([replacement]);
    const store = storage([{ ...instance(app), modelPath: model }]);
    const result = await new NativeNetLogoLauncher(store, native).openMacModel(app, model);
    assert.equal(result.action, "untracked");
    assert.deepEqual(store.value, []);
    assert.equal(native.launches.length, 0);
    assert.deepEqual(native.activated, []);
  }
});

test("manual or pre-update sessions are offered for activation without guessing their model", async t => {
  const { model, app } = fixture(t);
  const current = { ...instance(app), titles: ["NetLogo — " + path.basename(model)], argv: ["--open", model] };
  const native = desktop([current]), store = storage();
  const launcher = new NativeNetLogoLauncher(store, native);
  const result = await launcher.openMacModel(app, model);
  assert.equal(result.action, "untracked");
  assert.equal(native.launches.length, 0);
  assert.deepEqual(native.activated, [], "discovery alone does not activate or associate a session");
  await launcher.activateExisting(result.instances[0]);
  assert.deepEqual(native.activated, [100]);
  assert.equal(store.value, undefined, "visiting a session does not claim that it contains the requested model");
});

test("registered sessions can be reused even when an unrelated untracked session exists", async t => {
  const { model, app } = fixture(t);
  const native = desktop([instance(app), instance(app, 101)]);
  const store = storage([{ ...instance(app), modelPath: model }]);
  assert.equal((await new NativeNetLogoLauncher(store, native).openMacModel(app, model)).action, "activated");
  assert.deepEqual(native.activated, [100]);
  assert.equal(native.launches.length, 0);
});

test("different files including same-name files get independent registered sessions", async t => {
  const { model, app, directory } = fixture(t);
  fs.mkdirSync(path.join(directory, "other"));
  const other = path.join(directory, "other", path.basename(model));
  fs.copyFileSync(model, other);
  const native = desktop(), store = storage();
  const launcher = new NativeNetLogoLauncher(store, native);
  await Promise.all([launcher.openMacModel(app, model), launcher.openMacModel(app, other)]);
  assert.deepEqual(native.launches.map(value => value.modelPath).sort(), [model, other].sort());
  assert.equal(store.value.length, 2, "serialized registry updates do not lose another model's record");
});

test("symlink aliases of a model and application preserve one canonical registration", async t => {
  const { model, app, directory } = fixture(t);
  const modelAlias = path.join(directory, "Alias.nlogo3d"), appAlias = path.join(directory, "Alias.app");
  fs.symlinkSync(model, modelAlias);
  fs.symlinkSync(app, appAlias);
  const native = desktop(), store = storage();
  const launcher = new NativeNetLogoLauncher(store, native);
  await launcher.openMacModel(appAlias, modelAlias);
  await launcher.openMacModel(app, model);
  assert.deepEqual(native.launches, [{ appPath: app, modelPath: model }]);
});

test("the same registered file reuses its session even if another installation is configured", async t => {
  const { model, app } = fixture(t);
  const native = desktop(), launcher = new NativeNetLogoLauncher(undefined, native);
  await launcher.openMacModel(app, model);
  assert.equal((await launcher.openMacModel("/another/NetLogo.app", model)).action, "activated");
  assert.equal(native.launches.length, 1);
});

test("the registry is explicitly launch identity, not the current model after native File > Open", async t => {
  const { model, app } = fixture(t);
  const current = { ...instance(app), currentModel: "Changed directly inside NetLogo" };
  const native = desktop([current]), store = storage([{ ...instance(app), modelPath: model }]);
  await new NativeNetLogoLauncher(store, native).openMacModel(app, model);
  assert.deepEqual(native.activated, [100]);
  assert.equal(current.currentModel, "Changed directly inside NetLogo", "activation must not reload or replace native state");
  assert.equal(native.launches.length, 0);
});

test("a session closed or replaced while the picker is open cannot be activated", async t => {
  const { app } = fixture(t);
  const old = instance(app), native = desktop([old]);
  const launcher = new NativeNetLogoLauncher(undefined, native);
  native.instances = [{ ...old, startedAt: 999 }];
  await assert.rejects(launcher.activateExisting(old), /session has closed/);
  assert.deepEqual(native.activated, []);
  assert.equal(native.launches.length, 0);
});

test("invalid registry data cannot authorize a new launch", async t => {
  const { model, app } = fixture(t);
  for (const value of [null, {}, [{ ...instance(app), modelPath: "relative.nlogo" }], [{ pid: "100", appPath: app, startedAt: 10, modelPath: model }]]) {
    const native = desktop();
    await assert.rejects(new NativeNetLogoLauncher(storage(value), native).openMacModel(app, model), /registry is invalid/);
    assert.equal(native.launches.length, 0);
  }
});

test("discovery and activation failures never fall back to a duplicate launch", async t => {
  const { model, app } = fixture(t);
  for (const method of ["list", "activate"]) {
    const native = desktop([instance(app)]), store = storage([{ ...instance(app), modelPath: model }]);
    native[method] = async () => { throw new Error(method + " failed"); };
    await assert.rejects(new NativeNetLogoLauncher(store, native).openMacModel(app, model), new RegExp(method + " failed"));
    assert.equal(native.launches.length, 0);
  }
});

test("launch failures are not silently retried and the queue remains usable", async t => {
  const { model, app } = fixture(t);
  const native = desktop(), launch = native.launch.bind(native);
  let attempts = 0;
  native.launch = async (...args) => { if (++attempts === 1) throw new Error("Launch rejected"); return launch(...args); };
  const launcher = new NativeNetLogoLauncher(storage(), native);
  await assert.rejects(launcher.openMacModel(app, model), /Launch rejected/);
  assert.equal(attempts, 1);
  assert.equal((await launcher.openMacModel(app, model)).action, "opened");
});

test("a registry write failure after launching cannot silently launch another copy on retry", async t => {
  const { model, app } = fixture(t);
  const native = desktop(), store = storage();
  store.write = async () => { throw new Error("Storage unavailable"); };
  const launcher = new NativeNetLogoLauncher(store, native);
  await assert.rejects(launcher.openMacModel(app, model), /Storage unavailable/);
  assert.equal((await launcher.openMacModel(app, model)).action, "untracked");
  assert.equal(native.launches.length, 1);
});

test("ambiguous or invalid launch results never become persisted model associations", async t => {
  const { model, app } = fixture(t);
  for (const result of [null, instance("/different/NetLogo.app"), { ...instance(app), startedAt: NaN }]) {
    const native = desktop(), store = storage();
    native.launch = async () => result;
    await assert.rejects(new NativeNetLogoLauncher(store, native).openMacModel(app, model), /process could not be identified/);
    assert.equal(store.value, undefined);
  }
});

test("missing models and directories fail before starting native NetLogo", async t => {
  const { directory, app } = fixture(t);
  const native = desktop(), launcher = new NativeNetLogoLauncher(undefined, native);
  await assert.rejects(launcher.openMacModel(app, path.join(directory, "missing.nlogo")), /ENOENT/);
  await assert.rejects(launcher.openMacModel(app, directory), /must be a file/);
  assert.equal(native.launches.length, 0);
});

test("native helpers use only AppKit process identity and launch isolated startup arguments", async t => {
  const { model, app } = fixture(t);
  const original = childProcess.execFile, calls = [];
  t.after(() => { childProcess.execFile = original; });
  childProcess.execFile = (command, args, options, callback) => {
    calls.push({ command, args, options });
    callback(null, JSON.stringify(args.length === 5 ? instance(app) : [instance(app)]), "");
  };
  assert.deepEqual(await listMacNetLogoInstances(), [instance(app)]);
  assert.deepEqual(await launchMacNetLogoModel(app, model), instance(app));
  for (const call of calls) {
    assert.equal(call.command, "/usr/bin/osascript");
    assert.deepEqual(call.args.slice(0, 3), ["-l", "JavaScript", "-e"]);
    assert.doesNotMatch(call.args[3], /CGWindow|CGPreflight|CGRequest|AXUIElement|System Events|\.titles/);
  }
  const request = JSON.parse(calls[1].args[4]);
  assert.deepEqual(request, { appPath: app, modelPath: model });
  let passed;
  const dollar = value => value;
  Object.assign(dollar, {
    NSMutableDictionary: { alloc: { init: { setObjectForKey(value, key) { this[key] = value; } } } },
    NSWorkspaceLaunchConfigurationArguments: "arguments", NSWorkspaceLaunchNewInstance: 524288,
    NSURL: { fileURLWithPath: value => value },
    NSWorkspace: { sharedWorkspace: { launchApplicationAtURLOptionsConfigurationError(url, flags, config) {
      passed = { url, flags, args: config.arguments };
      return { processIdentifier: 100, bundleURL: { path: app }, launchDate: { timeIntervalSince1970: 100.125 } };
    } } }
  });
  const context = { $: dollar, ObjC: { import() {}, unwrap: value => value }, Ref: () => [] };
  vm.runInNewContext(calls[1].args[3], context);
  assert.deepEqual(JSON.parse(context.run([calls[1].args[4]])), instance(app));
  assert.deepEqual(JSON.parse(JSON.stringify(passed)), { url: app, flags: 524288, args: ["--open", model] });
});

function openWorkflow(options = {}) {
  // Execute the compiled command workflow with a VS Code adapter, not a copy.
  const compiled = fs.readFileSync(path.join(__dirname, "../out/extension.js"), "utf8");
  const source = compiled.slice(compiled.indexOf("async function openInNativeNetLogo("), compiled.indexOf("function nativeNetLogoAppForResource("));
  const calls = [], lines = [];
  const uri = { scheme: "file", fsPath: "/models/Tree.nlogo3d" };
  const instances = options.instances ?? [instance("/NetLogo.app")];
  const vscode = {
    workspace: { openTextDocument: async () => ({ isDirty: options.dirty ?? false, save: async () => { calls.push("save"); return options.save ?? true; } }) },
    env: { openExternal: async () => { calls.push("external"); return options.external ?? true; } },
    ProgressLocation: { Notification: 15 },
    window: {
      withProgress: async (_options, task) => { calls.push("progress"); return task(); },
      showInformationMessage: async (message, ...choices) => { calls.push({ message, choices }); return options.choice; },
      showQuickPick: async items => { calls.push("pick"); return options.pick === undefined ? undefined : items[options.pick]; }
    }
  };
  const launcher = {
    openMacModel: async () => { calls.push("launch"); return { action: options.action ?? "opened", pid: 100, instances }; },
    activateExisting: async value => { calls.push({ activate: value.pid }); }
  };
  const workflow = new Function("vscode", "path", "process", "nativeNetLogoAppForResource", "resolveModelUri", source + "\nreturn openInNativeNetLogo;")(
    vscode, path, { platform: options.platform ?? "darwin" }, () => options.noApp ? undefined : "/NetLogo.app", async resource => resource ?? uri);
  const output = { appendLine: line => lines.push(line) };
  return { run: resource => workflow(launcher, resource, output), calls, lines };
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

test("missing macOS configuration cannot bypass the registry through a file association", async () => {
  const { run, calls } = openWorkflow({ noApp: true });
  await assert.rejects(run(), /Configure NetLogo/);
  assert.deepEqual(calls, []);
});

test("other platforms retain file associations and report unavailable applications", async () => {
  const { run, calls } = openWorkflow({ platform: "linux", noApp: true, external: false });
  await assert.rejects(run(), /No native application/);
  assert.deepEqual(calls, ["external"]);
});

test("registered activation is logged as a session association, not a verified current model", async () => {
  const { run, lines } = openWorkflow({ action: "activated" });
  await run();
  assert.deepEqual(lines, ["[Tree.nlogo3d] Activated the NetLogo session previously opened for this file; no new copy opened."]);
});

test("untracked sessions offer Go to NetLogo without permissions or automatic activation", async () => {
  const { run, calls, lines } = openWorkflow({ action: "untracked" });
  assert.equal(await run(), false);
  assert.deepEqual(calls[2].choices, ["Go to NetLogo"]);
  assert.match(calls[2].message, /current model is unknown/);
  assert.equal(calls.length, 3);
  assert.match(lines[0], /no new copy opened/);
});

test("Go to NetLogo activates the existing session without assigning it to the requested file", async () => {
  const { run, calls, lines } = openWorkflow({ action: "untracked", choice: "Go to NetLogo" });
  assert.equal(await run(), true);
  assert.deepEqual(calls.at(-1), { activate: 100 });
  assert.match(lines.at(-1), /current model not verified/);
  assert.equal(calls.filter(value => value === "launch").length, 1, "only one discovery request; never a retry");
});

test("multiple untracked sessions require choosing an exact instance", async () => {
  const instances = [instance("/NetLogo.app"), instance("/NetLogo.app", 101)];
  const { run, calls } = openWorkflow({ action: "untracked", choice: "Go to NetLogo", instances, pick: 1 });
  assert.equal(await run(), true);
  assert.equal(calls.at(-2), "pick");
  assert.deepEqual(calls.at(-1), { activate: 101 });
});

test("cancelling the native session picker neither activates nor launches another instance", async () => {
  const instances = [instance("/NetLogo.app"), instance("/NetLogo.app", 101)];
  const { run, calls } = openWorkflow({ action: "untracked", choice: "Go to NetLogo", instances });
  assert.equal(await run(), false);
  assert.equal(calls.at(-1), "pick");
});

test("non-file URIs retain platform external-opening behavior", async () => {
  const { run, calls } = openWorkflow();
  assert.equal(await run({ scheme: "https", fsPath: "" }), true);
  assert.deepEqual(calls, ["external"]);
});
