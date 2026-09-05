// Real-browser SVG update/layout benchmark. Does not run or modify a NetLogo model.
// Run: node scripts/previewPlotPerformance.js [baseline-git-ref], open the URL,
// then click Run benchmark. Baseline defaults to the pre-optimization release.
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const baselineRef = process.argv[2] || "f66954a";
const baseline = execFileSync("git", ["show", `${baselineRef}:src/netlogoEditor.ts`], {
  cwd: root, encoding: "utf8", maxBuffer: 8 * 1024 * 1024
});

function plotSource(source) {
  return [
    ["function renderPlotSeries(", "\n    function renderPlotLegend"],
    ["function normalizePlotPoint(", "\n    function plotDomain"],
    ["function scaleLinear(", "\n    function formatTick"]
  ].map(([from, to]) => {
    const start = source.indexOf(from);
    const end = source.indexOf(to, start);
    if (start < 0 || end <= start) throw new Error(`Plot function not found: ${from}`);
    return source.slice(start, end);
  }).join("\n");
}

function page() {
  const updated = fs.readFileSync(path.join(root, "src/netlogoEditor.ts"), "utf8");
  const sources = JSON.stringify({ baseline: plotSource(baseline), updated: plotSource(updated) }).replace(/</g, "\\u003c");
  return `<!doctype html><html lang="en"><meta charset="utf-8">
<title>NetLogo plot SVG performance check</title>
<style>
body{font:14px system-ui,sans-serif;margin:24px;max-width:1050px;background:#f5f7fa;color:#18202a}
button{font:inherit;padding:8px 16px;cursor:pointer}#plots{display:flex;gap:20px;margin:20px 0}
.plot{background:white;border:1px solid #99a;flex:1}.plot svg{display:block;width:100%;height:260px}
pre{white-space:pre-wrap;overflow-wrap:anywhere;background:white;padding:16px;border:1px solid #ccd}
</style>
<h1>Plot SVG update/layout benchmark</h1>
<p>3 pens × 5,000 exact points. Two warm-ups and five alternating measured samples per implementation.
This measures SVG construction and forced layout, not end-to-end simulation FPS.</p>
<button id="run">Run benchmark</button><p id="status">Ready</p>
<div id="plots"><section class="plot"><h2>Baseline</h2><div id="baseline"></div></section>
<section class="plot"><h2>Updated</h2><div id="updated"></div></section></div>
<pre id="results">No measurements yet.</pre>
<script>
const sources = ${sources};
const palette = new Map([[15, "#d73229"], [55, "#59b03c"], [115, "#7c50a4"]]);
const renderers = Object.fromEntries(Object.entries(sources).map(([name, source]) => [name,
  new Function("document", "plotCssColor", source + "\\nreturn renderPlotSeries;")(document, color => palette.get(color))
]));
const size = 5000;
const frame = { left: 0, right: 160, top: 0, bottom: 100 };
const pens = [15, 55, 115].map((color, penIndex) => ({
  mode: 0, color, points: Array.from({ length: size }, (_, x) => ({
    x, y: 40 + penIndex * 20 + 15 * Math.sin(x / 117) + 4 * Math.sin(x / 13), color, penDown: true
  }))
}));
function makePlot(render, plotPens, domainMax) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 160 100");
  for (const pen of plotPens) {
    const layer = document.createElementNS("http://www.w3.org/2000/svg", "g");
    render(layer, pen, frame, [0, domainMax], [0, 100]);
    svg.append(layer);
  }
  return svg;
}
const nextFrame = () => new Promise(resolve => requestAnimationFrame(resolve));
async function measurement(name) {
  await nextFrame();
  const start = performance.now();
  const svg = makePlot(renderers[name], pens, size);
  document.getElementById(name).replaceChildren(svg);
  const box = svg.getBBox();
  const clientBox = svg.getBoundingClientRect();
  const updateLayoutMs = performance.now() - start;
  // Two frame callbacks provide an intervening rendering opportunity. This
  // interval includes frame scheduling and is not a GPU-only paint duration.
  await nextFrame();
  await nextFrame();
  return { updateLayoutMs, throughFrameOpportunityMs: performance.now() - start,
    width: box.width, layoutWidth: clientBox.width, paths: svg.querySelectorAll("path").length };
}
async function digest(text) {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
  return Array.from(bytes, value => value.toString(16).padStart(2, "0")).join("");
}
const median = values => [...values].sort((a,b) => a-b)[Math.floor(values.length / 2)];
document.querySelector("#run").onclick = async () => {
  const button = document.querySelector("#run");
  button.disabled = true;
  const samples = { baseline: [], updated: [] };
  try {
    for (let round = 0; round < 7; round++) {
      const order = round % 2 ? ["updated", "baseline"] : ["baseline", "updated"];
      for (const name of order) {
        document.querySelector("#status").textContent = (round < 2 ? "Warm-up " : "Measurement ") + (round + 1) + "/7: " + name;
        const sample = await measurement(name);
        if (round >= 2) samples[name].push(sample);
      }
    }
    const hashes = {};
    for (const name of Object.keys(renderers)) hashes[name] = await digest(document.querySelector("#" + name + " svg").outerHTML);
    const mixedPens = [0,1,2].map(mode => ({ mode, color: 15, interval: 1, points: Array.from({length:100}, (_,x) => ({
      x, y: x % 73, color: [15,55,115][Math.floor(x / 9) % 3], penDown: x % 13 !== 0
    })) }));
    const mixedHashes = {};
    for (const name of Object.keys(renderers)) mixedHashes[name] = await digest(makePlot(renderers[name], mixedPens, 100).outerHTML);
    const summary = Object.fromEntries(Object.entries(samples).map(([name, rows]) => [name, {
      samples: rows.length, medianUpdateLayoutMs: median(rows.map(row => row.updateLayoutMs)),
      medianThroughFrameOpportunityMs: median(rows.map(row => row.throughFrameOpportunityMs)), rows
    }]));
    const report = { pointsPerPen: size, pens: pens.length, warmupsPerImplementation: 2,
      identicalFinalSvg: hashes.baseline === hashes.updated, hashes,
      identicalMixedModesColorsAndGaps: mixedHashes.baseline === mixedHashes.updated, mixedHashes,
      summary, note: "Component benchmark only. Frame-opportunity timing includes scheduling, not GPU-only paint." };
    document.querySelector("#results").textContent = JSON.stringify(report, null, 2);
    document.querySelector("#status").textContent = "Complete";
  } catch (error) {
    document.querySelector("#results").textContent = error.stack || String(error);
    document.querySelector("#status").textContent = "Failed";
  } finally { button.disabled = false; }
};
</script></html>`;
}

const server = http.createServer((_request, response) => {
  response.setHeader("Content-Type", "text/html; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.end(page());
});
server.listen(0, "127.0.0.1", () => {
  console.log(`Plot performance check: http://127.0.0.1:${server.address().port}`);
  console.log(`Baseline: ${baselineRef}; current source: src/netlogoEditor.ts; server PID: ${process.pid}`);
});
