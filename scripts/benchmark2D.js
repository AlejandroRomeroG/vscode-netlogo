// Reproduce long-running 2D costs without opening VS Code or modifying a model.
// Run after compiling the extension: NETLOGO_HOME=/path/to/NetLogo node scripts/benchmark2D.js
// This script uses the existing out/ modules and compiles only the Java bridge in a temporary directory.
const fs = require("node:fs");
const { bridgeSourcePaths } = require("../out/javaBridge");
const os = require("node:os");
const path = require("node:path");
const readline = require("node:readline");
const { createHash } = require("node:crypto");
const { performance } = require("node:perf_hooks");
const { spawn, spawnSync } = require("node:child_process");
const assert = require("node:assert/strict");
const { installationFromHome, detectNetLogoInstallations } = require("../out/netlogoInstallation");
const { parseNetLogoModel } = require("../out/modelFormat");
const { parseInterfacePreview, getPlotExporters } = require("../out/classicInterface");
const { parsePlotCsv } = require("../out/plotCsv");
const { parsePlotBinary } = require("../out/plotSnapshot");

const WARMUPS = 5;
const SAMPLES = 10;
const CHECKPOINTS = [100, 5000, 10000];
const SEED = 42;
const PLOT_NAME = "Population over Time";

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function measureSync(operation) {
  const times = [];
  let value;
  for (let index = 0; index < WARMUPS + SAMPLES; index++) {
    const started = performance.now();
    value = operation();
    if (index >= WARMUPS) times.push(performance.now() - started);
  }
  return { medianMs: median(times), value };
}

function assertPlotParity(csv, binary, configuredPens) {
  for (const key of ["name", "xMin", "xMax", "yMin", "yMax", "autoplot", "legend", "currentPen", "numberOfPens"]) {
    assert.equal(binary[key], csv[key], `Plot metadata differs: ${key}`);
  }
  assert.deepEqual(binary.pens.map(pen => pen.name), csv.pens.map(pen => pen.name));
  // This particular original model never changes its three pen colors. Compare
  // the CSV palette numbers and binary ARGB against its saved pen definitions.
  const paletteNumbers = { sheep: 0, grass: 55, wolves: 35 };
  for (let index = 0; index < csv.pens.length; index++) {
    const csvPen = csv.pens[index];
    const binaryPen = binary.pens[index];
    const configured = configuredPens.find(pen => pen.name === csvPen.name);
    assert.ok(configured, `Unexpected pen ${csvPen.name}`);
    for (const key of ["name", "penDown", "mode", "interval", "x"]) {
      assert.equal(binaryPen[key], csvPen[key], `Pen metadata differs: ${csvPen.name}.${key}`);
    }
    assert.equal(csvPen.color, paletteNumbers[csvPen.name]);
    assert.equal(binaryPen.color, configured.color);
    assert.equal(binaryPen.hidden, false);
    assert.equal(binaryPen.inLegend, configured.inLegend);
    assert.equal(binaryPen.points.length, csvPen.points.length);
    for (let pointIndex = 0; pointIndex < csvPen.points.length; pointIndex++) {
      const csvPoint = csvPen.points[pointIndex];
      const binaryPoint = binaryPen.points[pointIndex];
      assert.equal(binaryPoint.x, csvPoint.x);
      assert.equal(binaryPoint.y, csvPoint.y);
      assert.equal(binaryPoint.penDown, csvPoint.penDown);
      assert.equal(csvPoint.color, paletteNumbers[csvPen.name]);
      assert.equal(binaryPoint.color, configured.color);
    }
  }
}

async function main() {
  const installation = process.env.NETLOGO_HOME
    ? installationFromHome(process.env.NETLOGO_HOME)
    : detectNetLogoInstallations(process.platform === "darwin" ? ["/Applications"] : undefined)[0];
  if (!installation) throw new Error("Set NETLOGO_HOME to a local NetLogo installation.");
  const modelPath = path.join(installation.home, "models/IABM Textbook/chapter 4/Wolf Sheep Simple 5.nlogo");
  const modelSource = fs.readFileSync(modelPath, "utf8");
  const model = parseNetLogoModel(modelSource, modelPath);
  const preview = parseInterfacePreview(model.interfaceSource, model.format);
  const plotExporter = getPlotExporters(preview.widgets).find(plot => plot.plotName === PLOT_NAME);
  if (!plotExporter) throw new Error(`Model does not contain plot ${JSON.stringify(PLOT_NAME)}.`);
  const configuredPens = preview.widgets.find(widget => widget.id === plotExporter.widgetId).details.pens;
  const bridgeSource = path.join(__dirname, "../resources/java/NetLogoCommandBridge.java");
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "netlogo-2d-benchmark-"));
  let child;
  let lines;
  let exited;
  try {
    const classPath = installation.classPath.join(path.delimiter);
    const compiled = spawnSync(process.env.JAVAC || "javac", ["-cp", classPath, "-d", directory, ...bridgeSourcePaths(path.dirname(bridgeSource))], {
      encoding: "utf8", timeout: 60000
    });
    if (compiled.error || compiled.status !== 0) {
      throw compiled.error || new Error(compiled.stderr || compiled.stdout || "Java bridge compilation failed.");
    }
    child = spawn(process.env.JAVA || "java", [
      ...installation.jvmArgs, "-Djava.awt.headless=true", "-cp",
      [directory, classPath].join(path.delimiter), "NetLogoCommandBridge", modelPath
    ]);
    let processError;
    child.on("error", error => { processError = error; });
    exited = new Promise(resolve => child.once("close", resolve));
    let stderr = "";
    child.stderr.on("data", bytes => { stderr = (stderr + bytes.toString()).slice(-65536); });
    lines = readline.createInterface({ input: child.stdout });
    const iterator = lines[Symbol.asyncIterator]();
    const receive = async expected => {
      let timeout;
      try {
        const next = await Promise.race([
          iterator.next(),
          new Promise((_, reject) => {
            timeout = setTimeout(() => reject(new Error(`Timed out waiting for ${expected}.\n${stderr}`)), 180000);
          })
        ]);
        if (next.done) throw processError || new Error(`NetLogo exited while waiting for ${expected}.\n${stderr}`);
        if (next.value.startsWith("__NETLOGO_ERROR__")) {
          throw new Error(Buffer.from(next.value.slice("__NETLOGO_ERROR__".length), "base64").toString("utf8"));
        }
        if (!next.value.startsWith(expected)) throw new Error(`Unexpected bridge response: ${next.value.slice(0, 200)}`);
        return next.value.slice(expected.length);
      } finally {
        clearTimeout(timeout);
      }
    };
    const request = async (kind, expected, ...payloads) => {
      const started = performance.now();
      child.stdin.write(kind + " " + payloads.map(value => Buffer.from(value, "utf8").toString("base64")).join(" ") + "\n");
      const value = await receive(expected);
      return { ms: performance.now() - started, value };
    };
    const command = value => request("COMMAND", "__NETLOGO_OK__", value);
    const report = async value => Buffer.from((await request("REPORT", "__NETLOGO_REPORT__", value)).value, "base64").toString("utf8");

    await receive("__NETLOGO_READY__");
    const defaults = {};
    for (const widget of preview.widgets.filter(widget => widget.kind === "slider")) {
      const variable = String(widget.details.variable);
      defaults[variable] = Number(await report(variable));
      if (defaults[variable] !== Number(widget.details.value)) {
        throw new Error(`Loaded default for ${variable} differs from the original model.`);
      }
    }
    await command(`random-seed ${SEED} setup`);
    const results = [];
    for (const targetTick of CHECKPOINTS) {
      const before = Number(await report("ticks"));
      if (!Number.isInteger(before) || before > targetTick) throw new Error(`Unexpected tick ${before}.`);
      const advance = await command(`repeat ${targetTick - before} [ go ]`);
      const actualTick = Number(await report("ticks"));
      if (actualTick !== targetTick) throw new Error(`Model stopped at tick ${actualTick}, before target ${targetTick}.`);
      const turtles = Number(await report("count turtles"));
      const sheep = Number(await report("count sheep"));
      const wolves = Number(await report("count wolves"));
      const viewTimes = [];
      const plotTimes = [];
      const csvDecodeTimes = [];
      const csvParseTimes = [];
      const csvPipelineTimes = [];
      const binaryAckTimes = [];
      const binaryReadTimes = [];
      const binaryPayloadTimes = [];
      const binaryParseTimes = [];
      const binaryPipelineTimes = [];
      let viewBase64;
      let plotBase64;
      let csvText;
      let csvPlot;
      let binaryBytes;
      let binaryPlot;
      for (let index = 0; index < WARMUPS + SAMPLES; index++) {
        const view = await request("EXPORT_VIEW", "__NETLOGO_VIEW__", path.join(directory, "view.png"));
        viewBase64 = view.value;
        const captureCsv = async () => {
          const started = performance.now();
          const plot = await request("EXPORT_PLOT", "__NETLOGO_PLOT__", PLOT_NAME, path.join(directory, "plot.csv"));
          plotBase64 = plot.value;
          const decodeStarted = performance.now();
          csvText = Buffer.from(plotBase64, "base64").toString("utf8");
          const decodeMs = performance.now() - decodeStarted;
          const parseStarted = performance.now();
          csvPlot = parsePlotCsv(csvText);
          const parseMs = performance.now() - parseStarted;
          if (index >= WARMUPS) {
            plotTimes.push(plot.ms);
            csvDecodeTimes.push(decodeMs);
            csvParseTimes.push(parseMs);
            csvPipelineTimes.push(performance.now() - started);
          }
        };
        const captureBinary = async () => {
          const started = performance.now();
          const exportPath = path.join(directory, "plot.bin");
          const plot = await request("EXPORT_PLOT_BINARY", "__NETLOGO_OK__", PLOT_NAME, exportPath);
          const readStarted = performance.now();
          binaryBytes = await fs.promises.readFile(exportPath);
          const readMs = performance.now() - readStarted;
          const payloadMs = performance.now() - started;
          const parseStarted = performance.now();
          binaryPlot = parsePlotBinary(binaryBytes);
          const parseMs = performance.now() - parseStarted;
          if (index >= WARMUPS) {
            binaryAckTimes.push(plot.ms);
            binaryReadTimes.push(readMs);
            binaryPayloadTimes.push(payloadMs);
            binaryParseTimes.push(parseMs);
            binaryPipelineTimes.push(performance.now() - started);
          }
        };
        // Five measured samples per order, at the exact same frozen model state.
        if (index % 2 === 0) { await captureCsv(); await captureBinary(); }
        else { await captureBinary(); await captureCsv(); }
        if (index >= WARMUPS) {
          viewTimes.push(view.ms);
        }
      }
      assertPlotParity(csvPlot, binaryPlot, configuredPens);
      // Match NetLogoRunResult from runner.ts; this model has one plot and no monitors.
      // This is a JSON cost proxy, not VS Code IPC or browser DOM/render timing.
      const result = {
        command: "go", ticks: String(actualTick), monitorValues: [],
        plotValues: [{ ...plotExporter, data: csvPlot }],
        viewImageDataUri: "data:image/png;base64," + viewBase64,
        view3DState: null
      };
      const json = measureSync(() => JSON.stringify(result));
      const binaryResult = { ...result, plotValues: [{ ...plotExporter, data: binaryPlot }] };
      const binaryJson = measureSync(() => JSON.stringify(binaryResult));
      const goTimes = [];
      for (let index = 0; index < WARMUPS + SAMPLES; index++) {
        const go = await command("go");
        if (index >= WARMUPS) goTimes.push(go.ms);
      }
      const goEndTick = Number(await report("ticks"));
      if (goEndTick !== actualTick + WARMUPS + SAMPLES) {
        throw new Error(`Measured go commands advanced from ${actualTick} to ${goEndTick}, not by ${WARMUPS + SAMPLES}.`);
      }
      const measured = {
        targetTick, actualTick, turtles, sheep, wolves,
        plotPoints: csvPlot.pens.map(pen => ({ name: pen.name, points: pen.points.length })),
        totalPlotPoints: csvPlot.pens.reduce((total, pen) => total + pen.points.length, 0),
        pngBytes: Buffer.from(viewBase64, "base64").length,
        pngBase64Bytes: Buffer.byteLength(viewBase64),
        csvBytes: Buffer.byteLength(csvText),
        csvBase64Bytes: Buffer.byteLength(plotBase64),
        binaryBytes: binaryBytes.length,
        runtimeResultJsonBytes: Buffer.byteLength(json.value),
        binaryRuntimeResultJsonBytes: Buffer.byteLength(binaryJson.value),
        exactPlotParity: true,
        medianMs: {
          exportViewRoundTrip: median(viewTimes),
          exportPlotRoundTrip: median(plotTimes),
          decodePlotBase64: median(csvDecodeTimes),
          parsePlotCsv: median(csvParseTimes),
          csvExportThroughParsedData: median(csvPipelineTimes),
          exportPlotBinaryAck: median(binaryAckTimes),
          readPlotBinaryFile: median(binaryReadTimes),
          exportPlotBinaryThroughRead: median(binaryPayloadTimes),
          parsePlotBinary: median(binaryParseTimes),
          binaryExportThroughParsedData: median(binaryPipelineTimes),
          stringifyRuntimeResult: json.medianMs,
          stringifyBinaryRuntimeResult: binaryJson.medianMs,
          goCommandRoundTrip: median(goTimes)
        },
        advance: { startTick: before, endTick: actualTick, elapsedMs: advance.ms },
        goMeasurement: { warmupStartTick: actualTick, sampleStartTick: actualTick + WARMUPS, endTick: goEndTick }
      };
      results.push(measured);
      console.error(`Measured tick ${actualTick}: ${turtles} turtles, ${measured.totalPlotPoints} plot points.`);
    }
    if (sha256(fs.readFileSync(modelPath)) !== sha256(modelSource)) throw new Error("Original model changed during benchmark.");
    console.log(JSON.stringify({
      model: "Wolf Sheep Simple 5", modelPath, modelSha256: sha256(modelSource),
      netLogoJar: installation.jarPath, nodeVersion: process.version,
      bridgeSha256: sha256(fs.readFileSync(bridgeSource)),
      plotParserSha256: sha256(fs.readFileSync(require.resolve("../out/plotCsv"))),
      binaryPlotParserSha256: sha256(fs.readFileSync(require.resolve("../out/plotSnapshot"))),
      seed: SEED, defaults, warmupsPerMetric: WARMUPS, samplesPerMetric: SAMPLES,
      notes: [
        "Exports/parsing/JSON use a frozen state at each exact checkpoint. go is then measured over 15 advancing ticks.",
        "Round trips include bridge dispatch, native work, PNG/CSV encoding, temporary-file IO and stdout/base64 transport.",
        "CSV and binary exports are paired in alternating order. Binary ACK, async file read and parse are measured separately.",
        "Export-through-parsed-data measures the entire transfer/parsing path directly, not a sum of component medians; file cleanup is excluded.",
        "JSON timing excludes webview IPC, DOM construction, plotting and image decoding; no end-to-end FPS is inferred.",
        "The simulation retains all native plot history; no points or agents are removed or sampled."
      ],
      results
    }, null, 2));
  } finally {
    if (child) {
      child.stdin.end();
      const killTimer = setTimeout(() => child.kill("SIGTERM"), 2000);
      const forceTimer = setTimeout(() => child.kill("SIGKILL"), 5000);
      await exited;
      clearTimeout(killTimer);
      clearTimeout(forceTimer);
    }
    lines?.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
