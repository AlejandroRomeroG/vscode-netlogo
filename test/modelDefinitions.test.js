const test = require("node:test");
const assert = require("node:assert/strict");
const { findNetLogoDefinition, findNetLogoReferences, isValidNetLogoProcedureName } = require("../out/modelDefinitions");

test("NetLogo definition finder resolves procedure calls", () => {
  const source = [
    "to setup",
    "  clear-all",
    "end",
    "",
    "to go",
    "  setup",
    "end"
  ].join("\n");

  const definition = findNetLogoDefinition(source, source.lastIndexOf("setup"));

  assert.equal(definition.name, "setup");
  assert.equal(definition.kind, "procedure");
  assert.equal(definition.signature, "to setup");
  assert.equal(source.slice(definition.sourceStart, definition.sourceEnd), "setup");
  assert.equal(source.slice(definition.targetStart, definition.targetEnd), "setup");
  assert.equal(definition.targetStart, source.indexOf("setup"));
});

test("NetLogo definition finder resolves reporter calls case-insensitively", () => {
  const source = [
    "to-report flock-size",
    "  report count turtles",
    "end",
    "",
    "to go",
    "  show FLOCK-SIZE",
    "end"
  ].join("\n");

  const definition = findNetLogoDefinition(source, source.indexOf("FLOCK-SIZE") + 2);

  assert.equal(definition.name, "flock-size");
  assert.equal(definition.kind, "reporter");
  assert.equal(definition.signature, "to-report flock-size");
  assert.equal(source.slice(definition.targetStart, definition.targetEnd), "flock-size");
});

test("NetLogo definition finder ignores comments and strings", () => {
  const source = [
    "to setup",
    "end",
    "",
    "to go",
    "  show \"setup\"",
    "  ; setup",
    "end"
  ].join("\n");

  assert.equal(findNetLogoDefinition(source, source.indexOf("\"setup\"") + 2), undefined);
  assert.equal(findNetLogoDefinition(source, source.indexOf("; setup") + 3), undefined);
});

test("NetLogo definition finder ignores unknown tokens", () => {
  const source = "to setup\n  clear-all\nend";

  assert.equal(findNetLogoDefinition(source, source.indexOf("clear-all")), undefined);
});

test("NetLogo reference finder includes declarations and calls", () => {
  const source = [
    "to setup",
    "  go",
    "end",
    "",
    "to go",
    "  setup",
    "  setup",
    "end"
  ].join("\n");

  const references = findNetLogoReferences(source, source.lastIndexOf("setup"));

  assert.deepEqual(references.map(reference => source.slice(reference.start, reference.end)), [
    "setup",
    "setup",
    "setup"
  ]);
  assert.equal(references[0].start, source.indexOf("setup"));
});

test("NetLogo reference finder can omit declarations", () => {
  const source = [
    "to-report flock-size",
    "  report count turtles",
    "end",
    "",
    "to go",
    "  show flock-size",
    "end"
  ].join("\n");

  const references = findNetLogoReferences(source, source.indexOf("flock-size", source.indexOf("show")), false);

  assert.deepEqual(references.map(reference => source.slice(reference.start, reference.end)), [
    "flock-size"
  ]);
  assert.equal(references[0].start, source.lastIndexOf("flock-size"));
});

test("NetLogo reference finder ignores comments and strings", () => {
  const source = [
    "to setup",
    "end",
    "",
    "to go",
    "  setup",
    "  show \"setup\"",
    "  ; setup",
    "end"
  ].join("\n");

  const references = findNetLogoReferences(source, source.indexOf("setup", source.indexOf("go")));

  assert.deepEqual(references.map(reference => source.slice(reference.start, reference.end)), [
    "setup",
    "setup"
  ]);
});

test("NetLogo procedure name validator accepts common names and rejects unsafe text", () => {
  assert.equal(isValidNetLogoProcedureName("go"), true);
  assert.equal(isValidNetLogoProcedureName("flock-size"), true);
  assert.equal(isValidNetLogoProcedureName("move?"), true);

  assert.equal(isValidNetLogoProcedureName(""), false);
  assert.equal(isValidNetLogoProcedureName("go now"), false);
  assert.equal(isValidNetLogoProcedureName(" go"), false);
  assert.equal(isValidNetLogoProcedureName("go]"), false);
  assert.equal(isValidNetLogoProcedureName("go;show"), false);
  assert.equal(isValidNetLogoProcedureName("\"go\""), false);
});
