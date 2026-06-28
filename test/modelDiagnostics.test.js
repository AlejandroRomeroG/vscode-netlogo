const test = require("node:test");
const assert = require("node:assert/strict");
const { analyzeNetLogoCode } = require("../out/modelDiagnostics");

test("NetLogo code diagnostics ignore balanced delimiters and comments", () => {
  const diagnostics = analyzeNetLogoCode([
    "to setup",
    "  ask turtles [ set label \"]\" ] ; unmatched ] in comment is ignored",
    "end"
  ].join("\n"));

  assert.deepEqual(diagnostics, []);
});

test("NetLogo code diagnostics report unclosed delimiters", () => {
  const diagnostics = analyzeNetLogoCode("to setup\n  ask turtles [ set color red\nend");

  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].message, "Unclosed '['. Expected ']'.");
  assert.equal(diagnostics[0].code, "netlogo.unclosedDelimiter");
  assert.equal(diagnostics[0].start, "to setup\n  ask turtles ".length);
});

test("NetLogo code diagnostics report mismatched delimiters", () => {
  const diagnostics = analyzeNetLogoCode("to setup\n  if true [ set color red )\nend");

  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].message, "Mismatched closing ')'. Expected ']'.");
  assert.equal(diagnostics[0].code, "netlogo.mismatchedClosingDelimiter");
});

test("NetLogo code diagnostics report unterminated strings", () => {
  const diagnostics = analyzeNetLogoCode("to setup\n  show \"unterminated\nend");

  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].message, "Unterminated string literal.");
  assert.equal(diagnostics[0].code, "netlogo.unterminatedString");
  assert.equal(diagnostics[0].start, "to setup\n  show ".length);
});

test("NetLogo code diagnostics report unexpected closing delimiters", () => {
  const diagnostics = analyzeNetLogoCode("to setup\n  show count turtles]\nend");

  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].message, "Unexpected closing ']'.");
  assert.equal(diagnostics[0].code, "netlogo.unexpectedClosingDelimiter");
});

test("NetLogo code diagnostics report duplicate procedures", () => {
  const source = [
    "to setup",
    "end",
    "",
    "to SETUP",
    "end"
  ].join("\n");
  const diagnostics = analyzeNetLogoCode(source);

  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].message, "Duplicate NetLogo procedure 'SETUP'. First defined as a procedure.");
  assert.equal(source.slice(diagnostics[0].start, diagnostics[0].end), "SETUP");
});

test("NetLogo code diagnostics report procedure and reporter name conflicts", () => {
  const source = [
    "to-report flock-size",
    "  report count turtles",
    "end",
    "",
    "to flock-size",
    "end"
  ].join("\n");
  const diagnostics = analyzeNetLogoCode(source);

  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].message, "Duplicate NetLogo procedure 'flock-size'. First defined as a reporter.");
  assert.equal(source.slice(diagnostics[0].start, diagnostics[0].end), "flock-size");
});

test("NetLogo code diagnostics report missing procedure end", () => {
  const source = "to setup\n  clear-all";
  const diagnostics = analyzeNetLogoCode(source);

  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].message, "Missing 'end' for NetLogo procedure 'setup'.");
  assert.equal(diagnostics[0].code, "netlogo.missingEnd");
  assert.equal(source.slice(diagnostics[0].start, diagnostics[0].end), "setup");
});

test("NetLogo code diagnostics report missing end before next callable", () => {
  const source = [
    "to setup",
    "  clear-all",
    "",
    "to-report flock-size",
    "  report count turtles",
    "end"
  ].join("\n");
  const diagnostics = analyzeNetLogoCode(source);

  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].message, "Missing 'end' for NetLogo procedure 'setup' before the next procedure or reporter.");
  assert.equal(source.slice(diagnostics[0].start, diagnostics[0].end), "setup");
});

test("NetLogo code diagnostics report unexpected end", () => {
  const source = "end\n\nto setup\nend";
  const diagnostics = analyzeNetLogoCode(source);

  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].message, "Unexpected 'end' outside a NetLogo procedure or reporter.");
  assert.equal(diagnostics[0].code, "netlogo.unexpectedEnd");
  assert.equal(source.slice(diagnostics[0].start, diagnostics[0].end), "end");
});
