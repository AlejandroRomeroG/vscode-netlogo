// Opt-in macOS UI check. Creates and closes ONLY its own temporary NetLogo
// session; normal unit/integration tests never launch a desktop application.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { NativeNetLogoLauncher, launchMacNetLogoModel, listMacNetLogoInstances } = require("../out/nativeNetLogo");

async function main() {
  if (process.platform !== "darwin" || process.argv[2] !== "--run" || !process.argv[3]) {
    throw new Error("Usage: node scripts/verifyNativeSessions.js --run '/path/to/NetLogo.app'");
  }
  const appPath = fs.realpathSync(process.argv[3]);
  const before = await listMacNetLogoInstances();
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "netlogo-native-session-check-")));
  const modelPath = path.join(directory, "Native Session Verification.nlogo");
  fs.copyFileSync(path.join(__dirname, "../samples/minimal.nlogo"), modelPath);
  let own;
  const same = (a, b) => a.pid === b.pid && a.startedAt === b.startedAt && a.appPath === b.appPath;
  try {
    // Directly exercise the launch adapter with a newly created, unique file.
    // Do not adopt or close any of the user's pre-existing native sessions.
    const launched = await launchMacNetLogoModel(appPath, modelPath);
    assert.ok(!before.some(value => same(value, launched)), "launcher must return a NEW process");
    own = launched;
    assert.equal(own.appPath, appPath);
    assert.ok((await listMacNetLogoInstances()).some(value => same(value, own)));
    let records = [{ ...own, modelPath }];
    const store = {
      read: () => JSON.parse(JSON.stringify(records)),
      write: async value => { records = JSON.parse(JSON.stringify(value)); }
    };
    const results = [];
    for (let i = 0; i < 3; i++) {
      // A fresh launcher exercises persisted-record reuse across host reloads.
      const result = await new NativeNetLogoLauncher(store).openMacModel(appPath, modelPath);
      assert.deepEqual(result, { action: "activated", pid: own.pid });
      results.push(result);
    }
    const after = await listMacNetLogoInstances();
    assert.deepEqual(after.filter(value => !before.some(old => same(old, value))).map(value => value.pid), [own.pid]);
    // Give native initialization a bounded opportunity to complete; no simulation
    // commands or file-open events are sent to the application.
    await new Promise(resolve => setTimeout(resolve, 5000));
    console.log(JSON.stringify({ before: before.map(value => value.pid), launched: own.pid, results,
      after: after.map(value => value.pid), registryRecords: records.length }, null, 2));
  } finally {
    if (own) {
      const current = (await listMacNetLogoInstances()).find(value => same(value, own));
      if (current) process.kill(current.pid, "SIGTERM");
      for (let i = 0; i < 30; i++) {
        if (!(await listMacNetLogoInstances()).some(value => same(value, own))) break;
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      assert.ok(!(await listMacNetLogoInstances()).some(value => same(value, own)), "test session must have exited before removing its fixture");
    }
    fs.rmSync(directory, { recursive: true, force: true });
  }
  const remaining = await listMacNetLogoInstances();
  for (const original of before) {
    assert.ok(remaining.some(value => same(value, original)), "pre-existing native session must remain running");
  }
  console.log("Temporary native session closed; all pre-existing sessions preserved.");
}

main().catch(error => { console.error(error); process.exitCode = 1; });
