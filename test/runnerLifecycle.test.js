const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const runnerSource = fs.readFileSync(path.join(root, "src", "runner.ts"), "utf8");

test("runner invalidates every live session for the edited model", () => {
  assert.match(runnerSource, /public invalidate\(resource: vscode\.Uri\): void/);
  assert.match(runnerSource, /for \(const session of \[\.\.\.this\.sessions\.values\(\)\]\)/);
  assert.match(runnerSource, /session\.matchesModelPath\(modelPath\)/);
  assert.match(runnerSource, /public matchesModelPath\(candidatePath: string\): boolean/);
  assert.match(runnerSource, /path\.resolve\(candidatePath\) === path\.resolve\(this\.modelPath\)/);
});

test("view and plot exports are removed even when exporting fails", () => {
  const viewExport = runnerSource.slice(
    runnerSource.indexOf("private async tryExportView"),
    runnerSource.indexOf("private async tryReportTicks")
  );
  const plotExport = runnerSource.slice(
    runnerSource.indexOf("private async tryExportPlot"),
    runnerSource.indexOf("\n}\n\nclass NetLogoSession")
  );

  assert.match(viewExport, /finally \{\s*deleteTemporaryExport\(exportPath\);\s*\}/);
  assert.match(plotExport, /finally \{\s*deleteTemporaryExport\(exportPath\);\s*\}/);
  assert.match(runnerSource, /function deleteTemporaryExport\(exportPath: string\): void/);
  assert.match(runnerSource, /fs\.unlinkSync\(exportPath\)/);
});
