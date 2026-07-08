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
    const apiDir = path.join(tempDir, "org", "nlogo", "api");
    const classesDir = path.join(tempDir, "classes");
    fs.mkdirSync(packageDir, { recursive: true });
    fs.mkdirSync(apiDir, { recursive: true });
    fs.mkdirSync(classesDir, { recursive: true });

    const stubPath = path.join(packageDir, "HeadlessWorkspace.java");
    fs.writeFileSync(stubPath, [
      "package org.nlogo.headless;",
      "public class HeadlessWorkspace {",
      "  public static HeadlessWorkspace newInstance() { return new HeadlessWorkspace(); }",
      "  public void open(String modelPath) { }",
      "  public void command(String command) { }",
      "  public Object report(String reporter) { return reporter; }",
      "  public Object world() { return new Object(); }",
      "  public void dispose() { }",
      "}"
    ].join("\n"));

    fs.writeFileSync(path.join(apiDir, "Drawing3D.java"), [
      "package org.nlogo.api;",
      "public interface Drawing3D {",
      "  public java.lang.Iterable<DrawingLine3D> lines();",
      "}"
    ].join("\n"));

    fs.writeFileSync(path.join(apiDir, "DrawingLine3D.java"), [
      "package org.nlogo.api;",
      "public interface DrawingLine3D {",
      "  public double x0();",
      "  public double y0();",
      "  public double z0();",
      "  public double x1();",
      "  public double y1();",
      "  public double z1();",
      "  public double width();",
      "  public double heading();",
      "  public double pitch();",
      "  public double length();",
      "  public java.lang.Object color();",
      "}"
    ].join("\n"));

    fs.writeFileSync(path.join(apiDir, "Color.java"), [
      "package org.nlogo.api;",
      "public final class Color {",
      "  public static java.awt.Color getColor(java.lang.Object color) { return java.awt.Color.BLACK; }",
      "}"
    ].join("\n"));

    const bridgePath = path.resolve(__dirname, "..", "resources", "java", "NetLogoCommandBridge.java");
    const result = spawnSync("javac", ["-d", classesDir, stubPath, path.join(apiDir, "Drawing3D.java"), path.join(apiDir, "DrawingLine3D.java"), path.join(apiDir, "Color.java"), bridgePath], {
      encoding: "utf8"
    });

    assert.equal(result.status, 0, result.stderr || result.stdout);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
