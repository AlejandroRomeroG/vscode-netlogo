const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");
const { plotLayoutSource, plotFixtures } = require("./helpers/plotLayout");

class Element {
  constructor(tagName) {
    this.tagName = tagName;
    this.attributes = {};
    this.children = [];
    this.style = {};
    this.textContent = "";
  }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  append(...children) { this.children.push(...children); }
}

function renderer() {
  const { source, css } = plotLayoutSource();
  const state = { plotData: {}, dirtyPlotWidgets: new Set() };
  const document = {
    body: {}, createElementNS: (_ns, tag) => new Element(tag),
    createElement: tag => {
      assert.equal(tag, "canvas");
      return { getContext: () => ({ measureText: text => ({ width: text.length * 5.5 }) }) };
    }
  };
  const node = (tag, className, content) => {
    const element = new Element(tag);
    element.attributes.class = className;
    if (Array.isArray(content)) element.append(...content);
    else element.textContent = content;
    return element;
  };
  return { css, state, ...new Function("document", "getComputedStyle", "state", "node", source +
    "\nreturn {renderPlotBody, plotFrameForDomains, formatTick, axisTicks, axisLabel};")(
    document, () => ({ fontFamily: "sans-serif" }), state, node
  ) };
}

function descendants(element) {
  return [element, ...element.children.flatMap(descendants)];
}

test("plots use CSS-pixel viewports with bounded grid tracks instead of an intrinsic 4:3 canvas", () => {
  const { css, state, renderPlotBody } = renderer();
  assert.match(css, /\.plot-widget\s*\{[^}]*grid-template-rows: 22px minmax\(0, 1fr\)/);
  assert.match(css, /\.plot-body\s*\{[^}]*min-height: 0/);
  assert.match(css, /\.plot-svg\s*\{[^}]*position: absolute/);
  assert.doesNotMatch(css, /\.plot-footer/);
  for (const { widget, runtime } of plotFixtures()) {
    state.plotData[widget.id] = runtime;
    const body = renderPlotBody(widget), svg = body.children[0];
    assert.equal(svg.attributes.viewBox, undefined, "No viewBox transform may rescale CSS-pixel text");
    assert.equal(svg.attributes["aria-label"], widget.label);
    assert.ok(descendants(svg).every(element => !element.attributes.textLength), "Glyphs must not be stretched or compressed");
  }
});

test("plot frames reserve separate legend space and keep both axes within the body", () => {
  const { plotFrameForDomains } = renderer();
  for (const { widget, runtime } of plotFixtures()) {
    const frame = plotFrameForDomains([0, runtime.xMax], [0, runtime.yMax], widget, runtime.pens);
    assert.ok(frame.left >= 0 && frame.left < frame.right, widget.label);
    assert.ok(frame.right < frame.width - frame.legendWidth, widget.label);
    assert.ok(frame.top >= 0 && frame.top < frame.bottom, widget.label);
    assert.ok(frame.xTickY < frame.height, widget.label);
    assert.ok(frame.xLabelY < frame.height, widget.label);
  }
});

test("small acceleration values retain meaningful decimals and neighboring ticks stay distinct", () => {
  const { formatTick, axisTicks } = renderer();
  assert.deepEqual(axisTicks([0, 0.0046]).map(value => formatTick(value, [0, 0.0046])), ["0", "0.0023", "0.0046"]);
  assert.equal(formatTick(10000, [0, 20000]), "10,000");
  assert.equal(formatTick(-0, [-1, 1]), "0");
  for (const domain of [[0, 0.001], [-0.0046, 0.0046], [10.001, 10.009],
    [1e-10, 5e-10], [1e12, 1e12 + 1], [-1e15, -1e15 + 1], [-1e308, 1e308]]) {
    const ticks = axisTicks(domain), labels = ticks.map(value => formatTick(value, domain));
    assert.equal(new Set(labels).size, ticks.length, JSON.stringify({ domain, labels }));
    assert.ok(labels.every(label => !/NaN|Infinity/.test(label)));
  }
});

test("NIL axis names stay absent and crowded plots omit intermediate ticks instead of overlapping them", () => {
  const { state, renderPlotBody, axisLabel } = renderer();
  assert.equal(axisLabel("NIL"), "");
  assert.equal(axisLabel(""), "");
  assert.equal(axisLabel("  Time  "), "Time");
  const fixture = plotFixtures()[1];
  state.plotData[fixture.widget.id] = fixture.runtime;
  const elements = descendants(renderPlotBody(fixture.widget));
  assert.equal(elements.filter(element => element.attributes.class === "plot-axis-label").length, 0);
  const small = plotFixtures()[3];
  state.plotData[small.widget.id] = small.runtime;
  const labels = descendants(renderPlotBody(small.widget)).filter(element => element.attributes.class === "plot-tick-label");
  assert.equal(labels.length, 2, "A tiny plot must not overlap even its endpoint labels");
  assert.deepEqual(labels.map(label => label.textContent), ["10,000", "1"]);
});

test("all legend entries remain available with full names and native colors, without covering series", () => {
  const { state, renderPlotBody, css } = renderer();
  const fixture = plotFixtures()[5];
  state.plotData[fixture.widget.id] = fixture.runtime;
  const body = renderPlotBody(fixture.widget), legend = body.children[1];
  assert.equal(legend.attributes.role, "list");
  assert.equal(legend.children.length, 30);
  assert.equal(legend.children[29].title, "Pen 30");
  assert.equal(legend.children[0].children[0].style.backgroundColor, "#d73229");
  assert.match(css, /\.plot-legend\s*\{[^}]*overflow: auto/);
  assert.match(css, /\.plot-legend-label\s*\{[^}]*text-overflow: ellipsis/);
  fixture.runtime.legend = false;
  assert.equal(renderPlotBody(fixture.widget).children.length, 1);
});

test("resizing a plot recomputes viewport and margins without modifying its native data", () => {
  const { state, renderPlotBody } = renderer();
  const { widget, runtime } = plotFixtures()[0];
  state.plotData[widget.id] = runtime;
  const original = JSON.stringify(runtime);
  const before = renderPlotBody(widget);
  widget.width = 600; widget.height = 260;
  const after = renderPlotBody(widget);
  const xAxis = body => descendants(body).filter(element => element.attributes.class === "plot-axis")[1];
  assert.ok(Number(xAxis(after).attributes.x2) > Number(xAxis(before).attributes.x2));
  assert.ok(Number(xAxis(after).attributes.y2) > Number(xAxis(before).attributes.y2));
  assert.equal(JSON.stringify(runtime), original);
});

test("runtime plot refresh preserves the position of a scrollable legend", () => {
  const source = fs.readFileSync(require.resolve("../out/netlogoEditor"), "utf8");
  const start = source.indexOf("function refreshPlotBody("), end = source.indexOf("function refreshMountedRuntimeWidgets(", start);
  assert.ok(start >= 0 && end > start);
  const legend = { scrollTop: 0 };
  let attached = false;
  const body = { querySelector: () => { assert.equal(attached, true); return legend; } };
  const previous = { querySelector: () => ({ scrollTop: 144 }), replaceWith: replacement => { assert.equal(replacement, body); attached = true; } };
  const refresh = new Function("renderPlotBody", source.slice(start, end) + "return refreshPlotBody;")(() => body);
  refresh({ querySelector: () => previous }, {});
  assert.equal(legend.scrollTop, 144);
});
