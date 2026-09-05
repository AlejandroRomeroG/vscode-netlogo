// Compare equivalent, uncapped patch exports using NetLogo 6.4 and a fixed seed.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const readline = require("node:readline");
const { spawn, spawnSync } = require("node:child_process");
const { installationFromHome, detectNetLogoInstallations } = require("../out/netlogoInstallation");
const { parseView3DBinary } = require("../out/view3D");

async function main() {
  const installation = process.env.NETLOGO_HOME
    ? installationFromHome(process.env.NETLOGO_HOME) : detectNetLogoInstallations(["/Applications"])[0];
  if (!installation) throw new Error("Set NETLOGO_HOME to a local NetLogo installation.");
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "netlogo-3d-benchmark-"));
  const classPath = installation.classPath.join(path.delimiter);
  const bridgeSource = process.env.BENCHMARK_BRIDGE_SOURCE || path.join(__dirname, "../resources/java/NetLogoCommandBridge.java");
  const compile = spawnSync("javac", ["-cp", classPath, "-d", directory, bridgeSource], { encoding: "utf8" });
  if (compile.status !== 0) throw new Error(compile.stderr);
  const child = spawn("java", [...installation.jvmArgs, "-cp", [directory, classPath].join(path.delimiter), "NetLogoCommandBridge", "--3d",
    path.join(installation.home, "models/3D/Sample Models/Percolation 3D.nlogo3d")]);
  const lines = readline.createInterface({ input: child.stdout });
  const iterator = lines[Symbol.asyncIterator]();
  child.stderr.pipe(process.stderr);
  const receive = async () => {
    const { value, done } = await iterator.next();
    if (done) throw new Error("NetLogo exited before completing the export.");
    if (value.startsWith("__NETLOGO_ERROR__")) throw new Error(Buffer.from(value.slice(17), "base64").toString());
    return value;
  };
  const send = async (kind, ...values) => {
    const start = performance.now();
    child.stdin.write(kind + " " + values.map(value => Buffer.from(value).toString("base64")).join(" ") + "\n");
    await receive();
    return performance.now() - start;
  };
  const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
  try {
    await receive();
    await send("COMMAND", "random-seed 42 setup repeat 40 [ go ]");
    const binaryPath = path.join(directory, "percolation40.bin");
    const textPath = path.join(directory, "patches.txt");
    // Correct the former OF/list error and remove its cap for a like-for-like baseline.
    const reporter = '[ (word pxcor "|" pycor "|" pzcor "|" pcolor "|" (item 0 (extract-rgb pcolor)) "|" (item 1 (extract-rgb pcolor)) "|" (item 2 (extract-rgb pcolor))) ] of patches with [pcolor != black]';
    const binaryTimes = [], textTimes = [];
    for (let index = 0; index < 15; index++) {
      const textMs = await send("EXPORT_REPORT", reporter, textPath);
      const binaryMs = await send("EXPORT_VIEW_3D", binaryPath);
      if (index >= 5) { textTimes.push(textMs); binaryTimes.push(binaryMs); }
    }
    const snapshot = parseView3DBinary(fs.readFileSync(binaryPath));
    await send("COMMAND", "repeat 43 [ go ]");
    await send("EXPORT_VIEW_3D", path.join(directory, "percolation83.bin"));
    console.log(JSON.stringify({
      model: "Percolation 3D", bridgeSource, seed: 42, tick: 40, patches: snapshot.patchCount, samples: 10,
      textExportMedianMs: median(textTimes), binaryExportMedianMs: median(binaryTimes),
      textBytes: fs.statSync(textPath).size, binaryBytes: fs.statSync(binaryPath).size,
      snapshots: directory
    }, null, 2));
    console.log("Visual check: node scripts/preview3D.js " + JSON.stringify(directory));
  } finally {
    child.stdin.end();
    lines.close();
    child.kill();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
