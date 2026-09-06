const assert = require("node:assert/strict");
const test = require("node:test");
const vm = require("node:vm");
const { parseHTML } = require("linkedom");
const { createChooserCodec } = require("../out/chooserValues");
const { parseInterfacePreview, updateInterfaceWidgetProperties, createInterfaceWidget, getWidgetRuntimeCommands } = require("../out/classicInterface");
const { plotLayoutSource } = require("./helpers/plotLayout");
const codec = createChooserCodec();
const classic = (source, selected = 0) => ["CHOOSER", "10", "165", "165", "210", "rules", "rules", source, String(selected)].join("\n");
const widget = source => parseInterfacePreview(source, "classic").widgets[0];
const values = ["normal", "moving-only", "pricing-only", "slow mode", "1", 1, "true", true, false, "", " padded ", 'say "hi"', "C:\\models\\file", "line\nnext\r\ttab", [1, "1", false, ["nested", []]]];

test("native unwrapped chooser strings preserve every option, including first and last", () => {
  const source = classic('"normal" "moving-only" "pricing-only"');
  const parsed = widget(source);
  assert.deepEqual(parsed.details.choices, ["normal", "moving-only", "pricing-only"]);
  for (let index = 0; index < 3; index++) {
    const selected = widget(updateInterfaceWidgetProperties(source, "classic", parsed.id, { selectedIndex: index }));
    assert.equal(selected.raw[7], parsed.raw[7]);
    assert.deepEqual(getWidgetRuntimeCommands([selected]), [`set rules ${codec.serialize(parsed.details.choices[index])}`]);
  }
});

test("chooser literals keep strings, numbers, booleans, empty values, escapes and nested lists distinct", () => {
  assert.deepEqual(codec.parse(codec.format(values)), values);
  assert.deepEqual(codec.parse('1 .5 -0.25 +2e-3 true FALSE "1" "true" [1 "two"] []'),
    [1, 0.5, -0.25, 0.002, true, false, "1", "true", [1, "two"], []]);
  assert.deepEqual(codec.parse('"normal" ; comment\n"moving-only"'), ["normal", "moving-only"]);
  const parsed = widget(classic(codec.format(values)));
  for (let index = 0; index < values.length; index++) {
    const selected = { ...parsed, details: { ...parsed.details, selectedIndex: index } };
    assert.deepEqual(getWidgetRuntimeCommands([selected]), [`set rules ${codec.serialize(values[index])}`]);
  }
});

test("saving chooser options uses native literal syntax and preserves selection by value", () => {
  const neighbor = '\n\nMONITOR\n0\n0\n120\n45\nticks\nticks\n0\n1\n11';
  const source = classic('"first" "normal"', 1) + neighbor;
  const updated = updateInterfaceWidgetProperties(source, "classic", "classic-0", { choices: values });
  const parsed = widget(updated);
  assert.equal(parsed.raw[7], codec.format(values));
  assert.equal(parsed.details.selectedIndex, 0);
  assert.deepEqual(parsed.details.choices, values);
  assert.ok(updated.endsWith(neighbor));
  const moved = updateInterfaceWidgetProperties(updated, "classic", "classic-0", { choices: [1, "1", "normal"] });
  assert.equal(widget(moved).details.selectedIndex, 2);
  const removed = updateInterfaceWidgetProperties(moved, "classic", "classic-0", { choices: ["new"] });
  assert.equal(widget(removed).details.selectedIndex, 0);
});

test("no-op chooser edits preserve original whitespace and number spelling", () => {
  const source = classic('  "normal"   1.0  "1"', 2).replace(/\n/g, "\r\n");
  const parsed = widget(source);
  assert.equal(updateInterfaceWidgetProperties(source, "classic", parsed.id, { choices: parsed.details.choices }), source);
});

test("malformed chooser source stays editable and cannot synchronize invented values", () => {
  for (const invalid of ['"unterminated', '"bad\\q"', '[1 2', '1 ]', 'normal', '[mobile network environmental]', '1e999', '"safe" run "code"']) {
    assert.throws(() => codec.parse(invalid));
    const source = classic(invalid), parsed = widget(source);
    assert.equal(parsed.details.choicesSource, invalid);
    assert.ok(parsed.details.choicesError);
    assert.throws(() => getWidgetRuntimeCommands([parsed]), /Invalid choices/);
    const repaired = updateInterfaceWidgetProperties(source, "classic", parsed.id, { choices: ["normal"] });
    assert.deepEqual(widget(repaired).details.choices, ["normal"]);
  }
  for (const invalid of [[], [NaN], [Infinity], [{}]]) {
    assert.throws(() => updateInterfaceWidgetProperties(classic('"normal"'), "classic", "classic-0", { choices: invalid }));
  }
});

test("official XML choice children and current index preserve native types and entities", () => {
  const source = `<widgets><chooser x="10" y="10" width="170" height="45" variable="rules" current="2">
    <choice type="string" value="normal" />
    <choice type="double" value="1.0" />
    <choice type="string" value="1" />
    <choice type="boolean" value="true" />
    <choice type="string" value="&#x3bb;&#10;&#9;&quot;&amp;amp;" />
    <choice type="list"><![CDATA[[1 "1" [false "nested"]]]]></choice>
  </chooser><monitor x="0" y="0" width="100" height="45">ticks</monitor></widgets>`;
  const parsed = parseInterfacePreview(source, "xml").widgets[0];
  assert.deepEqual(parsed.details.choices, ["normal", 1, "1", true, 'λ\n\t"&amp;', [1, "1", [false, "nested"]]]);
  assert.equal(parsed.details.selectedIndex, 2);
  assert.deepEqual(getWidgetRuntimeCommands([parsed]), ['set rules "1"']);
  assert.equal(updateInterfaceWidgetProperties(source, "xml", parsed.id, { choices: parsed.details.choices }), source);
  const selected = updateInterfaceWidgetProperties(source, "xml", parsed.id, { selectedIndex: 1 });
  assert.equal(selected, source.replace('current="2"', 'current="1"'));
  const edited = updateInterfaceWidgetProperties(source, "xml", parsed.id, { choices: values });
  assert.deepEqual(parseInterfacePreview(edited, "xml").widgets[0].details.choices, values);
  assert.ok(edited.endsWith('<monitor x="0" y="0" width="100" height="45">ticks</monitor></widgets>'));
});

test("legacy XML choices attributes still round-trip without replacement-string corruption", () => {
  const source = `<chooser x="0" y="0" width="170" height="45" variable="rules" choices="&quot;normal&quot; 1" selectedIndex="0" />`;
  const next = ["$& $1 $'", "a\n\tb", "1", 1, true, [false, "two"]];
  const updated = updateInterfaceWidgetProperties(source, "xml", "xml-0", { choices: next });
  const parsed = parseInterfacePreview(updated, "xml").widgets[0];
  assert.deepEqual(parsed.details.choices, next);
  assert.match(updated, /selectedIndex="0"/);
  assert.doesNotMatch(updated, / current=/);
});

test("new classic and XML chooser templates contain valid typed choices", () => {
  for (const format of ["classic", "xml"]) {
    const source = createInterfaceWidget("", format, "chooser", { x: 0, y: 0, width: 170, height: 45 });
    const parsed = parseInterfacePreview(source, format).widgets[0];
    assert.deepEqual(parsed.details.choices, ["one", "two"]);
    assert.deepEqual(getWidgetRuntimeCommands([parsed]), ['set chooser "one"']);
    if (format === "xml") assert.match(source, /current="0"[\s\S]*<choice type="string"/);
    else assert.equal(parsed.raw[7], '"one" "two"');
  }
});

test("new chooser widgets are separated from the preceding widget by a blank line", () => {
  for (const ending of ["\n", "\r\n"]) for (const trailing of [0, 1, 2]) {
    const previous = classic('"normal"').replace(/\n/g, ending) + ending.repeat(trailing);
    const added = createInterfaceWidget(previous, "classic", "chooser", { x: 0, y: 0, width: 170, height: 45 });
    assert.ok(added.startsWith(previous));
    assert.ok(added.includes(`0${ending}${ending}CHOOSER`));
  }
});

test("the actual webview embeds the same chooser codec without host dependencies", () => {
  const { html } = plotLayoutSource();
  const script = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].at(-1)[1];
  const source = script.slice(script.indexOf("const chooserCodec ="), script.indexOf("const vscode ="));
  const browserCodec = vm.runInNewContext(source + "chooserCodec;");
  assert.equal(JSON.stringify(browserCodec.parse(codec.format(values))), JSON.stringify(values));
  assert.equal(browserCodec.format(values, "\n"), codec.format(values, "\n"));
});

test("the real Properties editor round-trips typed choices and refuses malformed edits", () => {
  const { html } = plotLayoutSource();
  const script = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].at(-1)[1];
  const fragment = (from, to) => script.slice(script.indexOf(from), script.indexOf(to, script.indexOf(from)));
  const { document, window } = parseHTML("<html><body></body></html>");
  const createElement = document.createElement.bind(document);
  document.createElement = tag => {
    const element = createElement(tag);
    element.setCustomValidity = message => { element.validationMessage = message; };
    element.reportValidity = () => { element.reported = true; };
    return element;
  };
  const updates = [];
  const context = vm.createContext({ document, Node: window.Node, commitWidgetProperties: (...args) => updates.push(args) });
  vm.runInContext([
    fragment("const chooserCodec =", "const vscode ="),
    fragment("function renderPropertyField(", "function commitWidgetProperties("),
    fragment("function formatPropertyValue(", "function nextWidgetBounds("),
    fragment("function node(", "function setInputValue(")
  ].join("\n"), context);
  const parsed = widget(classic(codec.format(values)));
  const field = context.renderPropertyField(parsed, { key: "choices", label: "Choices", type: "text", multiline: true, value: values });
  const input = field.querySelector("textarea");
  assert.equal(input.value, codec.format(values, "\n"));
  input.dispatchEvent(new window.Event("change"));
  assert.equal(JSON.stringify(updates[0][2]), JSON.stringify(values));
  for (const invalid of ['"unterminated', 'normal', '', '"bad\\q"']) {
    input.value = invalid;
    input.dispatchEvent(new window.Event("change"));
    assert.equal(updates.length, 1, "Invalid input must not update the model or widget state");
    assert.ok(input.validationMessage);
    assert.equal(input.reported, true);
  }
  input.value = '"fixed"\n1\n"1"';
  input.dispatchEvent(new window.Event("change"));
  assert.equal(input.validationMessage, "");
  assert.equal(JSON.stringify(updates[1][2]), JSON.stringify(["fixed", 1, "1"]));
});
