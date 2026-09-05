const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const Module = require("node:module");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");

test("generated model editor webview contains valid JavaScript", () => {
  for (const script of generatedWebviewScripts()) {
    const syntaxCheck = spawnSync(process.execPath, ["--check", "--input-type=module"], {
      input: script,
      encoding: "utf8"
    });
    assert.equal(syntaxCheck.status, 0, syntaxCheck.stderr || syntaxCheck.stdout);
  }
});

test("generated speed control follows NetLogo 6.4 tick-based timing", () => {
  const script = generatedWebviewScripts().at(-1);
  const start = script.indexOf("function runSpeedPosition()");
  const end = script.indexOf("\n    function startRunLoop", start);
  assert.ok(start >= 0 && end > start, "The speed timing functions were not found");

  const state = {
    runSpeed: 0,
    interfacePreview: {
      widgets: [{ kind: "view", details: { frameRate: 30 } }]
    }
  };
  const timing = new Function(
    "state",
    "RUN_SPEED_DEAD_ZONE",
    "RUN_SPEED_DEFAULT_FRAME_RATE",
    "RUN_SPEED_MAX_BATCH",
    "clampRunSpeed",
    script.slice(start, end) + "\nreturn { runSpeedPosition, runLoopDelayMs, runLoopTargetFps, runLoopBatchSize };"
  )(state, 10, 30, 256, value => Math.min(112, Math.max(-110, Math.round(Number(value)))));

  assert.equal(timing.runSpeedPosition(), 0);
  assert.ok(Math.abs(timing.runLoopTargetFps() - 30) < 1e-10);
  assert.equal(timing.runLoopBatchSize(), 1);

  state.runSpeed = 10;
  assert.equal(timing.runSpeedPosition(), 0, "the native center dead zone remains normal speed");
  state.runSpeed = 11;
  assert.equal(timing.runSpeedPosition(), 0.5);
  assert.ok(Math.abs(timing.runLoopTargetFps() - (30 + 0.5 - 1 + Math.pow(1.3, 0.5))) < 1e-10);

  state.runSpeed = -110;
  assert.equal(timing.runSpeedPosition(), -50);
  const slowFrameGap = 1000 / (30 * Math.pow(0.9, 50));
  const slowPause = Math.pow(Math.pow(9000, 0.02), 50);
  assert.ok(Math.abs(timing.runLoopDelayMs() - slowFrameGap - slowPause) < 1e-8);

  state.runSpeed = 60;
  assert.equal(timing.runSpeedPosition(), 25);
  assert.equal(timing.runLoopBatchSize(), 1, "NetLogo does not skip ticks through speed 25");
  state.runSpeed = 61;
  assert.equal(timing.runLoopBatchSize(), 2);
  state.runSpeed = 90;
  assert.equal(timing.runLoopBatchSize(), 16);
  state.runSpeed = 110;
  assert.equal(timing.runLoopBatchSize(), 256, "the bridge keeps native large gaps cooperatively bounded");

  state.runSpeed = 0;
  state.interfacePreview.widgets[0].details.frameRate = 45;
  assert.ok(Math.abs(timing.runLoopTargetFps() - 45) < 1e-10, "the model's configured frame rate is honored");

  const restoreStart = script.indexOf("function restoredRunSpeed(value)");
  const restoreEnd = script.indexOf("\n    function sanitizeThreeCamera", restoreStart);
  const restoredUiState = {};
  const restoreRunSpeed = new Function(
    "restoredUiState",
    "RUN_SPEED_RAW_MIN",
    "RUN_SPEED_RAW_MAX",
    "clampNumber",
    script.slice(restoreStart, restoreEnd) + "\nreturn restoredRunSpeed;"
  )(restoredUiState, -110, 112, (value, min, max) => Math.min(max, Math.max(min, value)));
  assert.equal(restoreRunSpeed(-10), -110);
  assert.equal(restoreRunSpeed(10), 110);
  restoredUiState.runSpeedScaleVersion = 2;
  assert.equal(restoreRunSpeed(61), 61);
});

test("generated monitor formatter groups numbers and removes unnecessary decimal zeroes", () => {
  const script = generatedWebviewScripts().at(-1);
  const start = script.indexOf("function formatMonitorValue(value, precision)");
  const end = script.indexOf("\n    function renderInterface", start);
  assert.ok(start >= 0 && end > start, "The monitor formatter was not found in the generated script");

  const formatter = new Function(
    "clampNumber",
    script.slice(start, end) + "\nreturn formatMonitorValue;"
  )((value, min, max) => Math.min(Math.max(value, min), max));

  assert.equal(formatter("237.0", 1), "237");
  assert.equal(formatter("12345.6", 1), "12,345.6");
  assert.equal(formatter("12345.67", 1), "12,345.7");
  assert.equal(formatter("-1.25", 1), "-1.2");
  assert.equal(formatter("1.25", 1), "1.3");
  assert.equal(formatter("1.0E-18", 17), "1.0E-18");
  assert.equal(formatter("0.000000000000000001", 17), "1.0E-18");
  assert.equal(formatter("1.2345678901234567E-18", 17), "1.2345678901234567E-18");
  assert.equal(formatter("9007199254740992.0", 17), "9,007,199,254,740,992");
  assert.equal(formatter("true", 1), "true");
});

test("generated plot editor exposes every NetLogo 6.4 default color swatch", () => {
  const script = generatedWebviewScripts().at(-1);
  const start = script.indexOf("function plotPalette()");
  const end = script.indexOf("\n    function descriptor", start);
  assert.ok(start >= 0 && end > start, "The plot palette was not found in the generated script");

  const plotPalette = new Function(
    "netLogoColorHex",
    script.slice(start, end) + "\nreturn plotPalette;"
  )(colorNumber => Math.round(colorNumber * 10));
  const palette = plotPalette();

  assert.equal(palette.length, 14 * 11);
  assert.deepEqual(palette.slice(0, 11).map(entry => entry.colorNumber), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 9.9]);
  assert.deepEqual(palette.slice(-11).map(entry => entry.colorNumber), [130, 131, 132, 133, 134, 135, 136, 137, 138, 139, 139.9]);
  assert.equal(palette.find(entry => entry.colorNumber === 0).name, "black");
  assert.equal(palette.find(entry => entry.colorNumber === 5).name, "gray");
  assert.equal(palette.find(entry => entry.colorNumber === 9.9).name, "white");
  assert.equal(palette.find(entry => entry.colorNumber === 55).name, "green");
});

test("generated plot renderer matches NetLogo line gaps and bar intervals", () => {
  const script = generatedWebviewScripts().at(-1);
  const renderStart = script.indexOf("function renderPlotSeries(svg, pen, frame, xDomain, yDomain)");
  const renderEnd = script.indexOf("\n    function renderPlotLegend", renderStart);
  const normalizeStart = script.indexOf("function normalizePlotPoint(point, frame, xDomain, yDomain)");
  const normalizeEnd = script.indexOf("\n    function plotDomain", normalizeStart);
  const scaleStart = script.indexOf("function scaleLinear(value, domain, outputMin, outputMax)");
  const scaleEnd = script.indexOf("\n    function formatTick", scaleStart);
  assert.ok([renderStart, renderEnd, normalizeStart, normalizeEnd, scaleStart, scaleEnd].every(index => index >= 0));

  class SvgElement {
    constructor(tagName) {
      this.tagName = tagName;
      this.attributes = {};
      this.children = [];
    }
    setAttribute(name, value) {
      this.attributes[name] = String(value);
    }
    append(...children) {
      this.children.push(...children);
    }
  }

  const documentStub = {
    createElementNS: (_namespace, tagName) => new SvgElement(tagName)
  };
  const renderPlotSeries = new Function(
    "document",
    "plotCssColor",
    [
      script.slice(renderStart, renderEnd),
      script.slice(normalizeStart, normalizeEnd),
      script.slice(scaleStart, scaleEnd),
      "return renderPlotSeries;"
    ].join("\n")
  )(documentStub, () => "#112233");
  const frame = { left: 0, right: 100, top: 0, bottom: 100 };

  const lineLayer = new SvgElement("g");
  renderPlotSeries(lineLayer, {
    mode: 0,
    color: 15,
    points: [
      { x: 1, y: 1, penDown: false },
      { x: 1, y: 3, penDown: true }
    ]
  }, frame, [0, 10], [0, 10]);
  assert.equal(lineLayer.children.length, 1);
  assert.equal(lineLayer.children[0].tagName, "path");
  assert.equal(lineLayer.children[0].attributes.d, "M 10 90 L 10 70");

  const barLayer = new SvgElement("g");
  renderPlotSeries(barLayer, {
    mode: 1,
    interval: 2,
    color: 55,
    points: [{ x: 1, y: 5, penDown: false }]
  }, frame, [0, 10], [0, 10]);
  assert.equal(barLayer.children.length, 1);
  assert.equal(barLayer.children[0].tagName, "rect");
  assert.equal(Number(barLayer.children[0].attributes.x), 10);
  assert.equal(Number(barLayer.children[0].attributes.width), 20);
  assert.equal(Number(barLayer.children[0].attributes.height), 50);

  const pointLayer = new SvgElement("g");
  renderPlotSeries(pointLayer, {
    mode: 2,
    color: 115,
    points: [{ x: 2, y: 4, penDown: false }]
  }, frame, [0, 10], [0, 10]);
  assert.equal(pointLayer.children.length, 1);
  assert.equal(pointLayer.children[0].tagName, "rect");
});

test("generated plot series stay fully visible when they coincide with an axis", () => {
  const script = generatedWebviewScripts().at(-1);
  const layerStart = script.indexOf("function plotSeriesLayer(svg, frame, widgetId)");
  const layerEnd = script.indexOf("\n    function plotSeriesForWidget", layerStart);
  const bodyStart = script.indexOf("function renderPlotBody(widget)");
  const bodyEnd = script.indexOf("\n    function plotSeriesLayer", bodyStart);
  assert.ok([layerStart, layerEnd, bodyStart, bodyEnd].every(index => index >= 0));

  class SvgElement {
    constructor(tagName) {
      this.tagName = tagName;
      this.attributes = {};
      this.children = [];
    }
    setAttribute(name, value) {
      this.attributes[name] = String(value);
    }
    append(...children) {
      this.children.push(...children);
    }
  }

  const documentStub = {
    createElementNS: (_namespace, tagName) => new SvgElement(tagName)
  };
  const plotSeriesLayer = new Function(
    "document",
    script.slice(layerStart, layerEnd) + "\nreturn plotSeriesLayer;"
  )(documentStub);
  const svg = new SvgElement("svg");
  const layer = plotSeriesLayer(svg, { left: 10, right: 90, top: 20, bottom: 70 }, "example plot");
  const clipRect = svg.children[0].children[0].children[0];

  assert.equal(clipRect.attributes.x, "9");
  assert.equal(clipRect.attributes.y, "19");
  assert.equal(clipRect.attributes.width, "82");
  assert.equal(clipRect.attributes.height, "52");
  assert.equal(layer.attributes["clip-path"], "url(#plot-clip-example-plot)");
  assert.equal(svg.children.at(-1), layer, "The clipped series group must remain the top painted plot layer");

  const bodySource = script.slice(bodyStart, bodyEnd);
  assert.ok(
    bodySource.indexOf("renderPlotAxes(") < bodySource.indexOf("plotSeriesLayer("),
    "Plot series must be appended after axes so coincident lines paint in front"
  );
});

test("generated plot renderer uses NetLogo's native pen colors", () => {
  const script = generatedWebviewScripts().at(-1);
  const paletteStart = script.indexOf("function netLogoColorHex(value)");
  const paletteEnd = script.indexOf("\n    function threeColorHex", paletteStart);
  const rgbStart = script.indexOf("function rgbToHex(red, green, blue)");
  const rgbEnd = script.indexOf("\n    function renderPlotBody", rgbStart);
  const plotColorStart = script.indexOf("function plotCssColor(");
  const plotColorEnd = script.indexOf("\n    function renderPlotAxes", plotColorStart);
  assert.ok([paletteStart, paletteEnd, rgbStart, rgbEnd, plotColorStart, plotColorEnd].every(index => index >= 0));

  const plotCssColor = new Function([
    script.slice(paletteStart, paletteEnd),
    script.slice(rgbStart, rgbEnd),
    script.slice(plotColorStart, plotColorEnd),
    "return plotCssColor;"
  ].join("\n"))();

  assert.equal(plotCssColor(55), "#59b03c");
  assert.equal(plotCssColor(15), "#d73229");
  assert.equal(plotCssColor(115), "#7c50a4");
  assert.equal(plotCssColor(-10899396), "#59b03c");
});

test("generated plot domains handle large point sets without exhausting the call stack", () => {
  const script = generatedWebviewScripts().at(-1);
  const start = script.indexOf("function plotDomain(points, widget, runtimePlot, axis, configurationDirty)");
  const end = script.indexOf("\n    function plotFrameForDomains", start);
  assert.ok(start >= 0 && end > start, "The plot domain calculator was not found in the generated script");

  const plotDomain = new Function(
    script.slice(start, end) + "\nreturn plotDomain;"
  )();
  const points = Array.from({ length: 150_000 }, (_, index) => ({
    x: index - 75_000,
    y: index % 1_000
  }));

  assert.deepEqual(
    plotDomain(points, { details: { xMin: -100_000, xMax: 100_000 } }, undefined, "x", false),
    [-100_000, 100_000]
  );
});

function generatedWebviewScripts() {
  const originalLoad = Module._load;
  const vscodeStub = {
    Uri: {
      joinPath: (_base, ...parts) => ({ toString: () => parts.join("/") })
    },
    workspace: {},
    window: {},
    commands: {},
    ProgressLocation: { Notification: 1 },
    Range: class Range {},
    WorkspaceEdit: class WorkspaceEdit {}
  };

  let NetLogoModelEditorProvider;
  try {
    Module._load = function loadWithVscodeStub(request, parent, isMain) {
      return request === "vscode"
        ? vscodeStub
        : originalLoad.call(this, request, parent, isMain);
    };
    ({ NetLogoModelEditorProvider } = require(path.join(root, "out", "netlogoEditor")));
  } finally {
    Module._load = originalLoad;
  }

  const provider = new NetLogoModelEditorProvider({ extensionUri: {} }, {});
  const html = provider.getHtml({
    cspSource: "test-csp",
    asWebviewUri: value => value
  });
  const scripts = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map(match => match[1]);
  assert.ok(scripts.length > 0, "The generated editor did not contain a script");
  return scripts;
}
