const assert = require("node:assert/strict");
const test = require("node:test");
const { sliderLayoutSource, chooserFixtures } = require("./helpers/sliderLayout");
const { parseInterfacePreview } = require("../out/classicInterface");
const codec = require("../out/chooserValues").createChooserCodec();

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
      assert.equal(option.textContent, codec.display(widget.details.choices[index] ?? ""));
      if (widget.details.choices.length) assert.equal(option.selected, index === widget.details.selectedIndex);
    }
    select.value = "1";
    select.events.change();
    assert.deepEqual(interactive.updates, [[widget, "selectedIndex", 1]]);
    assert.equal(layout.renderWidgetContent(widget).children[1].disabled, true);
  }
});

test("Spread of Disease chooser fixture preserves its title, options and 45px geometry", () => {
  // The user's model-library copy is editable; a saved selection must not change
  // this geometry regression's expected value.
  const source = ['CHOOSER', '10', '10', '180', '55', 'variant', 'variant', '"mobile" "network" "environmental"', '1'].join('\n');
  const widget = parseInterfacePreview(source, "classic").widgets[0];
  assert.equal(widget.height, 45);
  const [heading, select] = renderer("interact").renderWidgetContent(widget).children;
  assert.equal(heading.textContent, "variant");
  assert.deepEqual(select.children.map(option => option.textContent), ["mobile", "network", "environmental"]);
  assert.equal(select.children.find(option => option.selected).textContent, "network");
});
