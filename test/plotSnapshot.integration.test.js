const fs = require("node:fs");
const { bridgeSourcePaths } = require("../out/javaBridge");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");
const assert = require("node:assert/strict");
const { parsePlotCsv } = require("../out/plotCsv");
const { detectNetLogoInstallations, installationFromHome } = require("../out/netlogoInstallation");

const root = path.join(__dirname, "..");
const installation = process.env.NETLOGO_HOME
  ? installationFromHome(process.env.NETLOGO_HOME)
  : detectNetLogoInstallations(process.platform === "darwin" ? ["/Applications"] : undefined)[0];
const rabbitsPath = installation && path.join(
  installation.home, "models", "Sample Models", "Biology", "Rabbits Grass Weeds.nlogo"
);
const unicodePlot = 'Plot "café" | Δ';
const unicodePen = 'pen "caña" | λ';
const temporaryPen = 'temporary "café" | β';
// Native ARGB values stored in the original Rabbits model's permanent pen definitions.
const paletteArgb = new Map([[0, -16777216], [55, -10899396], [15, -2674135], [115, -8630108]]);

test("binary plot snapshots preserve native metadata, history, resets, colors, and observer state", {
  skip: rabbitsPath && fs.existsSync(rabbitsPath) ? false : "No local Rabbits Grass Weeds sample model detected"
}, () => {
  const { parsePlotBinary } = require("../out/plotSnapshot");
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "netlogo-plot-snapshot-integration-"));
  try {
    const compile = spawnSync("javac", [
      "-cp", installation.classPath.join(path.delimiter), "-d", tempDir,
      ...bridgeSourcePaths(path.join(root, "resources", "java"))
    ], { encoding: "utf8", timeout: 60000 });
    assert.equal(compile.status, 0, compile.error?.message || compile.stderr || compile.stdout);

    const sections = fs.readFileSync(rabbitsPath, "utf8").split("@#$#@#$#@");
    sections[1] += secondaryPlotFixture();
    const modelPath = path.join(tempDir, "Rabbits snapshot fixture.nlogo");
    fs.writeFileSync(modelPath, sections.join("@#$#@#$#@"));

    const commands = [];
    const csvSnapshots = [];
    const command = value => commands.push(encodedCommand("COMMAND", value));
    const report = value => commands.push(encodedCommand("REPORT", value));
    const snapshot = (name, plotName = "Populations", compareCsv = false) => {
      commands.push(`EXPORT_PLOT_BINARY ${encode(plotName)} ${encode(path.join(tempDir, name + ".bin"))}`);
      if (compareCsv) {
        commands.push(`EXPORT_PLOT ${encode(plotName)} ${encode(path.join(tempDir, name + ".csv"))}`);
        csvSnapshots.push(name);
      }
    };

    command("random-seed 24680 setup repeat 4 [ go ]");
    snapshot("rabbits", "Populations", true);
    snapshot("unicode", unicodePlot, true);

    command('set-current-plot "Populations" set-current-plot-pen "grass" '
      + "set-plot-pen-mode 1 set-plot-pen-interval 0.5 plot-pen-up plotxy 8 40 "
      + "plot-pen-down set-plot-pen-color red plotxy 9 20");
    snapshot("changed", "Populations", true);
    command('set-current-plot-pen "weeds" set-plot-pen-mode 2 set-plot-pen-interval 2 plotxy 12 3');
    snapshot("points", "Populations", true);
    command(`create-temporary-plot-pen ${logoString(temporaryPen)} `
      + "set-plot-pen-color [12 34 56] set-plot-pen-interval 0.25 plotxy 10.5 17 "
      + "plot-pen-up plotxy 11.75 -2 plot-pen-down");
    snapshot("rgb");

    // Exporting a different plot must not change either selection or consume randomness.
    command(`set-current-plot ${logoString(unicodePlot)} set-current-plot-pen ${logoString(unicodePen)} random-seed 13579`);
    report("random-float 1");
    command("random-seed 13579");
    report("plot-name");
    snapshot("nonmutating");
    report("plot-name");
    report("random-float 1");
    command("plotxy 123 456");
    snapshot("selection", unicodePlot);

    // Small nonnegative ARGB integers overlap NetLogo's numeric palette range.
    // They must remain RGB channel values, not become red (palette 15), etc.
    command(`set-current-plot "Populations" set-current-plot-pen ${logoString(temporaryPen)} `
      + "set-plot-pen-color [0 0 15 0] plotxy 12 3 "
      + "set-plot-pen-color [0 0 0 0] plotxy 13 4 "
      + "set-plot-pen-color [0 0 140 0] plotxy 14 5");
    snapshot("small-argb");

    command('set-current-plot "Populations" set-current-plot-pen "grass" plot-pen-reset');
    snapshot("pen-reset");
    command("clear-plot");
    snapshot("cleared", "Populations", true);
    command('set-current-plot-pen "grass" let sample 0 repeat 5001 [ plotxy sample (sample mod 13) set sample sample + 1 ]');
    snapshot("long-history");
    command("set-plot-pen-mode 1 set-plot-x-range 0 5 set-plot-pen-interval 1 histogram [0 0 1 1 1 4]");
    snapshot("histogram", "Populations", true);
    command("histogram [2 2]");
    snapshot("histogram-replaced", "Populations", true);

    const run = spawnSync("java", [
      ...installation.jvmArgs,
      "-Djava.awt.headless=true",
      "-cp", [tempDir, ...installation.classPath].join(path.delimiter),
      "NetLogoCommandBridge", modelPath
    ], {
      input: commands.join("\n") + "\n",
      encoding: "utf8", timeout: 60000, maxBuffer: 4 * 1024 * 1024
    });
    assert.equal(run.status, 0, run.error?.message || run.stderr || run.stdout);
    assert.doesNotMatch(run.stdout, /__NETLOGO_ERROR__/, decodeErrors(run.stdout));
    assert.match(run.stdout, /__NETLOGO_READY__/);

    const read = name => parsePlotBinary(fs.readFileSync(path.join(tempDir, name + ".bin")));
    const csvExports = [...run.stdout.matchAll(/__NETLOGO_PLOT__([^\r\n]+)/g)]
      .map(match => parsePlotCsv(Buffer.from(match[1], "base64").toString("utf8")));
    assert.equal(csvExports.length, csvSnapshots.length);
    csvSnapshots.forEach((name, index) => {
      assert.deepEqual(csvComparable(read(name)), normalizeCsvColors(csvExports[index]),
        name + " must match NetLogo's complete native CSV export");
    });

    const rabbits = read("rabbits");
    assert.deepEqual(rabbits.pens.map(pen => pen.name), ["grass", "rabbits", "weeds"]);
    assert.deepEqual(rabbits.pens.map(pen => pen.color), [paletteArgb.get(55), paletteArgb.get(15), paletteArgb.get(115)]);
    assert.equal(rabbits.yMax, 150);
    assert.equal(rabbits.legend, true);
    assert.equal(rabbits.pens.every(pen => pen.points.length === 5), true);
    assert.equal(rabbits.pens.every(pen => pen.colorFormat === "argb"), true);

    const unicode = read("unicode");
    assert.equal(unicode.name, unicodePlot);
    assert.equal(unicode.autoplot, false);
    assert.equal(unicode.legend, false);
    assert.deepEqual([unicode.xMin, unicode.xMax, unicode.yMin, unicode.yMax], [-2, 8, -3, 9]);
    assert.deepEqual(unicode.pens.map(pen => [pen.name, pen.mode, pen.interval, pen.inLegend, pen.hidden]), [
      ["anchor", 0, 1, true, false], [unicodePen, 2, 0.5, false, false]
    ]);

    const changed = read("changed").pens[0];
    assert.equal(changed.mode, 1);
    assert.equal(changed.interval, 0.5);
    assert.deepEqual(changed.points.slice(-2), [
      { x: 8, y: 40, color: paletteArgb.get(55), penDown: false },
      { x: 9, y: 20, color: paletteArgb.get(15), penDown: true }
    ]);
    assert.equal(read("points").pens[2].mode, 2);
    const rgb = read("rgb");
    assert.equal(rgb.currentPen, temporaryPen);
    assert.equal(rgb.numberOfPens, 4);
    assert.deepEqual(rgb.pens[3].points, [
      { x: 10.5, y: 17, color: 0xff0c2238 | 0, penDown: true },
      { x: 11.75, y: -2, color: 0xff0c2238 | 0, penDown: false }
    ]);
    assert.equal(rgb.pens[3].color, 0xff0c2238 | 0);

    const reports = [...run.stdout.matchAll(/__NETLOGO_REPORT__([^\r\n]+)/g)]
      .map(match => Buffer.from(match[1], "base64").toString("utf8"));
    assert.equal(reports.length, 4);
    assert.equal(reports[0], reports[3], "snapshot export cannot consume the model's random sequence");
    assert.equal(reports[1], unicodePlot);
    assert.equal(reports[2], unicodePlot, "snapshot export cannot change the current plot");
    const selection = read("selection");
    assert.equal(selection.currentPen, unicodePen);
    assert.equal(selection.pens[0].points.length, 0);
    assert.deepEqual(selection.pens[1].points.map(({ x, y }) => ({ x, y })), [{ x: 123, y: 456 }]);
    assert.deepEqual(read("nonmutating"), rgb, "snapshot export cannot modify plot data or pen selection");

    const smallArgb = read("small-argb").pens[3];
    assert.equal(smallArgb.colorFormat, "argb");
    assert.equal(smallArgb.color, 140);
    assert.deepEqual(smallArgb.points.slice(-3), [
      { x: 12, y: 3, color: 15, penDown: true },
      { x: 13, y: 4, color: 0, penDown: true },
      { x: 14, y: 5, color: 140, penDown: true }
    ]);

    const penReset = read("pen-reset");
    assert.deepEqual(penReset.pens[0].points, []);
    assert.deepEqual([penReset.pens[0].mode, penReset.pens[0].interval, penReset.pens[0].color], [0, 1, paletteArgb.get(55)]);
    assert.deepEqual(penReset.pens[1], rgb.pens[1], "resetting one pen must preserve the other pens");
    const cleared = read("cleared");
    assert.equal(cleared.numberOfPens, 3, "clear-plot deletes temporary pens");
    assert.equal(cleared.pens.every(pen => pen.points.length === 0), true);
    assert.deepEqual(cleared.pens.map(pen => pen.name), ["grass", "rabbits", "weeds"]);

    const history = read("long-history").pens[0].points;
    assert.equal(history.length, 5001, "full snapshots cannot sample or truncate long histories");
    for (let index = 0; index < history.length; index++) {
      assert.deepEqual(history[index], { x: index, y: index % 13, color: paletteArgb.get(55), penDown: true });
    }
    const histogram = read("histogram").pens[0];
    assert.equal(histogram.mode, 1);
    assert.equal(histogram.points.length <= 5, true, "histogram replaces the old line history");
    assert.equal(histogram.points.reduce((sum, point) => sum + point.y, 0), 6);
    const replaced = read("histogram-replaced").pens[0].points;
    assert.equal(replaced.length <= 5, true);
    assert.equal(replaced.reduce((sum, point) => sum + point.y, 0), 2);
    assert.equal(replaced.some(point => point.x === 2 && point.y === 2), true);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

function secondaryPlotFixture() {
  return [
    "", "PLOT", "300", "500", "580", "680", unicodePlot, "x", "y",
    "-2", "8", "-3", "9", "false", "false", '\"\" \"\"', "PENS",
    '\"anchor\" 1.0 0 -16777216 true \"\" \"\"',
    `${logoString(unicodePen)} 0.5 2 -8630108 false \"\" \"\"`, ""
  ].join("\n");
}

function csvComparable(plot) {
  return {
    ...plot,
    pens: plot.pens.map(({ hidden, inLegend, colorFormat, ...pen }) => pen)
  };
}

function normalizeCsvColors(plot) {
  const color = value => {
    assert.equal(paletteArgb.has(value), true, "unexpected palette number in native CSV: " + value);
    return paletteArgb.get(value);
  };
  return {
    ...plot,
    pens: plot.pens.map(pen => ({
      ...pen, color: color(pen.color),
      points: pen.points.map(point => ({ ...point, color: color(point.color) }))
    }))
  };
}

function logoString(value) {
  return '"' + value.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
}

function encode(value) {
  return Buffer.from(value, "utf8").toString("base64");
}

function encodedCommand(kind, value) {
  return kind + " " + encode(value);
}

function decodeErrors(stdout) {
  return [...stdout.matchAll(/__NETLOGO_ERROR__([^\r\n]+)/g)]
    .map(match => Buffer.from(match[1], "base64").toString("utf8")).join("\n");
}
