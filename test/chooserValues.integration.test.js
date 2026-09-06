const assert = require("node:assert/strict");
const fs = require("node:fs");
const { bridgeSourcePaths } = require("../out/javaBridge");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");
const { installationFromHome } = require("../out/netlogoInstallation");
const { parseNetLogoModel, serializeNetLogoModel } = require("../out/modelFormat");
const { parseInterfacePreview, createInterfaceWidget, updateInterfaceWidgetProperties, getWidgetRuntimeCommands } = require("../out/classicInterface");
const { createChooserCodec } = require("../out/chooserValues");
const codec = createChooserCodec();
const root = path.join(__dirname, "..");
const installation = installationFromHome(process.env.NETLOGO_HOME || "/Applications/NetLogo 6.4.0");
const encode = value => Buffer.from(value, "utf8").toString("base64");

test("NetLogo accepts imported, edited and reopened chooser values with their exact types", {
  skip: installation ? false : "No local NetLogo installation"
}, t => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "netlogo-chooser-integration-"));
  try {
    const compile = spawnSync("javac", ["-cp", installation.classPath.join(path.delimiter), "-d", temp,
      ...bridgeSourcePaths(path.join(root, "resources/java"))], { encoding: "utf8", timeout: 30000 });
    assert.equal(compile.status, 0, compile.error?.message || compile.stderr);
    function run(file, commands) {
      const result = spawnSync("java", [...installation.jvmArgs, "-Djava.awt.headless=true", "-cp",
        [temp, ...installation.classPath].join(path.delimiter), "NetLogoCommandBridge", file], {
        input: commands.map(([kind, value]) => `${kind} ${encode(value)}`).join("\n") + "\n",
        encoding: "utf8", timeout: 30000, maxBuffer: 4 * 1024 * 1024
      });
      assert.equal(result.status, 0, result.error?.message || result.stderr);
      assert.match(result.stdout, /__NETLOGO_READY__/);
      return [...result.stdout.matchAll(/__NETLOGO_(REPORT|ERROR)__([^\r\n]+)/g)]
        .map(match => ({ kind: match[1], value: Buffer.from(match[2], "base64").toString("utf8") }));
    }
    const values = ['normal', 'moving-only', 'pricing-only', 'slow mode', '1', 1, 'true', true, false, '', ' padded ',
      'say "hi"', 'C:\\models\\file', 'line\nnext\r\ttab', [1, '1', false, ['nested', []]]];
    const base = parseNetLogoModel(fs.readFileSync(path.join(root, "samples/minimal.nlogo"), "utf8"), "minimal.nlogo");
    let source = createInterfaceWidget(base.interfaceSource, "classic", "chooser", { x: 0, y: 0, width: 170, height: 45 });
    const chooser = parseInterfacePreview(source, "classic").widgets.find(widget => widget.kind === "chooser");
    source = updateInterfaceWidgetProperties(source, "classic", chooser.id, { choices: values });
    const file = path.join(temp, "Typed chooser.nlogo");
    fs.writeFileSync(file, serializeNetLogoModel({ ...base, interfaceSource: source }));
    const parsed = parseInterfacePreview(source, "classic").widgets.find(widget => widget.kind === "chooser");
    const commands = values.flatMap((value, index) => {
      const selected = { ...parsed, details: { ...parsed.details, selectedIndex: index } };
      const predicate = Array.isArray(value) ? "is-list?" : typeof value === "string" ? "is-string?"
        : typeof value === "boolean" ? "is-boolean?" : "is-number?";
      return [["COMMAND", getWidgetRuntimeCommands([selected])[0]], ["REPORT", `${predicate} chooser`],
        ["REPORT", `chooser = ${codec.serialize(value)}`]];
    });
    assert.deepEqual(run(file, commands), Array.from({ length: 2 * values.length }, () => ({ kind: "REPORT", value: "true" })));

    const hotelling = path.join(installation.home, "models/Sample Models/Social Science/Economics/Hotelling's Law.nlogo");
    if (fs.existsSync(hotelling)) {
      const original = fs.readFileSync(hotelling, "utf8");
      const model = parseNetLogoModel(original, hotelling);
      const widgets = parseInterfacePreview(model.interfaceSource, model.format).widgets;
      const rules = widgets.find(widget => widget.details?.variable === "rules");
      assert.deepEqual(rules.details.choices, ["normal", "moving-only", "pricing-only"]);
      const copy = path.join(temp, "Hotelling.nlogo");
      fs.writeFileSync(copy, original);
      const allChoices = widgets.filter(widget => widget.kind === "chooser").flatMap(widget => widget.details.choices.flatMap((value, selectedIndex) => [
        ["COMMAND", getWidgetRuntimeCommands([{ ...widget, details: { ...widget.details, selectedIndex } }])[0]],
        ["REPORT", `${widget.details.variable} = ${codec.serialize(value)}`]
      ]));
      allChoices.push(...getWidgetRuntimeCommands(widgets).map(command => ["COMMAND", command]),
        ["COMMAND", "random-seed 24680 setup go"], ["REPORT", "ticks = 1"]);
      assert.deepEqual(run(copy, allChoices), allChoices.filter(([kind]) => kind === "REPORT")
        .map(() => ({ kind: "REPORT", value: "true" })));
      const edited = updateInterfaceWidgetProperties(model.interfaceSource, model.format, rules.id, { choices: ["pricing-only", "moving-only", "normal", 'extra "quoted"'] });
      fs.writeFileSync(copy, serializeNetLogoModel({ ...model, interfaceSource: edited }));
      const updatedRules = parseInterfacePreview(edited, model.format).widgets.find(widget => widget.id === rules.id);
      const selected = { ...updatedRules, details: { ...updatedRules.details, selectedIndex: 3 } };
      assert.deepEqual(run(copy, [["COMMAND", getWidgetRuntimeCommands([selected])[0]], ["REPORT", `rules = ${codec.serialize('extra "quoted"')}`]]),
        [{ kind: "REPORT", value: "true" }]);
      assert.equal(fs.readFileSync(hotelling, "utf8"), original, "Native library model must remain unchanged");
    }

    const library = path.join(installation.home, "models");
    if (fs.existsSync(library)) {
      const choosers = [];
      function walk(directory) {
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
          const file = path.join(directory, entry.name);
          if (entry.isDirectory()) walk(file);
          else if (/\.nlogo(?:3d)?$/.test(entry.name)) {
            const model = parseNetLogoModel(fs.readFileSync(file, "utf8"), file);
            choosers.push(...parseInterfacePreview(model.interfaceSource, model.format).widgets
              .filter(widget => widget.kind === "chooser").map(widget => ({ file, widget })));
          }
        }
      }
      walk(library);
      const comparisons = choosers.map(({ widget }) => ["REPORT",
        `(read-from-string ${codec.serialize("[" + widget.raw[7] + "]")}) = `
        + `(read-from-string ${codec.serialize("[" + codec.format(widget.details.choices ?? []) + "]")})`]);
      const results = run(path.join(root, "samples/minimal.nlogo"), comparisons);
      assert.equal(results.length, choosers.length);
      results.forEach((result, index) => {
        const { file, widget } = choosers[index];
        assert.deepEqual(widget.details.choicesError ? result.kind : result,
          widget.details.choicesError ? "ERROR" : { kind: "REPORT", value: "true" }, `${file}: ${widget.label}`);
      });
      t.diagnostic(`${choosers.length} library choosers agree with the native parser; ${choosers.filter(({ widget }) => widget.details.choicesError).length} have already-invalid source and are reported without rewriting the library.`);
    }
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
