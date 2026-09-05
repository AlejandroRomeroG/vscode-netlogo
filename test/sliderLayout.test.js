const assert = require("node:assert/strict");
const test = require("node:test");
const { sliderLayoutSource, sliderFixtures } = require("./helpers/sliderLayout");

test("slider CSS reserves a full native thumb and digit line inside the minimum height", () => {
  const { css } = sliderLayoutSource();
  assert.match(css, /\.slider-widget\s*\{[^}]*min-height: 35px;[^}]*grid-template-rows: 12px minmax\(16px, 1fr\);[^}]*gap: 1px;[^}]*padding: 2px 6px;/);
  assert.match(css, /\.runtime-slider\s*\{[^}]*height: 16px;[^}]*margin: 0;[^}]*padding: 0;/);
  assert.match(css, /\.slider-widget \.control-heading\s*\{[^}]*line-height: 12px;/);
  assert.match(css, /\.slider-widget \.control-value\s*\{[^}]*line-height: 14px;/);
  assert.equal(2 + 4 + 12 + 1 + 16, 35, "Borders, padding and both rows must fit without clipping");
});

test("new and resized sliders share the CSS minimum without changing saved model bounds", () => {
  const state = { interfacePreview: { widgets: sliderFixtures() } };
  const before = JSON.stringify(state);
  const { boundsSource } = sliderLayoutSource();
  const { nextWidgetBounds, normalizeBounds, widgetMinimumSize } = new Function("state", boundsSource +
    "return {nextWidgetBounds, normalizeBounds, widgetMinimumSize};")(state);
  assert.equal(nextWidgetBounds("slider").height, 35);
  assert.equal(widgetMinimumSize("slider").height, 35);
  for (const widget of state.interfacePreview.widgets) {
    const bounds = normalizeBounds(widget, "slider");
    assert.equal(bounds.height, Math.max(35, widget.height));
    assert.equal(bounds.x, widget.x);
    assert.equal(bounds.y, widget.y);
    assert.equal(bounds.width, widget.width);
  }
  assert.equal(JSON.stringify(state), before, "A display-size correction must not rewrite model widgets");
});
