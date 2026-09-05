const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { sliderLayoutSource, chooserFixtures } = require("./helpers/sliderLayout");
const { parseNetLogoModel } = require("../out/modelFormat");
const { parseInterfacePreview } = require("../out/classicInterface");

class Element {
  constructor(tagName) { this.tagName = tagName; this.children = []; this.style = {}; this.events = {}; }
  append(...children) { this.children.push(...children); }
  addEventListener(name, handler) { this.events[name] = handler; }
}

function renderer(mode) {
  const { source } = sliderLayoutSource();
  const document = { createElement: tag => new Element(tag), createDocumentFragment: () => new Element("fragment") };
  const updates = [];
  const renderWidgetContent = new Function("state", "document", "Node", "commitWidgetProperties", source +
    "return renderWidgetContent;")({ interfaceMode: mode }, document, Element, (...args) => updates.push(args));
  return { renderWidgetContent, updates };
}

test("chooser CSS reserves a full title and dropdown inside its minimum height", () => {
  const { css } = sliderLayoutSource();
  assert.match(css, /\.chooser-widget\s*\{[^}]*min-height: 44px;[^}]*grid-template-rows: 12px minmax\(24px, 1fr\);[^}]*gap: 2px;[^}]*padding: 2px 6px;/);
  assert.match(css, /\.chooser-widget \.control-heading\s*\{[^}]*line-height: 12px;/);
  assert.match(css, /\.runtime-select\s*\{[^}]*min-height: 24px;/);
  assert.equal(2 + 4 + 12 + 2 + 24, 44, "Borders, padding, title, gap and dropdown must all fit");
});

test("chooser minimum bounds preserve existing 45px geometry and do not rewrite imported widgets", () => {
  const state = { interfacePreview: { widgets: chooserFixtures() } };
  const before = JSON.stringify(state);
  const { boundsSource } = sliderLayoutSource();
  const { nextWidgetBounds, normalizeBounds, widgetMinimumSize } = new Function("state", boundsSource +
    "return {nextWidgetBounds, normalizeBounds, widgetMinimumSize};")(state);
  assert.equal(widgetMinimumSize("chooser").height, 44);
  assert.equal(nextWidgetBounds("chooser").height, 45);
  for (const widget of state.interfacePreview.widgets) {
    assert.deepEqual(normalizeBounds(widget, "chooser"), {
      x: widget.x, y: widget.y, width: widget.width, height: Math.max(44, widget.height)
    });
  }
  assert.equal(JSON.stringify(state), before);
});

test("chooser title, selected option, changes and Layout disabling remain intact", () => {
  for (const widget of chooserFixtures()) {
    const interactive = renderer("interact"), layout = renderer("layout");
    const [heading, select] = interactive.renderWidgetContent(widget).children;
    assert.equal(heading.className, "control-heading");
    assert.equal(heading.textContent, widget.details.variable);
    assert.equal(select.disabled, false);
    assert.equal(select.children.length, Math.max(1, widget.details.choices.length));
    for (const [index, option] of select.children.entries()) {
      assert.equal(option.textContent, widget.details.choices[index] ?? "");
      if (widget.details.choices.length) assert.equal(option.selected, index === widget.details.selectedIndex);
    }
    select.value = "1";
    select.events.change();
    assert.deepEqual(interactive.updates, [[widget, "selectedIndex", 1]]);
    assert.equal(layout.renderWidgetContent(widget).children[1].disabled, true);
  }
});

const spread = path.join(process.env.NETLOGO_HOME || "/Applications/NetLogo 6.4.0", "models/IABM Textbook/chapter 6/Spread of Disease.nlogo");
test("Spread of Disease imports variant and network into an unchanged 45px chooser", { skip: !fs.existsSync(spread) }, () => {
  const model = parseNetLogoModel(fs.readFileSync(spread, "utf8"), spread);
  const widget = parseInterfacePreview(model.interfaceSource, model.format).widgets.find(item => item.kind === "chooser");
  assert.equal(widget.height, 45);
  const [heading, select] = renderer("interact").renderWidgetContent(widget).children;
  assert.equal(heading.textContent, "variant");
  assert.equal(select.children.find(option => option.selected).textContent, "network");
});
