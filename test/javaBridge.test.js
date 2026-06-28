const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const hasJavac = spawnSync("javac", ["-version"], { encoding: "utf8" }).status === 0;

test("Java command bridge compiles against the expected HeadlessWorkspace API", { skip: !hasJavac }, () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "netlogo-bridge-test-"));
  try {
    const packageDir = path.join(tempDir, "org", "nlogo", "headless");
    const classesDir = path.join(tempDir, "classes");
    fs.mkdirSync(packageDir, { recursive: true });
    fs.mkdirSync(classesDir, { recursive: true });

    const stubPath = path.join(packageDir, "HeadlessWorkspace.java");
    fs.writeFileSync(stubPath, [
      "package org.nlogo.headless;",
      "public class HeadlessWorkspace {",
      "  public static HeadlessWorkspace newInstance() { return new HeadlessWorkspace(); }",
      "  public void open(String modelPath) { }",
      "  public void command(String command) { }",
      "  public Object report(String reporter) { return reporter; }",
      "  public void dispose() { }",
      "}"
    ].join("\n"));

    const bridgePath = path.resolve(__dirname, "..", "resources", "java", "NetLogoCommandBridge.java");
    const result = spawnSync("javac", ["-d", classesDir, stubPath, bridgePath], {
      encoding: "utf8"
    });

    assert.equal(result.status, 0, result.stderr || result.stdout);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
