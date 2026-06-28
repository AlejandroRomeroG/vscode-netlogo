const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { parseNetLogoModel, serializeNetLogoModel } = require("../out/modelFormat");

test("classic .nlogo parser edits first three sections and preserves the rest", () => {
  const text = [
    "to setup\n  clear-all\nend\n",
    "\nBUTTON\n10\n10\n80\n40\nsetup\n",
    "\n# Model info\n",
    "\nNetLogo 6.4.0\n",
    "\nSHAPES\n"
  ].join("@#$#@#$#@");

  const model = parseNetLogoModel(text, "sample.nlogo");
  const serialized = serializeNetLogoModel({
    ...model,
    code: `${model.code}\n\nto go\nend\n`,
    info: "# Updated"
  });

  const reparsed = parseNetLogoModel(serialized, "sample.nlogo");
  assert.match(reparsed.code, /to go/);
  assert.equal(reparsed.info, "# Updated");
  assert.deepEqual(reparsed.rest, model.rest);
});

test("nlogox parser edits cdata text and raw widget XML", () => {
  const text = [
    "<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
    "<netlogo>",
    "  <code><![CDATA[to setup\nend]]></code>",
    "  <widgets><button x=\"1\" y=\"2\" /></widgets>",
    "  <info><![CDATA[# Info]]></info>",
    "</netlogo>"
  ].join("\n");

  const model = parseNetLogoModel(text, "sample.nlogox");
  const serialized = serializeNetLogoModel({
    ...model,
    code: "to setup\n  clear-all\nend",
    interfaceSource: "<widgets><button x=\"10\" y=\"20\" /></widgets>",
    info: "# Updated <info>"
  });

  assert.match(serialized, /clear-all/);
  assert.match(serialized, /button x="10"/);
  assert.match(serialized, /<!\[CDATA\[# Updated <info>\]\]>/);
});

test("sample minimal model exposes Code Interface and Info sections", () => {
  const samplePath = path.resolve(__dirname, "..", "samples", "minimal.nlogo");
  const model = parseNetLogoModel(fs.readFileSync(samplePath, "utf8"), samplePath);

  assert.match(model.code, /to setup/);
  assert.match(model.interfaceSource, /GRAPHICS-WINDOW/);
  assert.match(model.info, /Smoke Test/);
});
