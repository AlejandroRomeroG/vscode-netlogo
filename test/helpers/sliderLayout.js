const { plotLayoutSource } = require("./plotLayout");

function sliderLayoutSource() {
  const { html, css } = plotLayoutSource();
  const script = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].at(-1)[1];
  const fragment = (from, to) => {
    const start = script.indexOf(from), end = script.indexOf(to, start);
    if (start < 0 || end <= start) throw new Error(`Missing generated function: ${from}`);
    return script.slice(start, end);
  };
  return {
    css,
    boundsSource: fragment("function nextWidgetBounds(", "function findWidget(") +
      fragment("function normalizeBounds(", "function renderWidgetContent("),
    source: [
      fragment("function renderWidgetContent(", "function renderViewBody("),
      fragment("function renderRuntimeSlider(", "function renderRuntimeChooser("),
      fragment("function wireRuntimeControl(", "function monitorValueElement("),
      fragment("function displayName(", "function viewWorldLabel("),
      fragment("function node(", "function setInputValue(")
    ].join("\n")
  };
}

function sliderFixtures() {
  return [
    { label: "number-of-cars", width: 260, height: 33, min: 1, max: 41, value: 20, step: 1 },
    { label: "init-acceleration", width: 260, height: 33, min: 0, max: 0.099, value: 0.0046, step: 0.0001 },
    { label: "porosity", width: 180, height: 35, min: 0, max: 100, value: 32.5, step: 0.5, units: "%" },
    { label: "minimum", width: 90, height: 22, min: -10, max: 10, value: -10, step: 1 },
    { label: "maximum", width: 90, height: 35, min: -10, max: 10, value: 10, step: 1 },
    { label: "tall slider", width: 180, height: 65, min: 0, max: 100, value: 50, step: 1 }
  ].map((fixture, index) => ({
    id: `slider-${index}`, kind: "slider", type: "SLIDER", label: fixture.label,
    x: 0, y: index * 35, width: fixture.width, height: fixture.height,
    details: { variable: fixture.label, ...fixture }
  }));
}

function switchFixtures() {
  return [
    { label: "plot-red-car?", width: 137, height: 33, on: false },
    { label: "plot-red-car?", width: 137, height: 33, on: true },
    { label: "long-switch-name?", width: 80, height: 30, on: false },
    { label: "tall switch", width: 180, height: 65, on: true }
  ].map((fixture, index) => ({
    id: `switch-${index}`, kind: "switch", type: "SWITCH", label: fixture.label,
    x: 0, y: index * 35, width: fixture.width, height: fixture.height,
    details: { variable: fixture.label, on: fixture.on }
  }));
}

module.exports = { sliderLayoutSource, sliderFixtures, switchFixtures };
