const Module = require("node:module");
const test = require("node:test");
const assert = require("node:assert/strict");

const originalLoad = Module._load;
Module._load = function loadWithVscodeMock(request, parent, isMain) {
  if (request === "vscode") {
    return {
      ProgressLocation: { Notification: 15 },
      Uri: {
        joinPath() {
          return { fsPath: "" };
        }
      },
      window: {},
      workspace: {}
    };
  }

  return originalLoad.call(this, request, parent, isMain);
};

const {
  parseDrawing3DBinaryCount,
  parseDrawing3DBinaryMetadata,
  parseDrawingLine3DValue,
  parseLink3DValue,
  parseNetLogoDelimitedList,
  parsePatch3DValue,
  parseTurtle3DValue
} = require("../out/runner");
Module._load = originalLoad;

test("parses NetLogo 3D string lists with quoted entries", () => {
  assert.deepEqual(parseNetLogoDelimitedList("[\"0|1|2|3|15|90|0|1|default||9.9\" \"1|4|5|6|55|180|0|2|circle|leader|15\"]"), [
    "0|1|2|3|15|90|0|1|default||9.9",
    "1|4|5|6|55|180|0|2|circle|leader|15"
  ]);
});

test("parses legacy comma-separated 3D list entries", () => {
  assert.deepEqual(parseNetLogoDelimitedList("[0|1|2|3, 1|4|5|6, 2|7|8|9]"), [
    "0|1|2|3",
    "1|4|5|6",
    "2|7|8|9"
  ]);
});

test("keeps 3D agents whose NetLogo colors are RGB or RGBA lists", () => {
  const turtle = parseTurtle3DValue("7|1|2|3|[12 34 56 78]|12|34|56|90|15|1|line|leaf|[4 5 6 7]|4|5|6|down|2");
  assert.deepEqual(turtle, {
    who: 7,
    x: 1,
    y: 2,
    z: 3,
    color: undefined,
    colorRgb: { red: 12, green: 34, blue: 56 },
    alpha: 78,
    heading: 90,
    pitch: 15,
    size: 1,
    penMode: "down",
    penSize: 2,
    shape: "line",
    label: "leaf",
    labelColor: undefined,
    labelColorRgb: { red: 4, green: 5, blue: 6 },
    labelAlpha: 7
  });

  const link = parseLink3DValue("1|2|[20 30 40 50]|20|30|40|0.5|true|link|edge|[1 2 3 4]|1|2|3");
  assert.equal(link.color, undefined);
  assert.deepEqual(link.colorRgb, { red: 20, green: 30, blue: 40 });
  assert.equal(link.alpha, 50);
  assert.equal(link.labelAlpha, 4);

  const patch = parsePatch3DValue("1|2|3|[90 80 70 60]|90|80|70");
  assert.equal(patch.color, undefined);
  assert.deepEqual(patch.colorRgb, { red: 90, green: 80, blue: 70 });
  assert.equal(patch.alpha, 60);

  const fractionalPatch = parsePatch3DValue("1|2|3|[12.4 34.5 56.6 78.5]|12.4|34.5|56.6");
  assert.deepEqual(fractionalPatch.colorRgb, { red: 12, green: 34, blue: 56 });
  assert.equal(fractionalPatch.alpha, 78);
});

test("keeps legacy 3D drawing lines with RGBA colors", () => {
  const line = parseDrawingLine3DValue("0|1|2|3|4|5|1|[100 110 120 130]|100|110|120|90|15|4");
  assert.equal(line.color, undefined);
  assert.deepEqual(line.colorRgb, { red: 100, green: 110, blue: 120 });
  assert.equal(line.alpha, 130);
  assert.equal(line.length, 4);
});

test("validates packed 3D drawing headers and record lengths", () => {
  const data = Buffer.alloc(16 + 2 * 32);
  data.writeUInt32BE(0x4e4c4433, 0);
  data.writeUInt32BE(1, 4);
  data.writeUInt32BE(2, 8);
  data.writeUInt32BE(32, 12);
  assert.equal(parseDrawing3DBinaryCount(data), 2);
  assert.equal(parseDrawing3DBinaryCount(data.subarray(0, data.length - 1)), undefined);

  const compacted = Buffer.alloc(20 + 2 * 32);
  compacted.writeUInt32BE(0x4e4c4433, 0);
  compacted.writeUInt32BE(2, 4);
  compacted.writeUInt32BE(5, 8);
  compacted.writeUInt32BE(2, 12);
  compacted.writeUInt32BE(32, 16);
  assert.deepEqual(parseDrawing3DBinaryMetadata(compacted), {
    originalCount: 5,
    recordCount: 2,
    recordSize: 32
  });
  assert.equal(parseDrawing3DBinaryCount(compacted), 5);
});
