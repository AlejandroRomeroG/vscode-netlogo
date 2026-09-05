const fs = require("node:fs");
const path = require("node:path");
const { plotLayoutSource } = require("./plotLayout");
const { parseNetLogoModel } = require("../../out/modelFormat");

function infoPreviewSource() {
  const { html, css } = plotLayoutSource();
  const script = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].at(-1)[1];
  const fragment = (from, to) => {
    const start = script.indexOf(from), end = script.indexOf(to, start);
    if (start < 0 || end < start) throw new Error("Missing Info preview fragment: " + from);
    return script.slice(start, end);
  };
  return { css, highlight: [
    fragment("const netLogoKeywords", "// NetLogo 6.4 uses these raw Swing slider bounds"),
    fragment("function appendHighlightedNetLogo(", "function syncCodeHighlightScroll("),
    fragment("function node(", "function fragment(")
  ].join("\n") };
}

function infoFixtures() {
  const home = process.env.NETLOGO_HOME || "/Applications/NetLogo 6.4.0";
  const names = [
    "IABM Textbook/chapter 6/Spread of Disease.nlogo",
    "Code Examples/Info Tab Example.nlogo",
    "Sample Models/Chemistry & Physics/Chemical Reactions/Acids and Bases/Weak Acid.nlogo",
    "Sample Models/Chemistry & Physics/Chemical Reactions/Simple Kinetics 1.nlogo",
    "Sample Models/Social Science/Prisoner's Dilemma/Prisoner's Dilemma Two Person Iterated.nlogo",
    "3D/Sample Models/Follower 3D.nlogo3d",
    "3D/Sample Models/Sierpinski Simple 3D.nlogo3d",
    "Sample Models/Biology/CRISPR/CRISPR Bacterium LevelSpace.nlogo"
  ];
  const fixtures = names.map(name => {
    const file = path.join(home, "models", name);
    if (!fs.existsSync(file)) return null;
    return { name: path.basename(name), file, source: parseNetLogoModel(fs.readFileSync(file, "utf8"), file).info };
  }).filter(Boolean);
  fixtures.push({ name: "Narrow screens and long content", source: [
    "## A long section heading that must wrap comfortably on a narrow panel without clipping its last line",
    "A long link: https://example.org/" + "documentation/".repeat(30),
    "| Quantity | Small value | Large value | Interpretation |\n|:---|---:|---:|:---|\n|α|0.0000023|123456789012345|A detailed interpretation to test wrapping|",
    "```text\n" + "Long ASCII diagram ".repeat(30) + "\n```",
    "- Outer\n  - Inner\n    - Third level\n\n> A quotation with **nested emphasis**, H<sub>2</sub>O, and x<sup>2</sup>.",
    "![A long description of a remote image which has not been loaded](https://example.org/image.png)",
    "[Back to heading](#a-long-section-heading-that-must-wrap-comfortably-on-a-narrow-panel-without-clipping-its-last-line)"
  ].join("\n\n") });
  return fixtures;
}

module.exports = { infoPreviewSource, infoFixtures };
