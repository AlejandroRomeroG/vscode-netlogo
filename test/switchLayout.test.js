const assert = require("node:assert/strict");
const test = require("node:test");
const { sliderLayoutSource, switchFixtures } = require("./helpers/sliderLayout");

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

test("switches render one associated label and checkbox rather than two stacked names", () => {
  const { renderWidgetContent } = renderer("interact");
  for (const widget of switchFixtures()) {
    const label = renderWidgetContent(widget);
    assert.equal(label.tagName, "label");
    assert.equal(label.className, "switch-row");
    assert.equal(label.children.length, 2);
    const [checkbox, text] = label.children;
    assert.equal(checkbox.type, "checkbox");
    assert.equal(checkbox.checked, widget.details.on);
    assert.equal(text.textContent, widget.details.variable);
    assert.ok(!label.children.some(element => element.className === "control-heading"));
  }
});

test("checkbox alignment preserves checked state, runtime updates and Layout disabling", () => {
  const widget = switchFixtures()[0];
  const interactive = renderer("interact"), layout = renderer("layout");
  const checkbox = interactive.renderWidgetContent(widget).children[0];
  assert.equal(checkbox.disabled, false);
  checkbox.checked = true;
  checkbox.events.change();
  assert.deepEqual(interactive.updates, [[widget, "on", true]]);
  assert.equal(layout.renderWidgetContent(widget).children[0].disabled, true);
});

test("switch CSS centers one row and removes asymmetric native checkbox margins", () => {
  const { css } = sliderLayoutSource();
  assert.match(css, /\.switch-widget\s*\{[^}]*grid-template-rows: minmax\(0, 1fr\);[^}]*gap: 0;[^}]*padding: 3px 7px;/);
  assert.match(css, /\.slider-row,\s*\.switch-row,\s*\.chooser-row\s*\{[^}]*align-items: center;/);
  assert.match(css, /\.runtime-checkbox\s*\{[^}]*width: 13px;[^}]*height: 13px;[^}]*margin: 0;/);
  assert.match(css, /\.switch-widget \.control-value\s*\{[^}]*text-align: left;[^}]*line-height: 16px;/);
});
