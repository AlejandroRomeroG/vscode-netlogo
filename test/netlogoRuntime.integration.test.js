const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  detectNetLogoInstallations,
  installationFromHome
} = require("../out/netlogoInstallation");
const { parsePlotCsv } = require("../out/plotCsv");
const { parseView3DBinary } = require("../out/view3D");

const root = path.join(__dirname, "..");
const configuredHome = process.env.NETLOGO_HOME;
const detectedInstallation = configuredHome
  ? installationFromHome(configuredHome)
  : detectNetLogoInstallations(process.platform === "darwin" ? ["/Applications"] : undefined)[0];

test("Java bridge runs the sample model against a real NetLogo installation", {
  skip: detectedInstallation ? false : "No local NetLogo installation detected"
}, () => {
  const classesDir = fs.mkdtempSync(path.join(os.tmpdir(), "netlogo-bridge-integration-"));
  try {
    const classPath = detectedInstallation.classPath.join(path.delimiter);
    const bridgePath = path.join(root, "resources", "java", "NetLogoCommandBridge.java");
    const compile = spawnSync("javac", ["-cp", classPath, "-d", classesDir, bridgePath], {
      encoding: "utf8"
    });
    assert.equal(compile.status, 0, compile.stderr || compile.stdout);

    const runtimeClassPath = [classesDir, ...detectedInstallation.classPath].join(path.delimiter);
    const input = [
      commandLine("COMMAND", "set density 12"),
      commandLine("COMMAND", "setup"),
      commandLine("COMMAND", "go"),
      commandLine("REPORT", "count turtles"),
      exportPlotLine("Population", path.join(classesDir, "population.csv")),
      exportViewLine(path.join(classesDir, "view.png"))
    ].join("\n") + "\n";

    const run = spawnSync("java", [
      ...detectedInstallation.jvmArgs,
      "-cp",
      runtimeClassPath,
      "NetLogoCommandBridge",
      path.join(root, "samples", "minimal.nlogo")
    ], {
      input,
      encoding: "utf8",
      maxBuffer: 4 * 1024 * 1024
    });

    assert.equal(run.status, 0, run.stderr || run.stdout);
    assert.match(run.stdout, /__NETLOGO_READY__/);
    assert.match(run.stdout, /__NETLOGO_REPORT__MTIuMA==/);
    assert.match(run.stdout, /__NETLOGO_PLOT__/);
    assert.match(run.stdout, /__NETLOGO_VIEW__/);
  } finally {
    fs.rmSync(classesDir, { recursive: true, force: true });
  }
});

test("Java bridge opens classic models whose section delimiter is attached to Code text", {
  skip: detectedInstallation && hasBiologySampleModel(detectedInstallation.home, "Ants.nlogo")
    ? false
    : "No local Ants sample model detected"
}, () => {
  const classesDir = fs.mkdtempSync(path.join(os.tmpdir(), "netlogo-bridge-ants-integration-"));
  try {
    const classPath = detectedInstallation.classPath.join(path.delimiter);
    const bridgePath = path.join(root, "resources", "java", "NetLogoCommandBridge.java");
    const compile = spawnSync("javac", ["-cp", classPath, "-d", classesDir, bridgePath], {
      encoding: "utf8"
    });
    assert.equal(compile.status, 0, compile.stderr || compile.stdout);

    const runtimeClassPath = [classesDir, ...detectedInstallation.classPath].join(path.delimiter);
    const input = [
      commandLine("COMMAND", "set diffusion-rate 99"),
      commandLine("COMMAND", "set evaporation-rate 10"),
      commandLine("COMMAND", "set population 200"),
      commandLine("COMMAND", "setup"),
      commandLine("COMMAND", "go"),
      commandLine("REPORT", "count turtles")
    ].join("\n") + "\n";

    const run = spawnSync("java", [
      ...detectedInstallation.jvmArgs,
      "-cp",
      runtimeClassPath,
      "NetLogoCommandBridge",
      path.join(detectedInstallation.home, "models", "Sample Models", "Biology", "Ants.nlogo")
    ], {
      input,
      encoding: "utf8",
      maxBuffer: 4 * 1024 * 1024
    });

    assert.equal(run.status, 0, run.stderr || run.stdout);
    assert.match(run.stdout, /__NETLOGO_READY__/);
    assert.doesNotMatch(run.stdout, /__NETLOGO_ERROR__/);
    assert.match(run.stdout, /__NETLOGO_REPORT__MjAwLjA=/);
  } finally {
    fs.rmSync(classesDir, { recursive: true, force: true });
  }
});

test("Java bridge runs turtle-context model commands used by Termites", {
  skip: detectedInstallation && hasBiologySampleModel(detectedInstallation.home, "Termites.nlogo")
    ? false
    : "No local Termites sample model detected"
}, () => {
  const classesDir = fs.mkdtempSync(path.join(os.tmpdir(), "netlogo-bridge-termites-integration-"));
  try {
    const classPath = detectedInstallation.classPath.join(path.delimiter);
    const bridgePath = path.join(root, "resources", "java", "NetLogoCommandBridge.java");
    const compile = spawnSync("javac", ["-cp", classPath, "-d", classesDir, bridgePath], {
      encoding: "utf8"
    });
    assert.equal(compile.status, 0, compile.stderr || compile.stdout);

    const runtimeClassPath = [classesDir, ...detectedInstallation.classPath].join(path.delimiter);
    const input = [
      commandLine("COMMAND", "setup"),
      commandLine("COMMAND", "ask turtles [ go ]"),
      commandLine("REPORT", "count turtles")
    ].join("\n") + "\n";

    const run = spawnSync("java", [
      ...detectedInstallation.jvmArgs,
      "-cp",
      runtimeClassPath,
      "NetLogoCommandBridge",
      path.join(detectedInstallation.home, "models", "Sample Models", "Biology", "Termites.nlogo")
    ], {
      input,
      encoding: "utf8",
      maxBuffer: 4 * 1024 * 1024
    });

    assert.equal(run.status, 0, run.stderr || run.stdout);
    assert.match(run.stdout, /__NETLOGO_READY__/);
    assert.doesNotMatch(run.stdout, /__NETLOGO_ERROR__/);
    const reports = [...run.stdout.matchAll(/__NETLOGO_REPORT__([^\n]+)/g)].map(match => Buffer.from(match[1], "base64").toString("utf8"));
    assert.equal(Number(reports[0]) > 0, true);
  } finally {
    fs.rmSync(classesDir, { recursive: true, force: true });
  }
});

test("Java bridge exports every Rabbits Grass Weeds plot pen with native metadata", {
  skip: detectedInstallation && hasBiologySampleModel(detectedInstallation.home, "Rabbits Grass Weeds.nlogo")
    ? false
    : "No local Rabbits Grass Weeds sample model detected"
}, () => {
  const classesDir = fs.mkdtempSync(path.join(os.tmpdir(), "netlogo-bridge-rabbits-integration-"));
  try {
    const classPath = detectedInstallation.classPath.join(path.delimiter);
    const bridgePath = path.join(root, "resources", "java", "NetLogoCommandBridge.java");
    const compile = spawnSync("javac", ["-cp", classPath, "-d", classesDir, bridgePath], {
      encoding: "utf8"
    });
    assert.equal(compile.status, 0, compile.stderr || compile.stdout);

    const exportPath = path.join(classesDir, "populations.csv");
    const runtimeClassPath = [classesDir, ...detectedInstallation.classPath].join(path.delimiter);
    const input = [
      commandLine("COMMAND", "setup"),
      commandLine("COMMAND", "repeat 4 [ go ]"),
      commandLine("REPORT", "count rabbits"),
      exportPlotLine("Populations", exportPath)
    ].join("\n") + "\n";

    const run = spawnSync("java", [
      ...detectedInstallation.jvmArgs,
      "-cp",
      runtimeClassPath,
      "NetLogoCommandBridge",
      path.join(detectedInstallation.home, "models", "Sample Models", "Biology", "Rabbits Grass Weeds.nlogo")
    ], {
      input,
      encoding: "utf8",
      maxBuffer: 4 * 1024 * 1024
    });

    assert.equal(run.status, 0, run.stderr || run.stdout);
    assert.doesNotMatch(run.stdout, /__NETLOGO_ERROR__/);
    const monitorReports = [...run.stdout.matchAll(/__NETLOGO_REPORT__([^\n]+)/g)]
      .map(match => Buffer.from(match[1], "base64").toString("utf8"));
    assert.equal(Number(monitorReports[0]) > 0, true);

    const plotExport = run.stdout.match(/__NETLOGO_PLOT__([^\n]+)/);
    assert.ok(plotExport, "NetLogo did not return the Populations plot export");
    const plot = parsePlotCsv(Buffer.from(plotExport[1], "base64").toString("utf8"));
    assert.equal(plot.name, "Populations");
    assert.equal(plot.numberOfPens, 3);
    assert.equal(plot.yMin, 0);
    assert.equal(plot.yMax, 150);
    assert.equal(plot.legend, true);
    assert.deepEqual(plot.pens.map(pen => pen.name), ["grass", "rabbits", "weeds"]);
    assert.deepEqual(plot.pens.map(pen => pen.color), [55, 15, 115]);
    assert.equal(plot.pens.every(pen => pen.points.length >= 5), true);
  } finally {
    fs.rmSync(classesDir, { recursive: true, force: true });
  }
});

test("Java bridge runs 3D models with a 3D workspace", {
  skip: detectedInstallation && has3DSampleModel(detectedInstallation.home) ? false : "No local NetLogo 3D sample model detected"
}, () => {
  const classesDir = fs.mkdtempSync(path.join(os.tmpdir(), "netlogo-bridge-3d-integration-"));
  try {
    const classPath = detectedInstallation.classPath.join(path.delimiter);
    const bridgePath = path.join(root, "resources", "java", "NetLogoCommandBridge.java");
    const compile = spawnSync("javac", ["-cp", classPath, "-d", classesDir, bridgePath], {
      encoding: "utf8"
    });
    assert.equal(compile.status, 0, compile.stderr || compile.stdout);

    const runtimeClassPath = [classesDir, ...detectedInstallation.classPath].join(path.delimiter);
    const input = [
      commandLine("COMMAND", "setup"),
      commandLine("COMMAND", "go"),
      commandLine("REPORT", "ticks"),
      commandLine("REPORT", "count turtles"),
      commandLine("REPORT", "[ (word who \"|\" xcor \"|\" ycor \"|\" zcor \"|\" color \"|\" (item 0 (extract-rgb color)) \"|\" (item 1 (extract-rgb color)) \"|\" (item 2 (extract-rgb color)) \"|\" heading \"|\" pitch \"|\" size \"|\" shape \"|\" label \"|\" label-color \"|\" (item 0 (extract-rgb label-color)) \"|\" (item 1 (extract-rgb label-color)) \"|\" (item 2 (extract-rgb label-color))) ] of turtles"),
      commandLine("REPORT", "[ (word [who] of end1 \"|\" [who] of end2 \"|\" color \"|\" (item 0 (extract-rgb color)) \"|\" (item 1 (extract-rgb color)) \"|\" (item 2 (extract-rgb color)) \"|\" thickness \"|\" (is-directed-link? self) \"|\" shape \"|\" label \"|\" label-color \"|\" (item 0 (extract-rgb label-color)) \"|\" (item 1 (extract-rgb label-color)) \"|\" (item 2 (extract-rgb label-color))) ] of links"),
      commandLine("REPORT", "[ (word pxcor \"|\" pycor \"|\" pzcor \"|\" pcolor \"|\" (item 0 (extract-rgb pcolor)) \"|\" (item 1 (extract-rgb pcolor)) \"|\" (item 2 (extract-rgb pcolor))) ] of patches with [pcolor != black]"),
      commandLine("COMMAND", "ask turtle 0 [ hide-turtle set roll 33 set color [12 34 56 78] set label \"leaf | ñ\" ]"),
      commandLine("EXPORT_VIEW_3D", path.join(classesDir, "flocking.bin"))
    ].join("\n") + "\n";

    const run = spawnSync("java", [
      ...detectedInstallation.jvmArgs,
      "-cp",
      runtimeClassPath,
      "NetLogoCommandBridge",
      "--3d",
      path.join(detectedInstallation.home, "models", "3D", "Sample Models", "Flocking 3D.nlogo3d")
    ], {
      input,
      encoding: "utf8",
      maxBuffer: 4 * 1024 * 1024
    });

    assert.equal(run.status, 0, run.stderr || run.stdout);
    assert.match(run.stdout, /__NETLOGO_READY__/);
    assert.doesNotMatch(run.stdout, /__NETLOGO_ERROR__/);
    const reports = [...run.stdout.matchAll(/__NETLOGO_REPORT__([^\n]+)/g)].map(match => Buffer.from(match[1], "base64").toString("utf8"));
    assert.equal(reports[1], "200.0");
    assert.match(reports[2], /,\s*\d+\|/);
    assert.match(reports[2], /\|\d+\|\d+\|\d+\|/);
    assert.match(reports[2], /\|default\|/);
    assert.equal(reports[3], "[]");
    assert.equal(reports[4], "[]");
    const snapshot = parseView3DBinary(fs.readFileSync(path.join(classesDir, "flocking.bin")));
    assert.equal(snapshot.turtleCount, 200);
    const hidden = snapshot.turtles.find(turtle => turtle.who === 0);
    assert.equal(hidden.hidden, true);
    assert.equal(hidden.roll, 33);
    assert.equal(hidden.label, "leaf | ñ");
    assert.equal(hidden.alpha, 78);
  } finally {
    fs.rmSync(classesDir, { recursive: true, force: true });
  }
});

test("Java bridge exports every Tree Simple 3D trail in compact binary form", {
  skip: detectedInstallation && hasTree3DSampleModel(detectedInstallation.home)
    ? false
    : "No local Tree Simple 3D sample model detected"
}, () => {
  const classesDir = fs.mkdtempSync(path.join(os.tmpdir(), "netlogo-bridge-tree-3d-integration-"));
  try {
    const classPath = detectedInstallation.classPath.join(path.delimiter);
    const bridgePath = path.join(root, "resources", "java", "NetLogoCommandBridge.java");
    const compile = spawnSync("javac", ["-cp", classPath, "-d", classesDir, bridgePath], {
      encoding: "utf8"
    });
    assert.equal(compile.status, 0, compile.stderr || compile.stdout);

    const exportPath = path.join(classesDir, "tree-drawing.bin");
    const runtimeClassPath = [classesDir, ...detectedInstallation.classPath].join(path.delimiter);
    const input = [
      commandLine("COMMAND", "setup"),
      commandLine("COMMAND", "repeat 8 [ iterate ]"),
      commandLine("REPORT", "count turtles"),
      commandLine("EXPORT_VIEW_3D", path.join(classesDir, "tree.bin")),
      exportDrawing3DBinaryLine(exportPath)
    ].join("\n") + "\n";
    const run = spawnSync("java", [
      ...detectedInstallation.jvmArgs,
      "-cp",
      runtimeClassPath,
      "NetLogoCommandBridge",
      "--3d",
      path.join(detectedInstallation.home, "models", "3D", "Sample Models", "Tree Simple 3D.nlogo3d")
    ], {
      input,
      encoding: "utf8",
      maxBuffer: 4 * 1024 * 1024,
      timeout: 5 * 60_000
    });

    assert.equal(run.status, 0, run.stderr || run.stdout);
    assert.match(run.stdout, /__NETLOGO_REPORT__NjU1MzYuMA==/);
    const tree = parseView3DBinary(fs.readFileSync(path.join(classesDir, "tree.bin")));
    assert.equal(tree.turtles.length, 65536);
    assert.equal(new Set(tree.turtles.map(turtle => turtle.who)).size, 65536);
    const drawing = fs.readFileSync(exportPath);
    assert.equal(drawing.subarray(0, 4).toString("ascii"), "NLD3");
    assert.equal(drawing.readUInt32BE(4), 2);
    assert.equal(drawing.readUInt32BE(8), 599_989);
    const recordCount = drawing.readUInt32BE(12);
    assert.equal(recordCount > 0 && recordCount < 599_989, true);
    assert.equal(drawing.readUInt32BE(16), 32);
    assert.equal(drawing.length, 20 + recordCount * 32);
    assert.equal(drawing.readFloatBE(20), 0);
    assert.equal(drawing.readFloatBE(20 + 4), 0);
    assert.equal(drawing.readFloatBE(20 + 8), -30);
    assert.equal(drawing.readFloatBE(20 + 20), -28);
    assert.equal(drawing.readUInt32BE(20 + 28), 0xffeded31);
  } finally {
    fs.rmSync(classesDir, { recursive: true, force: true });
  }
});

test("native 3D snapshots export all Percolation patches without changing the simulation RNG", {
  skip: detectedInstallation && fs.existsSync(path.join(detectedInstallation.home, "models", "3D", "Sample Models", "Percolation 3D.nlogo3d"))
    ? false : "No local Percolation 3D sample model detected"
}, () => {
  const classesDir = fs.mkdtempSync(path.join(os.tmpdir(), "netlogo-percolation-snapshot-"));
  try {
    const classPath = detectedInstallation.classPath.join(path.delimiter);
    const compile = spawnSync("javac", ["-cp", classPath, "-d", classesDir, path.join(root, "resources", "java", "NetLogoCommandBridge.java")], { encoding: "utf8" });
    assert.equal(compile.status, 0, compile.stderr);
    const input = [
      commandLine("COMMAND", "random-seed 42 setup repeat 40 [ go ]"),
      commandLine("REPORT", "count patches with [pcolor != black]"),
      commandLine("EXPORT_VIEW_3D", path.join(classesDir, "tick40.bin")),
      commandLine("EXPORT_VIEW_3D", path.join(classesDir, "same-tick.bin")),
      commandLine("COMMAND", "repeat 43 [ go ]"),
      commandLine("REPORT", "count patches with [pcolor != black]"),
      commandLine("EXPORT_VIEW_3D", path.join(classesDir, "tick83.bin")),
      commandLine("COMMAND", "random-seed 8675309"),
      commandLine("REPORT", "random-float 1"),
      commandLine("COMMAND", "random-seed 8675309"),
      commandLine("EXPORT_VIEW_3D", path.join(classesDir, "rng.bin")),
      commandLine("REPORT", "random-float 1"),
      commandLine("COMMAND", "ask patches [ set pcolor black ] ask patch 0 0 0 [ set pcolor [12 34 56 78] ] ask patch 1 0 0 [ set pcolor [90 80 70 0] ]"),
      commandLine("EXPORT_VIEW_3D", path.join(classesDir, "rgba.bin")),
      commandLine("COMMAND", "ask patches [ set pcolor black ] ask patch 0 0 0 [ set pcolor [0 0 0] ] ask patch 1 0 0 [ set pcolor 0.1 ] ask patch 2 0 0 [ set pcolor white ] ask patch 3 0 0 [ set pcolor [12 34 56 255] ]"),
      commandLine("EXPORT_VIEW_3D", path.join(classesDir, "native-colors.bin")),
      commandLine("REPORT", "[extract-rgb pcolor] of patch 1 0 0"),
      commandLine("COMMAND", "ask patch 1 0 0 [ set pcolor red ] ask patch 2 0 0 [ set pcolor black ]"),
      commandLine("EXPORT_VIEW_3D", path.join(classesDir, "changed-colors.bin"))
    ].join("\n") + "\n";
    const run = spawnSync("java", [...detectedInstallation.jvmArgs, "-cp", [classesDir, classPath].join(path.delimiter), "NetLogoCommandBridge", "--3d",
      path.join(detectedInstallation.home, "models", "3D", "Sample Models", "Percolation 3D.nlogo3d")], { input, encoding: "utf8", timeout: 60000 });
    assert.equal(run.status, 0, run.stderr);
    assert.doesNotMatch(run.stdout, /__NETLOGO_ERROR__/);
    const reports = [...run.stdout.matchAll(/__NETLOGO_REPORT__([^\n]+)/g)].map(match => Buffer.from(match[1], "base64").toString());
    const first = fs.readFileSync(path.join(classesDir, "tick40.bin"));
    assert.deepEqual(first, fs.readFileSync(path.join(classesDir, "same-tick.bin")), "native iteration order is stable");
    for (const [index, name] of ["tick40.bin", "tick83.bin"].entries()) {
      const snapshot = parseView3DBinary(fs.readFileSync(path.join(classesDir, name)));
      assert.equal(snapshot.patchCount, Number(reports[index]));
      assert.ok(snapshot.patchCount > 10000);
      const records = new DataView(snapshot.patchData);
      const locations = new Set();
      const colors = new Set();
      for (let offset = 0; offset < records.byteLength; offset += 24) {
        locations.add([0, 4, 8].map(delta => records.getInt32(offset + delta)).join(","));
        colors.add(records.getFloat64(offset + 12));
      }
      assert.equal(locations.size, snapshot.patchCount);
      assert.deepEqual([...colors].sort((a, b) => a - b), [15, 35, 45]);
    }
    assert.equal(reports[2], reports[3], "view extraction must not consume simulation randomness");
    const rgba = parseView3DBinary(fs.readFileSync(path.join(classesDir, "rgba.bin")));
    assert.equal(rgba.patchCount, 1, "native invisible patches, including numeric black, are omitted");
    assert.equal(new DataView(rgba.patchData).getUint32(20), 0x4e0c2238);
    const colorsAtX = name => {
      const snapshot = parseView3DBinary(fs.readFileSync(path.join(classesDir, name)));
      const records = new DataView(snapshot.patchData);
      const colors = new Map();
      for (let offset = 0; offset < records.byteLength; offset += 24) {
        colors.set(records.getInt32(offset), records.getUint32(offset + 20));
      }
      return colors;
    };
    const nearBlack = reports[4].match(/[\d.]+/g).map(Number);
    assert.equal(nearBlack.length, 3);
    const nearBlackArgb = (0xff000000 | nearBlack[0] << 16 | nearBlack[1] << 8 | nearBlack[2]) >>> 0;
    assert.deepEqual(colorsAtX("native-colors.bin"), new Map([
      [0, 0xff000000], [1, nearBlackArgb], [2, 0xffffffff], [3, 0xff0c2238]
    ]), "RGB black remains opaque and cached numeric shades retain their native values");
    assert.deepEqual(colorsAtX("changed-colors.bin"), new Map([
      [0, 0xff000000], [1, 0xffd73229], [3, 0xff0c2238]
    ]), "the reusable export buffer cannot retain stale colors or hidden patches");
  } finally {
    fs.rmSync(classesDir, { recursive: true, force: true });
  }
});

function commandLine(kind, value) {
  return `${kind} ${encode(value)}`;
}

function exportViewLine(filePath) {
  return `EXPORT_VIEW ${encode(filePath)}`;
}

function exportPlotLine(plotName, filePath) {
  return `EXPORT_PLOT ${encode(plotName)} ${encode(filePath)}`;
}

function exportDrawing3DBinaryLine(filePath) {
  return `EXPORT_DRAWING_3D_BINARY ${encode(filePath)}`;
}

function encode(value) {
  return Buffer.from(value, "utf8").toString("base64");
}

function has3DSampleModel(home) {
  return fs.existsSync(path.join(home, "models", "3D", "Sample Models", "Flocking 3D.nlogo3d"));
}

function hasTree3DSampleModel(home) {
  return fs.existsSync(path.join(home, "models", "3D", "Sample Models", "Tree Simple 3D.nlogo3d"));
}

function hasBiologySampleModel(home, fileName) {
  return fs.existsSync(path.join(home, "models", "Sample Models", "Biology", fileName));
}
