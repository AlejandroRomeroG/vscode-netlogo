const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createInterfaceWidget,
  deleteInterfaceWidget,
  getMonitorReporters,
  getPlotExporters,
  getWidgetRuntimeCommands,
  parseClassicWidgets,
  parseInterfacePreview,
  updateInterfaceWidgetBounds,
  updateInterfaceWidgetProperties
} = require("../out/classicInterface");

test("parses common classic NetLogo widgets with typed details", () => {
  const source = [
    "GRAPHICS-WINDOW",
    "210",
    "10",
    "650",
    "450",
    "-1",
    "-1",
    "13.0",
    "1",
    "10",
    "1",
    "1",
    "1",
    "0",
    "1",
    "1",
    "-16",
    "16",
    "-16",
    "16",
    "1",
    "1",
    "1",
    "ticks",
    "30.0",
    "",
    "BUTTON",
    "10",
    "10",
    "100",
    "44",
    "setup",
    "setup",
    "NIL",
    "1",
    "T",
    "OBSERVER",
    "NIL",
    "NIL",
    "NIL",
    "1",
    "",
    "SLIDER",
    "10",
    "54",
    "190",
    "87",
    "density",
    "density",
    "0",
    "100",
    "42",
    "1",
    "1",
    "%",
    "HORIZONTAL",
    "",
    "SWITCH",
    "10",
    "97",
    "130",
    "130",
    "wrap?",
    "wrap?",
    "0",
    "1",
    "-1000",
    "",
    "CHOOSER",
    "10",
    "140",
    "190",
    "185",
    "mode",
    "mode",
    "[\"slow mode\" fast]",
    "1",
    "",
    "MONITOR",
    "10",
    "195",
    "190",
    "240",
    "agents",
    "count turtles",
    "0",
    "1",
    "11",
    "",
    "PLOT",
    "10",
    "250",
    "240",
    "380",
    "Population",
    "time",
    "count",
    "0.0",
    "10.0",
    "0.0",
    "100.0",
    "true",
    "true",
    "\"\" \"\"",
    "PENS",
    "\"turtles\" 1.0 0 -16777216 true \"\" \"\""
  ].join("\n");

  const widgets = parseClassicWidgets(source);
  assert.equal(widgets.length, 7);
  assert.equal(widgets[0].kind, "view");
  assert.equal(widgets[0].details.minPxcor, -16);
  assert.equal(widgets[0].details.maxPxcor, 16);
  assert.equal(widgets[0].details.minPycor, -16);
  assert.equal(widgets[0].details.maxPycor, 16);
  assert.equal(widgets[1].kind, "button");
  assert.equal(widgets[1].runCommand, "setup");
  assert.equal(widgets[2].details.value, 42);
  assert.equal(widgets[2].details.units, "%");
  assert.equal(widgets[3].details.on, true);
  assert.deepEqual(widgets[4].details.choices, ["slow mode", "fast"]);
  assert.equal(widgets[6].details.pens[0], "turtles");
});

test("parses modern classic 2D view bounds", () => {
  const source = [
    "GRAPHICS-WINDOW",
    "250",
    "10",
    "755",
    "516",
    "-1",
    "-1",
    "7.0",
    "1",
    "10",
    "1",
    "1",
    "1",
    "0",
    "1",
    "1",
    "1",
    "-35",
    "35",
    "-35",
    "35",
    "1",
    "1",
    "1",
    "ticks",
    "30.0"
  ].join("\n");

  const [view] = parseClassicWidgets(source);
  assert.equal(view.kind, "view");
  assert.equal(view.details.minPxcor, -35);
  assert.equal(view.details.maxPxcor, 35);
  assert.equal(view.details.minPycor, -35);
  assert.equal(view.details.maxPycor, 35);
  assert.equal(view.details.tickCounter, "ticks");
});

test("parses 3D view bounds", () => {
  const source = [
    "GRAPHICS-WINDOW",
    "0",
    "0",
    "420",
    "441",
    "-1",
    "-1",
    "10.0",
    "1",
    "10",
    "1",
    "1",
    "1",
    "0",
    "1",
    "1",
    "1",
    "-20",
    "20",
    "-20",
    "20",
    "-12",
    "12",
    "1",
    "1",
    "1",
    "ticks",
    "30.0"
  ].join("\n");

  const [view] = parseClassicWidgets(source);
  assert.equal(view.kind, "view");
  assert.equal(view.details.minPxcor, -20);
  assert.equal(view.details.maxPxcor, 20);
  assert.equal(view.details.minPycor, -20);
  assert.equal(view.details.maxPycor, 20);
  assert.equal(view.details.minPzcor, -12);
  assert.equal(view.details.maxPzcor, 12);
});

test("parses 3D sample widget positions without reinterpreting classic bounds", () => {
  const source = [
    "GRAPHICS-WINDOW",
    "330",
    "61",
    "750",
    "502",
    "-1",
    "-1",
    "10.0",
    "1",
    "10",
    "1",
    "1",
    "1",
    "0",
    "1",
    "1",
    "1",
    "-20",
    "20",
    "-20",
    "20",
    "-12",
    "12",
    "1",
    "1",
    "1",
    "ticks",
    "30.0",
    "",
    "BUTTON",
    "66",
    "78",
    "137",
    "111",
    "setup",
    "setup",
    "NIL",
    "1",
    "T",
    "OBSERVER",
    "NIL",
    "NIL",
    "NIL",
    "1",
    "",
    "SLIDER",
    "13",
    "206",
    "269",
    "239",
    "vision",
    "vision",
    "0",
    "20",
    "10",
    "1",
    "1",
    "scaled patches",
    "HORIZONTAL"
  ].join("\n");

  const preview = parseInterfacePreview(source, "classic");
  assert.deepEqual(
    preview.widgets.map(widget => [widget.type, widget.x, widget.y, widget.width, widget.height]),
    [
      ["GRAPHICS-WINDOW", 330, 61, 420, 441],
      ["BUTTON", 66, 78, 71, 33],
      ["SLIDER", 13, 206, 256, 33]
    ]
  );
  assert.equal(preview.widgets[2].details.units, "scaled patches");
  assert.deepEqual(preview.bounds, { width: 820, height: 560 });
});

test("parses minimal xml widget preview attributes", () => {
  const source = [
    "<button left=\"10\" top=\"20\" right=\"100\" bottom=\"50\" display=\"setup\" code=\"setup\" />",
    "<slider x=\"10\" y=\"60\" width=\"180\" height=\"32\" variable=\"density\" />"
  ].join("");

  const preview = parseInterfacePreview(source, "xml");
  assert.equal(preview.widgets.length, 2);
  assert.equal(preview.widgets[0].kind, "button");
  assert.equal(preview.widgets[0].runCommand, "setup");
  assert.equal(preview.widgets[1].kind, "slider");
  assert.equal(preview.bounds.width, 820);
});

test("parses NetLogo 7 xml buttons and slider defaults", () => {
  const source = [
    "<widgets>",
    "  <slider x=\"36\" y=\"11\" width=\"250\" height=\"50\" variable=\"population\" min=\"0.0\" max=\"200.0\" default=\"125.0\" />",
    "  <button x=\"80\" y=\"69\" width=\"85\" height=\"45\" forever=\"false\">setup</button>",
    "  <button x=\"170\" y=\"69\" width=\"90\" height=\"45\" forever=\"true\">go</button>",
    "</widgets>"
  ].join("\n");

  const preview = parseInterfacePreview(source, "xml");
  assert.equal(preview.widgets.length, 3);
  assert.equal(preview.widgets[0].kind, "slider");
  assert.equal(preview.widgets[0].details.value, 125);
  assert.equal(preview.widgets[1].label, "setup");
  assert.equal(preview.widgets[1].runCommand, "setup");
  assert.equal(preview.widgets[1].details.forever, false);
  assert.equal(preview.widgets[2].label, "go");
  assert.equal(preview.widgets[2].runCommand, "go");
  assert.equal(preview.widgets[2].details.forever, true);
});

test("updates classic widget bounds while preserving widget content", () => {
  const source = [
    "BUTTON",
    "10",
    "20",
    "100",
    "50",
    "setup",
    "setup",
    "NIL",
    "",
    "SLIDER",
    "5",
    "60",
    "185",
    "93",
    "density",
    "density",
    "0",
    "100",
    "42"
  ].join("\n");

  const updated = updateInterfaceWidgetBounds(source, "classic", "classic-1", {
    x: 24.4,
    y: 80.6,
    width: 200.2,
    height: 36.1
  });

  const widgets = parseClassicWidgets(updated);
  assert.equal(widgets[0].x, 10);
  assert.equal(widgets[1].x, 24);
  assert.equal(widgets[1].y, 81);
  assert.equal(widgets[1].width, 200);
  assert.equal(widgets[1].height, 36);
  assert.match(updated, /density\n0\n100\n42$/);
});

test("updates xml widget bounds using existing coordinate style", () => {
  const source = [
    "<widgets>",
    "  <button left=\"10\" top=\"20\" right=\"100\" bottom=\"50\" display=\"setup\" code=\"setup\" />",
    "  <slider x=\"10\" y=\"60\" width=\"180\" height=\"32\" variable=\"density\" />",
    "</widgets>"
  ].join("\n");

  const updated = updateInterfaceWidgetBounds(source, "xml", "xml-0", {
    x: 30,
    y: 40,
    width: 120,
    height: 35
  });

  assert.match(updated, /left="30"/);
  assert.match(updated, /top="40"/);
  assert.match(updated, /right="150"/);
  assert.match(updated, /bottom="75"/);
  assert.match(updated, /<slider x="10" y="60" width="180" height="32"/);
});

test("updates xml widgets that use left top with width height", () => {
  const source = "<slider left=\"10\" top=\"20\" width=\"180\" height=\"32\" variable=\"density\" />";
  const updated = updateInterfaceWidgetBounds(source, "xml", "xml-0", {
    x: 45,
    y: 55,
    width: 190,
    height: 40
  });

  assert.match(updated, /left="45"/);
  assert.match(updated, /top="55"/);
  assert.match(updated, /width="190"/);
  assert.match(updated, /height="40"/);
  assert.doesNotMatch(updated, /\sx="/);
  assert.doesNotMatch(updated, /\sy="/);
});

test("updates classic button properties", () => {
  const source = [
    "BUTTON",
    "10",
    "20",
    "100",
    "50",
    "setup",
    "setup",
    "NIL",
    "1",
    "T",
    "OBSERVER"
  ].join("\n");

  const updated = updateInterfaceWidgetProperties(source, "classic", "classic-0", {
    label: "start",
    code: "setup reset-ticks",
    forever: true
  });

  const widget = parseClassicWidgets(updated)[0];
  assert.equal(widget.label, "start");
  assert.equal(widget.runCommand, "setup reset-ticks");
  assert.equal(widget.details.forever, true);
  assert.match(updated, /start\nsetup reset-ticks\nT/);
});

test("updates classic slider and switch properties", () => {
  const source = [
    "SLIDER",
    "10",
    "54",
    "190",
    "87",
    "density",
    "density",
    "0",
    "100",
    "42",
    "1",
    "1",
    "%",
    "HORIZONTAL",
    "",
    "SWITCH",
    "10",
    "97",
    "130",
    "130",
    "wrap?",
    "wrap?",
    "0"
  ].join("\n");

  const sliderUpdated = updateInterfaceWidgetProperties(source, "classic", "classic-0", {
    label: "population density",
    variable: "population-density",
    min: 5,
    max: 95,
    value: 30,
    step: 5,
    units: "agents"
  });
  const switchUpdated = updateInterfaceWidgetProperties(sliderUpdated, "classic", "classic-1", {
    label: "bounded?",
    variable: "bounded?",
    on: false
  });

  const widgets = parseClassicWidgets(switchUpdated);
  assert.equal(widgets[0].label, "population density");
  assert.equal(widgets[0].details.variable, "population-density");
  assert.equal(widgets[0].details.value, 30);
  assert.equal(widgets[0].details.units, "agents");
  assert.equal(widgets[1].label, "bounded?");
  assert.equal(widgets[1].details.variable, "bounded?");
  assert.equal(widgets[1].details.on, false);
});

test("updates xml widget properties", () => {
  const source = "<button left=\"10\" top=\"20\" right=\"100\" bottom=\"50\" display=\"setup\" code=\"setup\" />";
  const updated = updateInterfaceWidgetProperties(source, "xml", "xml-0", {
    label: "start & reset",
    code: "setup reset-ticks"
  });

  assert.match(updated, /display="start &amp; reset"/);
  assert.match(updated, /code="setup reset-ticks"/);
});

test("creates and deletes classic widgets", () => {
  const created = createInterfaceWidget("", "classic", "button", {
    x: 12,
    y: 16,
    width: 90,
    height: 34
  });

  let widgets = parseClassicWidgets(created);
  assert.equal(widgets.length, 1);
  assert.equal(widgets[0].kind, "button");
  assert.equal(widgets[0].x, 12);
  assert.equal(widgets[0].runCommand, "setup");

  const withSlider = createInterfaceWidget(created, "classic", "slider", {
    x: 20,
    y: 60,
    width: 180,
    height: 33
  });
  widgets = parseClassicWidgets(withSlider);
  assert.equal(widgets.length, 2);
  assert.equal(widgets[1].kind, "slider");
  assert.equal(widgets[1].details.value, 50);

  const deleted = deleteInterfaceWidget(withSlider, "classic", "classic-0");
  widgets = parseClassicWidgets(deleted);
  assert.equal(widgets.length, 1);
  assert.equal(widgets[0].kind, "slider");
});

test("creates and deletes xml widgets", () => {
  const source = "<button x=\"10\" y=\"20\" width=\"90\" height=\"30\" display=\"setup\" code=\"setup\" />";
  const created = createInterfaceWidget(source, "xml", "switch", {
    x: 30,
    y: 70,
    width: 120,
    height: 32
  });

  let preview = parseInterfacePreview(created, "xml");
  assert.equal(preview.widgets.length, 2);
  assert.equal(preview.widgets[1].kind, "switch");
  assert.equal(preview.widgets[1].details.variable, "switch?");

  const deleted = deleteInterfaceWidget(created, "xml", "xml-0");
  preview = parseInterfacePreview(deleted, "xml");
  assert.equal(preview.widgets.length, 1);
  assert.equal(preview.widgets[0].kind, "switch");
});

test("builds runtime set commands for interactive widgets", () => {
  const source = [
    "SLIDER",
    "10",
    "54",
    "190",
    "87",
    "density",
    "density",
    "0",
    "100",
    "42",
    "1",
    "1",
    "%",
    "HORIZONTAL",
    "",
    "SWITCH",
    "10",
    "97",
    "130",
    "130",
    "wrap?",
    "wrap?",
    "0",
    "",
    "CHOOSER",
    "10",
    "140",
    "190",
    "185",
    "mode",
    "mode",
    "[\"slow mode\" fast]",
    "1",
    "",
    "INPUTBOX",
    "10",
    "195",
    "190",
    "240",
    "agent-name",
    "alpha",
    "NIL",
    "1",
    "String"
  ].join("\n");

  const commands = getWidgetRuntimeCommands(parseClassicWidgets(source));
  assert.deepEqual(commands, [
    "set density 42",
    "set wrap? true",
    "set mode \"fast\"",
    "set agent-name \"alpha\""
  ]);
});

test("omits runtime commands for unsafe variable names", () => {
  const source = [
    "SLIDER",
    "10",
    "54",
    "190",
    "87",
    "bad variable",
    "bad variable",
    "0",
    "100",
    "42"
  ].join("\n");

  assert.deepEqual(getWidgetRuntimeCommands(parseClassicWidgets(source)), []);
});

test("builds runtime set commands from xml widgets", () => {
  const source = [
    "<slider x=\"10\" y=\"10\" width=\"180\" height=\"32\" variable=\"density\" value=\"30\" />",
    "<switch x=\"10\" y=\"50\" width=\"120\" height=\"32\" variable=\"wrap?\" on=\"false\" />",
    "<chooser x=\"10\" y=\"90\" width=\"160\" height=\"44\" variable=\"mode\" choices=\"slow fast\" selectedIndex=\"1\" />"
  ].join("");

  const preview = parseInterfacePreview(source, "xml");
  assert.deepEqual(getWidgetRuntimeCommands(preview.widgets), [
    "set density 30",
    "set wrap? false",
    "set mode \"fast\""
  ]);
});

test("extracts monitor reporters", () => {
  const source = [
    "MONITOR",
    "10",
    "195",
    "190",
    "240",
    "agents",
    "count turtles",
    "0",
    "1",
    "11",
    "",
    "MONITOR",
    "10",
    "245",
    "190",
    "290",
    "empty",
    "",
    "0"
  ].join("\n");

  assert.deepEqual(getMonitorReporters(parseClassicWidgets(source)), [
    {
      widgetId: "classic-0",
      label: "agents",
      source: "count turtles"
    }
  ]);
});

test("extracts plot exporters", () => {
  const source = [
    "PLOT",
    "10",
    "250",
    "240",
    "380",
    "Population",
    "time",
    "count",
    "0.0",
    "10.0",
    "0.0",
    "100.0",
    "true",
    "true",
    "\"\" \"\"",
    "PENS"
  ].join("\n");

  assert.deepEqual(getPlotExporters(parseClassicWidgets(source)), [
    {
      widgetId: "classic-0",
      label: "Population",
      plotName: "Population"
    }
  ]);
});
