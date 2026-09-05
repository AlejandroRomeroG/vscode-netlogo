const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");

test("long line plots submit each complete SVG path once without dropping points", () => {
  const { renderPlotSeries, metrics } = plotRenderer();
  const frame = { left: 0, right: 160, top: 0, bottom: 100 };
  for (const size of [5_000, 20_000]) {
    const points = Array.from({ length: size }, (_, x) => ({ x, y: (x * 17) % 101, penDown: true }));
    const layer = new SvgElement("g", metrics);
    metrics.pathWrites = 0;
    metrics.pathCharacters = 0;

    renderPlotSeries(layer, { mode: 0, color: 55, points }, frame, [0, size], [0, 100]);

    const paths = layer.children.filter(child => child.tagName === "path");
    assert.equal(paths.length, 1);
    assert.equal(metrics.pathWrites, 1, "Growing path prefixes must not be repeatedly submitted to the DOM");
    const expected = points.map((point, index) =>
      `${index === 0 ? "M" : "L"} ${point.x / size * 160} ${100 + point.y / 100 * -100}`
    ).join(" ");
    assert.equal(paths[0].attributes.d, expected, "Every original coordinate is retained in order");
    assert.equal(metrics.pathCharacters, expected.length, "Submitted path data grows linearly with history");
    assert.equal(layer.children[0].tagName, "rect", "The initial line point remains visible");
    assert.equal(paths[0].attributes["vector-effect"], "non-scaling-stroke");
  }
});

test("line batching preserves ordered color changes, pen-up gaps, and trailing segments", () => {
  const { renderPlotSeries, metrics } = plotRenderer();
  const layer = new SvgElement("g", metrics);
  const colors = [15, 15, 15, 55, 55, 55, 15, 15, 15, 15, 15];
  const penUp = new Set([4, 7, 8, 10]);
  const points = colors.map((color, x) => ({ x, y: x, color, penDown: !penUp.has(x) }));

  renderPlotSeries(layer, { mode: 0, color: 115, points }, {
    left: 0, right: 100, top: 0, bottom: 100
  }, [0, 10], [0, 10]);

  assert.equal(layer.children[0].attributes.fill, "color-15");
  assert.deepEqual(layer.children.slice(1).map(child => ({
    color: child.attributes.stroke,
    path: child.attributes.d
  })), [
    { color: "color-15", path: "M 0 100 L 10 90 L 20 80" },
    { color: "color-55", path: "M 20 80 L 30 70" },
    { color: "color-55", path: "M 40 60 L 50 50" },
    { color: "color-15", path: "M 50 50 L 60 40" },
    { color: "color-15", path: "M 80 20 L 90 10" }
  ]);
  assert.equal(metrics.pathWrites, 5, "Only completed color/gap segments are submitted");
});

test("line batching does not invent strokes for empty, single-point, or pen-up-only histories", () => {
  const { renderPlotSeries, metrics } = plotRenderer();
  const frame = { left: 0, right: 100, top: 0, bottom: 100 };
  for (const [points, expectedPoints] of [
    [[], 0],
    [[{ x: 1, y: 2, penDown: true }], 1],
    [[{ x: 1, y: 2, penDown: false }, { x: 2, y: 3, penDown: false }], 0]
  ]) {
    const layer = new SvgElement("g", metrics);
    renderPlotSeries(layer, { mode: 0, color: 55, points }, frame, [0, 10], [0, 10]);
    assert.equal(layer.children.length, expectedPoints);
    assert.ok(layer.children.every(child => child.tagName === "rect"));
  }
  assert.equal(metrics.pathWrites, 0);
});

test("native ARGB colors are never mistaken for palette numbers, including zero alpha", () => {
  const { plotCssColor } = plotRenderer(true);
  for (const [argb, expected] of [
    [0, "#000000"], [15, "#00000f"], [140, "#00008c"],
    [0xff00000f | 0, "#00000f"], [0x800c2238 | 0, "#0c2238"], [-1, "#ffffff"]
  ]) {
    assert.equal(plotCssColor(argb, "argb"), expected);
  }
  assert.equal(plotCssColor(15), "#d73229", "A palette choice must remain red");
  assert.equal(plotCssColor(55), "#59b03c");
  assert.equal(plotCssColor(0xffd73229 | 0), "#d73229", "Classic configured ARGB remains supported");
});

test("all plot modes and legend swatches honor explicit native ARGB colors", () => {
  const { renderPlotSeries, renderPlotLegend, metrics } = plotRenderer(true);
  const frame = { left: 0, right: 100, top: 0, bottom: 100 };
  for (const mode of [0, 1, 2]) {
    const pen = { name: "native", mode, interval: 1, color: 15, colorFormat: "argb", points: [
      { x: 0, y: 1, color: 0, penDown: true },
      { x: 1, y: 2, color: 15, penDown: true },
      { x: 2, y: 3, color: 140, penDown: true },
      { x: 3, y: 4, penDown: true }
    ] };
    const layer = new SvgElement("g", metrics);
    renderPlotSeries(layer, pen, frame, [0, 10], [0, 10]);
    assert.deepEqual(layer.children.map(child => child.attributes.stroke ?? child.attributes.fill),
      ["#000000", "#00000f", "#00008c", "#00000f"]);
    const legend = new SvgElement("g", metrics);
    renderPlotLegend(legend, [pen], 80);
    assert.equal(legend.children[0].children[0].children[0].style.backgroundColor, "#00000f");
  }
});

test("editing a palette color keeps recorded ARGB point colors and independent legend metadata", () => {
  const { plotSeriesForWidget, renderPlotSeries, renderPlotLegend, metrics } = plotRenderer(true);
  const widget = { details: { pens: [{ name: "pen", mode: 2, color: 15, inLegend: true }] } };
  const runtime = { pens: [{ name: "pen", mode: 2, color: 15, colorFormat: "argb", inLegend: false, points: [
    { x: 0, y: 1, color: 15, penDown: true }, { x: 1, y: 2, penDown: true }
  ] }] };
  const live = plotSeriesForWidget(widget, runtime, false)[0];
  assert.equal(live.colorFormat, "argb");
  assert.equal(live.inLegend, false, "Runtime legend metadata remains authoritative when unedited");

  const edited = plotSeriesForWidget(widget, runtime, true)[0];
  assert.equal(edited.colorFormat, undefined, "The new editor choice is a palette number");
  assert.equal(edited.pointColorFormat, "argb", "Recorded points keep their native encoding");
  assert.equal(edited.inLegend, true, "A pending legend edit remains visible");
  const layer = new SvgElement("g", metrics);
  renderPlotSeries(layer, edited, { left: 0, right: 100, top: 0, bottom: 100 }, [0, 10], [0, 10]);
  assert.deepEqual(layer.children.map(child => child.attributes.fill), ["#00000f", "#d73229"]);
  const legend = new SvgElement("g", metrics);
  renderPlotLegend(legend, [edited], 80);
  assert.equal(legend.children[0].children[0].children[0].style.backgroundColor, "#d73229");
});

test("hidden native pens retain their history and legend metadata without drawing series", () => {
  const { plotSeriesForWidget, renderPlotSeries, renderPlotLegend, metrics } = plotRenderer(true);
  for (const mode of [0, 1, 2]) {
    const pen = { name: "hidden", mode, interval: 1, color: 15, colorFormat: "argb",
      hidden: true, inLegend: true, points: [{ x: 1, y: 2, color: 15, penDown: true }] };
    const series = plotSeriesForWidget({ details: { pens: [] } }, { pens: [pen] }, false);
    assert.equal(series[0].points, pen.points);
    const layer = new SvgElement("g", metrics);
    renderPlotSeries(layer, series[0], { left: 0, right: 100, top: 0, bottom: 100 }, [0, 10], [0, 10]);
    assert.equal(layer.children.length, 0);
    const legend = new SvgElement("g", metrics);
    renderPlotLegend(legend, series.filter(candidate => candidate.inLegend !== false), 80);
    assert.equal(legend.children[0].children[0].children[0].style.backgroundColor, "#00000f", "Hiding a pen does not remove its legend entry");
  }
});

class SvgElement {
  constructor(tagName, metrics) {
    this.tagName = tagName;
    this.metrics = metrics;
    this.attributes = {};
    this.children = [];
    this.style = {};
  }
  setAttribute(name, value) {
    this.attributes[name] = String(value);
    if (name === "d") {
      this.metrics.pathWrites += 1;
      this.metrics.pathCharacters += String(value).length;
    }
  }
  append(...children) {
    this.children.push(...children);
  }
}

function plotRenderer(useNativeColors = false) {
  const originalLoad = Module._load;
  let NetLogoModelEditorProvider;
  try {
    Module._load = function (request, parent, isMain) {
      return request === "vscode"
        ? { Uri: { joinPath: (_base, ...parts) => ({ toString: () => parts.join("/") }) }, workspace: {}, window: {} }
        : originalLoad.call(this, request, parent, isMain);
    };
    ({ NetLogoModelEditorProvider } = require("../out/netlogoEditor"));
  } finally {
    Module._load = originalLoad;
  }
  const html = new NetLogoModelEditorProvider({ extensionUri: {} }, {}).getHtml({
    cspSource: "test", asWebviewUri: value => value
  });
  const script = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].at(-1)[1];
  const fragment = (startMarker, endMarker) => {
    const start = script.indexOf(startMarker);
    const end = script.indexOf(endMarker, start);
    assert.ok(start >= 0 && end > start, "The generated plot renderer was not found");
    return script.slice(start, end);
  };
  const metrics = { pathWrites: 0, pathCharacters: 0 };
  const plotCssColor = new Function([
    fragment("function netLogoColorHex(", "\n    function threeColorHex"),
    fragment("function rgbToHex(", "\n    function renderPlotBody"),
    fragment("function plotCssColor(", "\n    function renderPlotAxes"),
    "return plotCssColor;"
  ].join("\n"))();
  const functions = new Function("document", "plotCssColor", "svgText", "node", [
    fragment("function plotSeriesForWidget(", "\n    function plotCssColor"),
    fragment("function normalizePlotPoint(", "\n    function plotDomain"),
    fragment("function scaleLinear(", "\n    function formatTick"),
    "return { renderPlotSeries, renderPlotLegend, plotSeriesForWidget };"
  ].join("\n"))(
    { createElementNS: (_namespace, tag) => new SvgElement(tag, metrics) },
    useNativeColors ? plotCssColor : color => `color-${color}`,
    () => new SvgElement("text", metrics),
    (tag, className, children) => {
      const element = new SvgElement(tag, metrics);
      element.className = className;
      if (Array.isArray(children)) element.append(...children);
      else element.textContent = children;
      return element;
    }
  );
  return { ...functions, plotCssColor, metrics };
}
