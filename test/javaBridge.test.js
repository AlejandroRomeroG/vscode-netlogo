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
      "  public org.nlogo.api.PlotInterface getPlot(String name) { return null; }",
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

    const apiDeclarations = {
      Agent: "int alpha();",
      AgentSet: "int count(); java.lang.Iterable<Agent> agents();",
      Observer: "double oxcor(); double oycor(); double ozcor();",
      World3D: "int minPxcor(); int maxPxcor(); int minPycor(); int maxPycor(); int minPzcor(); int maxPzcor(); Observer observer(); AgentSet turtles(); AgentSet links(); AgentSet patches(); int[] patchColors(); Patch3D getPatch(int id);",
      Turtle3D: "long id(); double xcor(); double ycor(); double zcor(); double heading(); double pitch(); double roll(); double size(); Object color(); boolean hidden(); String shape(); String labelString(); Object labelColor(); double lineThickness();",
      Link: "Turtle3D end1(); Turtle3D end2(); Object color(); double lineThickness(); boolean isDirectedLink(); boolean hidden(); String shape(); String labelString(); Object labelColor();",
      Patch3D: "int pxcor(); int pycor(); int pzcor(); Object pcolor();",
      PlotInterface: "String name(); PlotState state(); scala.collection.Seq<PlotPenInterface> pens(); boolean legendIsOpen(); String currentPenByName();",
      PlotState: "double xMin(); double xMax(); double yMin(); double yMax(); boolean autoPlotOn();",
      PlotPenInterface: "String name(); org.nlogo.core.PlotPenState state(); scala.collection.Seq<PlotPointInterface> points();",
      PlotPointInterface: "double x(); double y(); int color(); boolean isDown();"
    };
    const apiPaths = Object.entries(apiDeclarations).map(([name, methods]) => {
      const file = path.join(apiDir, name + ".java");
      const agent = ["Turtle3D", "Link", "Patch3D"].includes(name) ? " extends Agent" : "";
      fs.writeFileSync(file, `package org.nlogo.api; public interface ${name}${agent} { ${methods} }`);
      return file;
    });
    const agentDir = path.join(tempDir, "org", "nlogo", "agent");
    fs.mkdirSync(agentDir, { recursive: true });
    const turtlePath = path.join(agentDir, "Turtle.java");
    fs.writeFileSync(turtlePath, 'package org.nlogo.agent; public abstract class Turtle implements org.nlogo.api.Turtle3D { public String penMode() { return "up"; } }');

    const collectionDir = path.join(tempDir, "scala", "collection");
    const coreDir = path.join(tempDir, "org", "nlogo", "core");
    fs.mkdirSync(collectionDir, { recursive: true });
    fs.mkdirSync(coreDir, { recursive: true });
    const sequencePath = path.join(collectionDir, "Seq.java");
    const iteratorPath = path.join(collectionDir, "Iterator.java");
    const penStatePath = path.join(coreDir, "PlotPenState.java");
    fs.writeFileSync(sequencePath, "package scala.collection; public interface Seq<T> { int size(); Iterator<T> iterator(); }");
    fs.writeFileSync(iteratorPath, "package scala.collection; public interface Iterator<T> { boolean hasNext(); T next(); }");
    fs.writeFileSync(penStatePath, "package org.nlogo.core; public interface PlotPenState { boolean isDown(); int mode(); double interval(); int color(); double x(); boolean hidden(); }");

    const bridgePath = path.resolve(__dirname, "..", "resources", "java", "NetLogoCommandBridge.java");
    const result = spawnSync("javac", ["-d", classesDir, stubPath, path.join(apiDir, "Drawing3D.java"), path.join(apiDir, "DrawingLine3D.java"), path.join(apiDir, "Color.java"), ...apiPaths, turtlePath, sequencePath, iteratorPath, penStatePath, bridgePath], {
      encoding: "utf8"
    });

    assert.equal(result.status, 0, result.stderr || result.stdout);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
