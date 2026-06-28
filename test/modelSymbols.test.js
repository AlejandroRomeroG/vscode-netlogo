const test = require("node:test");
const assert = require("node:assert/strict");
const { analyzeNetLogoCodeSymbols } = require("../out/modelSymbols");

test("NetLogo symbol parser lists declarations and procedures", () => {
  const source = [
    "globals [ ticks-seen ]",
    "turtles-own [ flockmates ]",
    "",
    "to setup",
    "  clear-all",
    "end",
    "",
    "to-report flock-size [ turtle-id ]",
    "  report count turtles",
    "end"
  ].join("\n");

  const symbols = analyzeNetLogoCodeSymbols(source);

  assert.deepEqual(symbols.map(symbol => [symbol.kind, symbol.name]), [
    ["declaration", "globals [ ticks-seen ]"],
    ["declaration", "turtles-own [ flockmates ]"],
    ["procedure", "setup"],
    ["reporter", "flock-size"]
  ]);
  assert.equal(source.slice(symbols[2].selectionStart, symbols[2].selectionEnd), "setup");
  assert.equal(source.slice(symbols[3].selectionStart, symbols[3].selectionEnd), "flock-size");
});

test("NetLogo symbol parser ignores commented procedure-looking text", () => {
  const source = [
    "; to fake",
    "to real",
    "  show \"; end\"",
    "end"
  ].join("\n");

  const symbols = analyzeNetLogoCodeSymbols(source);

  assert.deepEqual(symbols.map(symbol => symbol.name), ["real"]);
  assert.equal(symbols[0].end, source.length);
});

test("NetLogo symbol parser extends unterminated procedures to the end", () => {
  const source = "to setup\n  clear-all";
  const symbols = analyzeNetLogoCodeSymbols(source);

  assert.equal(symbols.length, 1);
  assert.equal(symbols[0].name, "setup");
  assert.equal(symbols[0].end, source.length);
});
