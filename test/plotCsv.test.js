const test = require("node:test");
const assert = require("node:assert/strict");
const { parsePlotCsv, parsePlotCsvLine } = require("../out/plotCsv");

const rabbitsPlotCsv = [
  '"export-plot data (NetLogo 6.4.0)"',
  '"Rabbits Grass Weeds.nlogo"',
  '"07/10/2026 16:07:50:576 -0600"',
  "",
  '"MODEL SETTINGS"',
  '"number","birth-threshold"',
  '"150","15"',
  "",
  '"""Populations"""',
  '"x min","x max","y min","y max","autoplot?","current pen","legend open?","number of pens"',
  '"0","100","0","150","true","""grass""","true","3"',
  "",
  '"pen name","pen down?","mode","interval","color","x"',
  '"""grass""","true","0","1","55","3"',
  '"""rabbits""","true","1","0.5","15","3"',
  '"""weeds""","false","2","2","115","3"',
  "",
  '"""grass""",,,,"""rabbits""",,,,"""weeds"""',
  '"x","y","color","pen down?","x","y","color","pen down?","x","y","color","pen down?"',
  '"0","6","55","true","0","150","15","true","0","0","115","true"',
  '"1","9.5","55","true","1","142","15","false","1","0","115","true"',
  '"2","13.75","55","true","2","142","15","true","2","0","115","true"',
  '"3","17.75","55","true","3","122","15","true","3","0","115","true"'
].join("\n");

test("preserves empty CSV cells that locate each exported plot pen", () => {
  assert.deepEqual(
    parsePlotCsvLine('"""grass""",,,,"""rabbits""",,,,"""weeds"""'),
    ['"grass"', "", "", "", '"rabbits"', "", "", "", '"weeds"']
  );
  assert.deepEqual(
    parsePlotCsvLine('"A ""quoted"" pen",,"55"'),
    ['A "quoted" pen', "", "55"]
  );
});

test("parses Rabbits-style runtime plot metadata and all three pen series", () => {
  const plot = parsePlotCsv(rabbitsPlotCsv);

  assert.equal(plot.name, "Populations");
  assert.deepEqual(
    {
      xMin: plot.xMin,
      xMax: plot.xMax,
      yMin: plot.yMin,
      yMax: plot.yMax,
      autoplot: plot.autoplot,
      currentPen: plot.currentPen,
      legend: plot.legend,
      numberOfPens: plot.numberOfPens
    },
    {
      xMin: 0,
      xMax: 100,
      yMin: 0,
      yMax: 150,
      autoplot: true,
      currentPen: "grass",
      legend: true,
      numberOfPens: 3
    }
  );

  assert.deepEqual(plot.pens.map(pen => pen.name), ["grass", "rabbits", "weeds"]);
  assert.deepEqual(
    plot.pens.map(({ penDown, mode, interval, color, x }) => ({ penDown, mode, interval, color, x })),
    [
      { penDown: true, mode: 0, interval: 1, color: 55, x: 3 },
      { penDown: true, mode: 1, interval: 0.5, color: 15, x: 3 },
      { penDown: false, mode: 2, interval: 2, color: 115, x: 3 }
    ]
  );

  assert.deepEqual(plot.pens[0].points, [
    { x: 0, y: 6, color: 55, penDown: true },
    { x: 1, y: 9.5, color: 55, penDown: true },
    { x: 2, y: 13.75, color: 55, penDown: true },
    { x: 3, y: 17.75, color: 55, penDown: true }
  ]);
  assert.deepEqual(plot.pens[1].points, [
    { x: 0, y: 150, color: 15, penDown: true },
    { x: 1, y: 142, color: 15, penDown: false },
    { x: 2, y: 142, color: 15, penDown: true },
    { x: 3, y: 122, color: 15, penDown: true }
  ]);
  assert.deepEqual(plot.pens[2].points, [
    { x: 0, y: 0, color: 115, penDown: true },
    { x: 1, y: 0, color: 115, penDown: true },
    { x: 2, y: 0, color: 115, penDown: true },
    { x: 3, y: 0, color: 115, penDown: true }
  ]);
});

test("keeps empty and whitespace-sensitive pen names as separate ordered series", () => {
  const names = ["", "a", " a", "a ", "named"];
  const plot = parsePlotCsv(plotFixture(
    names.map((name, index) => ({ name, color: 10 + index })),
    [names.map((_name, index) => ({ x: 0, y: index + 1, color: 10 + index, penDown: true }))]
  ));

  assert.equal(plot.numberOfPens, 5);
  assert.deepEqual(plot.pens.map(pen => pen.name), names);
  assert.deepEqual(plot.pens.map(pen => pen.points.map(point => point.y)), [[1], [2], [3], [4], [5]]);
});

test("decodes quoted pen names without confusing a literal backslash-n with a newline", () => {
  const names = ["comma,name", 'quote"name', "line\nname", "slash\\nname"];
  const plot = parsePlotCsv(plotFixture(
    names.map((name, index) => ({ name, color: 20 + index })),
    [names.map((_name, index) => ({ x: index, y: index, color: 20 + index, penDown: true }))]
  ));

  assert.deepEqual(plot.pens.map(pen => pen.name), names);
});

test("preserves unequal pen lengths, empty data groups, color changes, and pen-up rows", () => {
  const plot = parsePlotCsv(plotFixture(
    [
      { name: "empty", color: 15 },
      { name: "short", color: 55 },
      { name: "long", color: 115 }
    ],
    [
      [null, { x: 0, y: 2, color: 55, penDown: true }, { x: 0, y: 3, color: 115, penDown: false }],
      [null, null, { x: 1, y: 4, color: 125, penDown: true }]
    ]
  ));

  assert.deepEqual(plot.pens[0].points, []);
  assert.deepEqual(plot.pens[1].points, [
    { x: 0, y: 2, color: 55, penDown: true }
  ]);
  assert.deepEqual(plot.pens[2].points, [
    { x: 0, y: 3, color: 115, penDown: false },
    { x: 1, y: 4, color: 125, penDown: true }
  ]);
});

function plotFixture(pens, rows) {
  return [
    csvRow([dumpString("Test Plot")]),
    csvRow(["x min", "x max", "y min", "y max", "autoplot?", "current pen", "legend open?", "number of pens"]),
    csvRow(["0", "10", "0", "10", "true", dumpString(pens[0]?.name ?? ""), "true", String(pens.length)]),
    "",
    csvRow(["pen name", "pen down?", "mode", "interval", "color", "x"]),
    ...pens.map(pen => csvRow([dumpString(pen.name), "true", "0", "1", String(pen.color), "0"])),
    "",
    csvRow(pens.flatMap(pen => [dumpString(pen.name), "", "", ""])),
    csvRow(pens.flatMap(() => ["x", "y", "color", "pen down?"])),
    ...rows.map(points => csvRow(points.flatMap(point => point
      ? [String(point.x), String(point.y), String(point.color), String(point.penDown)]
      : ["", "", "", ""])))
  ].join("\n");
}

function dumpString(value) {
  return `"${String(value)
    .replace(/\\/g, "\\\\")
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n")
    .replace(/\t/g, "\\t")
    .replace(/"/g, '\\"')}"`;
}

function csvRow(values) {
  return values.map(value => `"${String(value).replace(/"/g, '""')}"`).join(",");
}
