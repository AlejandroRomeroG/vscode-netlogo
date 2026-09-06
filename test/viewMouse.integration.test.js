const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");
const { installation, compileMouseBridge, openMouseBridge } = require("./helpers/mouseBridge");

test("native mouse reporters create/remove Paths buildings and release inside a running command", {
  skip: installation ? false : "No local NetLogo installation", timeout: 60000
}, async () => {
  const directory = compileMouseBridge();
  const model = path.join(installation.home, "models/Sample Models/Social Science/Paths.nlogo");
  const original = fs.readFileSync(model);
  let bridge;
  try {
    bridge = await openMouseBridge(directory, model);
    await bridge.command("random-seed 24680 set walker-count 0 setup");
    assert.deepEqual(JSON.parse(await bridge.report("(list mouse-inside? mouse-down? mouse-xcor mouse-ycor)")), [false, false, 0, 0]);
    // Paths initializes its mouse-clicked? latch during the first unpressed GO.
    // Match the model's instructions: start GO before clicking in the View.
    await bridge.command("go");
    bridge.mouse(true, true, 0.25, 0.25);
    await bridge.command("go");
    assert.equal(await bridge.report("count buildings"), "1.0");
    assert.deepEqual(JSON.parse(await bridge.report("[ (list xcor ycor) ] of buildings")), [[-25, 25]]);
    await bridge.command("repeat 5 [ go ]");
    assert.equal(await bridge.report("count buildings"), "1.0", "Holding must not toggle every tick");
    bridge.mouse(true, false, 0.25, 0.25);
    await bridge.command("go");
    bridge.mouse(true, true, 0.75, 0.75);
    await bridge.command("go");
    assert.equal(await bridge.report("count buildings"), "2.0");
    bridge.mouse(true, false, 0.75, 0.75);
    await bridge.command("go");
    bridge.mouse(true, true, 0.25, 0.25);
    await bridge.command("go");
    assert.equal(await bridge.report("count buildings"), "1.0", "A new click near a building removes it");

    const lastPosition = await bridge.report("(list mouse-xcor mouse-ycor)");
    bridge.mouse(false, false, 0, 0);
    assert.deepEqual(JSON.parse(await bridge.report("(list mouse-inside? mouse-down?)")), [false, false]);
    assert.equal(await bridge.report("(list mouse-xcor mouse-ycor)"), lastPosition);
    assert.equal(await bridge.report('runresult "mouse-xcor"'), "-25.3", "Dynamic code uses the same native reporter adapter");

    // A queued release after command completion would deadlock this model.
    bridge.mouse(true, true, 0.5, 0.5);
    const release = line => {
      if (line === "waiting-for-release") bridge.mouse(true, false, 0.5, 0.5);
    };
    bridge.observers.add(release);
    await bridge.command('print "waiting-for-release" while [mouse-down?] []');
    bridge.observers.delete(release);
    assert.equal(await bridge.report("mouse-down?"), "false");
    assert.equal(bridge.output.some(line => line.startsWith("UNHANDLED:")), false);
    assert.ok(original.equals(fs.readFileSync(model)), "The model file must remain unchanged");
  } finally {
    await bridge?.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("mouse drawing works with non-go commands and native resizing without changing RNG", {
  skip: installation ? false : "No local NetLogo installation", timeout: 60000
}, async () => {
  const directory = compileMouseBridge();
  let bridge;
  try {
    bridge = await openMouseBridge(directory, path.join(installation.home, "models/Code Examples/Mouse Example.nlogo"));
    await bridge.command("clear-all random-seed 24680");
    const expected = await bridge.report("random 1000000");
    await bridge.command("random-seed 24680");
    bridge.mouse(true, true, 0.5, 0.5);
    assert.equal(await bridge.report("random 1000000"), expected);
    await bridge.command("patch-draw");
    assert.equal(await bridge.report("[pcolor] of patch 0 0"), "15.0");
    bridge.mouse(true, false, 0.5, 0.5);
    await bridge.command("resize-world -10 20 -5 15");
    bridge.mouse(true, true, 0.5, 0.5);
    await bridge.command("patch-draw");
    assert.equal(await bridge.report("[pcolor] of patch 5 5"), "15.0");
    assert.ok((await bridge.view()).length > 100);
  } finally {
    await bridge?.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("native turtle dragging, follow offsets and small-patch rounding use the same mouse input", {
  skip: installation ? false : "No local NetLogo installation", timeout: 60000
}, async () => {
  const directory = compileMouseBridge();
  let bridge;
  try {
    bridge = await openMouseBridge(directory, path.join(installation.home, "models/Code Examples/Mouse Drag One Example.nlogo"));
    await bridge.command("random-seed 24680 setup clear-turtles create-turtles 1");
    bridge.mouse(true, true, 0.5, 0.5);
    await bridge.command("go");
    assert.equal(await bridge.report("selected = turtle 0"), "true");
    bridge.mouse(true, true, 0.75, 0.25);
    await bridge.command("go");
    assert.equal(await bridge.report("[xcor = mouse-xcor and ycor = mouse-ycor] of selected"), "true");
    bridge.mouse(true, false, 0.75, 0.25);
    await bridge.command("go");
    assert.equal(await bridge.report("selected = nobody"), "true");
    bridge.mouse(true, false, 0.5, 0.5);
    const centered = JSON.parse(await bridge.report("(list mouse-xcor mouse-ycor)"));
    await bridge.command("ask turtle 0 [ setxy 7 3 ] follow turtle 0");
    await bridge.view();
    const followed = JSON.parse(await bridge.report("(list mouse-xcor mouse-ycor)"));
    assert.ok(Math.abs(followed[0] - centered[0] - 7) < 1e-9);
    assert.ok(Math.abs(followed[1] - centered[1] - 3) < 1e-9);
    await bridge.command("reset-perspective set-patch-size 1");
    bridge.mouse(true, false, 0.27, 0.61);
    const rounded = JSON.parse(await bridge.report("(list mouse-xcor mouse-ycor)"));
    assert.equal(rounded.every(Number.isInteger), true);
  } finally {
    await bridge?.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
