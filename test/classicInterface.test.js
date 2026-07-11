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

const rabbitsPlotLines = [
  "PLOT",
  "4",
  "228",
  "275",
  "424",
  "Populations",
  "Time",
  "Pop",
  "0.0",
  "100.0",
  "0.0",
  "111.0",
  "true",
  "true",
  "\"set-plot-y-range 0 number\" \"\"",
  "PENS",
  "\"grass\" 1.0 0 -10899396 true \"\" \"plot count patches with [pcolor = green] / 4\"",
  "\"rabbits\" 1.0 0 -2674135 true \"\" \"plot count rabbits\"",
  "\"weeds\" 1.0 0 -8630108 true \"\" \"plot count patches with [pcolor = violet] / 4\""
];

const rabbitsMonitorLines = [
  "MONITOR",
  "186",
  "424",
  "275",
  "469",
  "count rabbits",
  "count rabbits",
  "1",
  "1",
  "11"
];

const netLogo7PlotXml = [
  "<widgets>",
  "  <monitor x=\"186\" y=\"424\" width=\"89\" height=\"45\" precision=\"1\" fontSize=\"11\" display=\"count rabbits\" source=\"count rabbits\" />",
  "  <plot x=\"4\" y=\"228\" width=\"271\" height=\"196\" display=\"Populations\" xAxis=\"Time\" yAxis=\"Pop\" xMin=\"0.0\" xMax=\"100.0\" yMin=\"0.0\" yMax=\"111.0\" autoPlotX=\"true\" autoPlotY=\"true\" legend=\"true\">",
  "    <setupCode><![CDATA[set-plot-y-range 0 (number + 10)]]></setupCode>",
  "    <updateCode>set-current-plot &quot;Populations&quot;</updateCode>",
  "    <pen display=\"grass\" interval=\"1.0\" mode=\"0\" color=\"-10899396\" legend=\"true\">",
  "      <setupCode></setupCode>",
  "      <updateCode>plot count patches with [pcolor = green] / 4</updateCode>",
  "    </pen>",
  "    <pen display=\"rabbits\" interval=\"1.0\" mode=\"0\" color=\"-2674135\" legend=\"true\">",
  "      <setupCode>set-plot-pen-interval 1</setupCode>",
  "      <updateCode><![CDATA[plot count turtles with [xcor < 0]]]></updateCode>",
  "    </pen>",
  "  </plot>",
  "  <button x=\"80\" y=\"69\" width=\"85\" height=\"45\" forever=\"false\">setup</button>",
  "</widgets>"
].join("\n");

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
  assert.equal(widgets[6].details.setupCode, "");
  assert.equal(widgets[6].details.updateCode, "");
  assert.deepEqual(widgets[6].details.pens, [{
    name: "turtles",
    interval: 1,
    mode: 0,
    color: -16777216,
    inLegend: true,
    setupCode: "",
    updateCode: ""
  }]);
});

test("parses all classic plot and pen fields from Rabbits Grass Weeds", () => {
  const [plot] = parseClassicWidgets(rabbitsPlotLines.join("\n"));

  assert.equal(plot.label, "Populations");
  assert.deepEqual(plot.details, {
    xAxis: "Time",
    yAxis: "Pop",
    xMin: 0,
    xMax: 100,
    yMin: 0,
    yMax: 111,
    autoplot: true,
    legend: true,
    setupCode: "set-plot-y-range 0 number",
    updateCode: "",
    pens: [
      {
        name: "grass",
        interval: 1,
        mode: 0,
        color: -10899396,
        inLegend: true,
        setupCode: "",
        updateCode: "plot count patches with [pcolor = green] / 4"
      },
      {
        name: "rabbits",
        interval: 1,
        mode: 0,
        color: -2674135,
        inLegend: true,
        setupCode: "",
        updateCode: "plot count rabbits"
      },
      {
        name: "weeds",
        interval: 1,
        mode: 0,
        color: -8630108,
        inLegend: true,
        setupCode: "",
        updateCode: "plot count patches with [pcolor = violet] / 4"
      }
    ]
  });
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
  assert.equal(view.details.frameRate, 30);
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
  assert.equal(view.details.frameRate, 30);
});

test("moves external 3D views to the right of controls in the preview", () => {
  const source = [
    "GRAPHICS-WINDOW",
    "0",
    "0",
    "245",
    "248",
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
    "-15",
    "15",
    "-15",
    "15",
    "-15",
    "15",
    "1",
    "1",
    "1",
    "ticks",
    "30.0",
    "",
    "BUTTON",
    "70",
    "41",
    "148",
    "74",
    "NIL",
    "setup",
    "NIL",
    "1",
    "T",
    "OBSERVER",
    "NIL",
    "NIL",
    "NIL",
    "NIL",
    "1",
    "",
    "SLIDER",
    "152",
    "181",
    "292",
    "214",
    "driver-y",
    "driver-y",
    "-11",
    "11",
    "0.0",
    "1",
    "1",
    "NIL",
    "HORIZONTAL"
  ].join("\n");

  const [rawView] = parseClassicWidgets(source);
  assert.equal(rawView.x, 0);
  assert.equal(rawView.y, 0);

  const preview = parseInterfacePreview(source, "classic");
  const [view] = preview.widgets;
  assert.equal(view.kind, "view");
  assert.equal(view.x, 316);
  assert.equal(view.y, 0);
  assert.equal(preview.bounds.width, 820);
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

test("keeps NetLogo 7 view3d, note, and bounded extension widgets in the preview", () => {
  const source = [
    "<widgets>",
    "  <view3d x=\"300\" y=\"10\" width=\"420\" height=\"420\" />",
    "  <note x=\"10\" y=\"10\" width=\"240\" height=\"50\" fontSize=\"14\">Rabbits &amp; grass</note>",
    "  <extension-widget x=\"10\" y=\"80\" width=\"200\" height=\"40\" display=\"Custom\" />",
    "</widgets>"
  ].join("\n");
  const preview = parseInterfacePreview(source, "xml");

  assert.equal(preview.widgets.length, 3);
  assert.equal(preview.widgets[0].kind, "view");
  assert.equal(preview.widgets[1].kind, "textbox");
  assert.equal(preview.widgets[1].label, "Rabbits & grass");
  assert.equal(preview.widgets[1].details.text, "Rabbits & grass");
  assert.equal(preview.widgets[1].details.fontSize, 14);
  assert.equal(preview.widgets[2].kind, "generic");
  assert.equal(preview.widgets[2].label, "Custom");
});

test("parses NetLogo 7 monitor and complete plot children without treating them as widgets", () => {
  const preview = parseInterfacePreview(netLogo7PlotXml, "xml");

  assert.equal(preview.widgets.length, 3);
  const [monitor, plot, button] = preview.widgets;
  assert.equal(monitor.kind, "monitor");
  assert.equal(monitor.label, "count rabbits");
  assert.equal(monitor.details.source, "count rabbits");
  assert.equal(monitor.details.precision, 1);
  assert.equal(monitor.details.fontSize, 11);
  assert.equal(plot.kind, "plot");
  assert.equal(plot.label, "Populations");
  assert.equal(plot.details.xAxis, "Time");
  assert.equal(plot.details.yAxis, "Pop");
  assert.equal(plot.details.xMin, 0);
  assert.equal(plot.details.xMax, 100);
  assert.equal(plot.details.yMin, 0);
  assert.equal(plot.details.yMax, 111);
  assert.equal(plot.details.autoplot, true);
  assert.equal(plot.details.legend, true);
  assert.equal(plot.details.setupCode, "set-plot-y-range 0 (number + 10)");
  assert.equal(plot.details.updateCode, "set-current-plot \"Populations\"");
  assert.deepEqual(plot.details.pens, [
    {
      name: "grass",
      interval: 1,
      mode: 0,
      color: -10899396,
      inLegend: true,
      setupCode: "",
      updateCode: "plot count patches with [pcolor = green] / 4"
    },
    {
      name: "rabbits",
      interval: 1,
      mode: 0,
      color: -2674135,
      inLegend: true,
      setupCode: "set-plot-pen-interval 1",
      updateCode: "plot count turtles with [xcor < 0]"
    }
  ]);
  assert.equal(button.kind, "button");
  assert.equal(button.runCommand, "setup");
});

test("uses a NetLogo 7 monitor source as its title when display is absent", () => {
  const source = "<monitor x=\"1\" y=\"2\" width=\"90\" height=\"45\" reporter=\"count turtles\" precision=\"0\" fontSize=\"12\" />";
  const [monitor] = parseInterfacePreview(source, "xml").widgets;

  assert.equal(monitor.label, "count turtles");
  assert.equal(monitor.details.source, "count turtles");

  const updated = updateInterfaceWidgetProperties(source, "xml", "xml-0", { source: "count links" });
  assert.match(updated, /reporter="count links"/);
  assert.doesNotMatch(updated, /\ssource=/);
  assert.equal(parseInterfacePreview(updated, "xml").widgets[0].details.source, "count links");
});

test("parses and updates official NetLogo 7 setup update aliases and monitor element source", () => {
  const source = [
    "<widgets>",
    "  <monitor x=\"186\" y=\"424\" width=\"89\" height=\"45\" precision=\"1\" fontSize=\"11\" display=\"count rabbits\">count rabbits</monitor>",
    "  <plot x=\"4\" y=\"228\" width=\"271\" height=\"196\" display=\"Populations\" xAxis=\"Time\" yAxis=\"Pop\" xMin=\"0.0\" xMax=\"100.0\" yMin=\"0.0\" yMax=\"111.0\" autoPlotX=\"true\" autoPlotY=\"true\" legend=\"true\">",
    "    <setup>set-plot-y-range 0 number</setup>",
    "    <update></update>",
    "    <pen display=\"rabbits\" interval=\"1.0\" mode=\"0\" color=\"-2674135\" legend=\"true\"><setup></setup><update>plot count rabbits</update></pen>",
    "  </plot>",
    "</widgets>"
  ].join("\n");
  const [monitor, plot] = parseInterfacePreview(source, "xml").widgets;

  assert.equal(monitor.details.source, "count rabbits");
  assert.equal(plot.details.setupCode, "set-plot-y-range 0 number");
  assert.equal(plot.details.updateCode, "");
  assert.equal(plot.details.pens[0].updateCode, "plot count rabbits");

  const updatedMonitor = updateInterfaceWidgetProperties(source, "xml", "xml-0", { source: "count rabbits + 1" });
  assert.match(updatedMonitor, />count rabbits \+ 1<\/monitor>/);
  const updatedPlot = updateInterfaceWidgetProperties(updatedMonitor, "xml", "xml-1", {
    setupCode: "set-plot-y-range 0 (number + 1)",
    updateCode: "set-current-plot \"Populations\""
  });
  assert.match(updatedPlot, /<setup>set-plot-y-range 0 \(number \+ 1\)<\/setup>/);
  assert.match(updatedPlot, /<update>set-current-plot "Populations"<\/update>/);
  assert.doesNotMatch(updatedPlot, /<setupCode>|<updateCode>/);
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

test("round-trips the classic Rabbits plot without rewriting its pen block", () => {
  const source = [...rabbitsPlotLines, "", ...rabbitsMonitorLines].join("\n");
  const [plot] = parseClassicWidgets(source);
  const updated = updateInterfaceWidgetProperties(source, "classic", plot.id, {
    autoplot: plot.details.autoplot,
    legend: plot.details.legend,
    setupCode: plot.details.setupCode,
    updateCode: plot.details.updateCode,
    pens: plot.details.pens
  });

  assert.equal(updated, source);
});

test("round-trips classic plot pens whose names are empty or whitespace-sensitive", () => {
  const source = [
    ...rabbitsPlotLines.slice(0, -3),
    '"" 1.0 0 -16777216 true "" "plot 1"',
    '" a" 1.0 0 -10899396 true "" "plot 2"',
    '"a " 1.0 0 -2674135 true "" "plot 3"'
  ].join("\n");
  const [plot] = parseClassicWidgets(source);

  assert.deepEqual(plot.details.pens.map(pen => pen.name), ["", " a", "a "]);
  const updated = updateInterfaceWidgetProperties(source, "classic", plot.id, {
    pens: plot.details.pens
  });
  assert.equal(updated, source);
});

test("atomically updates classic plot commands and pens while preserving the following widget", () => {
  const source = [...rabbitsPlotLines, "", ...rabbitsMonitorLines].join("\n");
  const pens = [
    {
      name: "rabbits \"total\"",
      interval: 0.5,
      mode: 2,
      color: -2674135,
      inLegend: true,
      setupCode: "set-plot-pen-color red",
      updateCode: "set-current-plot-pen \"rabbits\"\nplot count rabbits"
    },
    {
      name: "weeds",
      interval: 2,
      mode: 1,
      color: -8630108,
      inLegend: false,
      setupCode: "",
      updateCode: "plot count patches with [pcolor = violet] / 4"
    }
  ];

  const updated = updateInterfaceWidgetProperties(source, "classic", "classic-0", {
    label: "Populations 2",
    autoplot: false,
    legend: false,
    setupCode: "set-plot-y-range 0 (number + 10)",
    updateCode: "set-current-plot-pen \"rabbits\"",
    pens
  });
  const [plot, monitor] = parseClassicWidgets(updated);

  assert.equal(plot.label, "Populations 2");
  assert.equal(plot.details.autoplot, false);
  assert.equal(plot.details.legend, false);
  assert.equal(plot.details.setupCode, "set-plot-y-range 0 (number + 10)");
  assert.equal(plot.details.updateCode, "set-current-plot-pen \"rabbits\"");
  assert.deepEqual(plot.details.pens, pens);
  assert.deepEqual(monitor.raw, rabbitsMonitorLines);
  assert.equal(monitor.label, "count rabbits");
  assert.doesNotMatch(updated, /^"grass"/m);
  assert.match(updated, /^"rabbits \\"total\\"" 0\.5 2 -2674135 true /m);
  assert.match(updated, /"set-current-plot-pen \\"rabbits\\"\\nplot count rabbits"/);
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

test("updates NetLogo 7 monitor fields and preserves the neighboring plot exactly", () => {
  const originalPlot = netLogo7PlotXml.slice(
    netLogo7PlotXml.indexOf("  <plot"),
    netLogo7PlotXml.indexOf("  <button")
  );
  const updated = updateInterfaceWidgetProperties(netLogo7PlotXml, "xml", "xml-0", {
    label: "Rabbit population",
    source: "count rabbits with [energy > 0]",
    precision: 0,
    fontSize: 13
  });
  const [monitor] = parseInterfacePreview(updated, "xml").widgets;

  assert.equal(monitor.label, "Rabbit population");
  assert.equal(monitor.details.source, "count rabbits with [energy > 0]");
  assert.equal(monitor.details.precision, 0);
  assert.equal(monitor.details.fontSize, 13);
  assert.ok(updated.includes(originalPlot));
});

test("updates all editable NetLogo 7 plot fields and pens while preserving sibling widgets", () => {
  const originalMonitor = netLogo7PlotXml.match(/^  <monitor.*$/m)[0];
  const originalButton = netLogo7PlotXml.match(/^  <button.*$/m)[0];
  const pens = [
    {
      name: "rabbits & hares",
      interval: 0.5,
      mode: 2,
      color: -2674135,
      inLegend: true,
      setupCode: "set-plot-pen-color red",
      updateCode: "plot count rabbits with [energy < 5]"
    },
    {
      name: "weeds",
      interval: 2,
      mode: 1,
      color: -8630108,
      inLegend: false,
      setupCode: "",
      updateCode: "plot count patches with [pcolor = violet] / 4"
    }
  ];

  const updated = updateInterfaceWidgetProperties(netLogo7PlotXml, "xml", "xml-1", {
    label: "Population & food",
    xAxis: "Steps",
    yAxis: "Agents",
    xMin: -10,
    xMax: 250,
    yMin: -5,
    yMax: 500,
    autoplot: false,
    legend: false,
    setupCode: "set-plot-y-range 0 (number + 25)",
    updateCode: "set-current-plot \"Population & food\"",
    pens
  });
  const [, plot] = parseInterfacePreview(updated, "xml").widgets;

  assert.equal(plot.label, "Population & food");
  assert.equal(plot.details.xAxis, "Steps");
  assert.equal(plot.details.yAxis, "Agents");
  assert.equal(plot.details.xMin, -10);
  assert.equal(plot.details.xMax, 250);
  assert.equal(plot.details.yMin, -5);
  assert.equal(plot.details.yMax, 500);
  assert.equal(plot.details.autoplot, false);
  assert.equal(plot.details.legend, false);
  assert.equal(plot.details.setupCode, "set-plot-y-range 0 (number + 25)");
  assert.equal(plot.details.updateCode, "set-current-plot \"Population & food\"");
  assert.deepEqual(plot.details.pens, pens);
  assert.match(updated, /autoPlotX="false"/);
  assert.match(updated, /autoPlotY="false"/);
  assert.match(updated, /display="Population &amp; food"/);
  assert.match(updated, /<setupCode><!\[CDATA\[set-plot-y-range 0 \(number \+ 25\)\]\]><\/setupCode>/);
  assert.match(updated, /<updateCode>set-current-plot "Population &amp; food"<\/updateCode>/);
  assert.match(updated, /<pen display="rabbits &amp; hares"/);
  assert.ok(updated.includes(originalMonitor));
  assert.ok(updated.includes(originalButton));
});

test("does not rewrite NetLogo 7 plot CDATA, entities, or pens for attribute-only edits", () => {
  const originalInner = netLogo7PlotXml.match(/(<plot\b[^>]*>)([\s\S]*?)(<\/plot>)/)[2];
  const updated = updateInterfaceWidgetProperties(netLogo7PlotXml, "xml", "xml-1", { xAxis: "Model time" });
  const updatedInner = updated.match(/(<plot\b[^>]*>)([\s\S]*?)(<\/plot>)/)[2];

  assert.equal(updatedInner, originalInner);
  assert.match(updatedInner, /<!\[CDATA\[set-plot-y-range/);
  assert.match(updatedInner, /&quot;Populations&quot;/);
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

test("creates NetLogo 7 monitor and plot widgets with official element structure", () => {
  let source = createInterfaceWidget("<model>\n<widgets>\n</widgets>\n<code>to go\nend</code>\n</model>", "xml", "monitor", {
    x: 10,
    y: 20,
    width: 90,
    height: 45
  });
  source = createInterfaceWidget(source, "xml", "plot", {
    x: 10,
    y: 70,
    width: 270,
    height: 190
  });

  assert.match(source, /<monitor\b[^>]*fontSize="11"[^>]*>ticks<\/monitor>/);
  assert.match(source, /<plot\b[^>]*display="Plot"[^>]*autoPlotX="true"[^>]*autoPlotY="true"[^>]*legend="true"[^>]*><setup><\/setup><update><\/update><\/plot>/);
  assert.match(source, /<\/widgets>\n<code>to go\nend<\/code>/);
  const [monitor, plot] = parseInterfacePreview(source, "xml").widgets;
  assert.equal(monitor.details.source, "ticks");
  assert.equal(plot.details.setupCode, "");
  assert.equal(plot.details.updateCode, "");
  assert.deepEqual(plot.details.pens, []);
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
