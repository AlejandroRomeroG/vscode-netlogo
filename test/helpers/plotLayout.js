const Module = require("node:module");

function plotLayoutSource() {
  const originalLoad = Module._load;
  let Provider;
  try {
    Module._load = function (request, parent, isMain) {
      return request === "vscode"
        ? { Uri: { joinPath: (_base, ...parts) => ({ toString: () => parts.join("/") }) } }
        : originalLoad.call(this, request, parent, isMain);
    };
    Provider = require("../../out/netlogoEditor").NetLogoModelEditorProvider;
  } finally {
    Module._load = originalLoad;
  }
  const html = new Provider({ extensionUri: {} }, {}, {}).getHtml({ cspSource: "test", asWebviewUri: value => value });
  const script = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].at(-1)[1];
  const fragment = (from, to) => {
    const start = script.indexOf(from), end = script.indexOf(to, start);
    if (start < 0 || end <= start) throw new Error(`Missing generated function: ${from}`);
    return script.slice(start, end);
  };
  return {
    html,
    css: html.match(/<style>([\s\S]*?)<\/style>/)[1],
    source: [
      fragment("function netLogoColorHex(", "function threeColorHex("),
      fragment("function rgbToHex(", "function renderPlotBody("),
      fragment("function renderPlotBody(", "function renderRuntimeSlider(")
    ].join("\n")
  };
}

function plotFixtures() {
  const plot = (id, width, height, names, yMax, axis = true) => ({
    widget: { id, kind: "plot", label: id, width, height, details: {
      xAxis: axis ? "Time" : "NIL", yAxis: axis ? "Speed" : "NIL", legend: true
    } },
    runtime: { xMin: 0, xMax: 10000, yMin: 0, yMax, legend: true,
      pens: names.map((name, pen) => ({ name, mode: 0, color: [15, 105, 55, 5, 115][pen % 5],
        points: Array.from({ length: 101 }, (_, index) => ({
          x: index * 100, y: yMax * (0.15 + pen % 4 * 0.15 + 0.1 * Math.sin(index / 7))
        }))
      })) }
  });
  return [
    plot("Car speeds", 415, 200, ["red car", "min speed", "max speed", "avg speed"], 1.1),
    plot("Acceleration", 330, 200, ["maximum", "upper quartile", "median", "lower quartile", "minimum"], 0.0046, false),
    plot("Small", 230, 130, ["sheep", "grass", "wolves"], 600),
    plot("Minimum size", 120, 80, ["one", "two"], 1),
    plot("Wide", 800, 120, ["a long legend entry which must never distort glyphs"], 0.0000004),
    plot("Many pens", 240, 300, Array.from({ length: 30 }, (_, index) => `Pen ${index + 1}`), 100),
    plot("Tall", 180, 400, ["one", "two", "three"], 1e12)
  ];
}

module.exports = { plotLayoutSource, plotFixtures };
