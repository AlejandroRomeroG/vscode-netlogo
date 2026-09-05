const assert = require("node:assert/strict");
const test = require("node:test");
const { parsePlotBinary } = require("../out/plotSnapshot");

function writer(pens = []) {
  const parts = [];
  const write = {
    int(value) { const data = Buffer.alloc(4); data.writeInt32BE(value); parts.push(data); return write; },
    number(value) { const data = Buffer.alloc(8); data.writeDoubleBE(value); parts.push(data); return write; },
    bool(value) { parts.push(Buffer.from([value ? 1 : 0])); return write; },
    string(value) { const data = Buffer.from(value, "utf8"); write.int(data.length); parts.push(data); return write; },
    data() { return Buffer.concat(parts); }
  };
  write.int(0x4e4c5031).int(1).string('\ufeffPlot "ñ" 🌳');
  write.number(-5).number(12).number(-3).number(9).bool(false).bool(true).string(" ");
  write.int(pens.length);
  for (const pen of pens) {
    write.string(pen.name ?? " ").bool(false).int(pen.mode ?? 0).number(0.5);
    write.int(0xff0c2238 | 0).number(3).bool(pen.hidden ?? true).bool(false);
    write.int(pen.points.length);
    for (const point of pen.points) write.number(point.x).number(point.y).int(point.color).bool(point.penDown);
  }
  return write;
}

test("native binary plots preserve exact names, metadata, colors, and every pen point", () => {
  const points = [
    { x: 0.123456789012345, y: -1.25, color: 0xff0c2238 | 0, penDown: false },
    { x: 2, y: 3, color: 0xffd73229 | 0, penDown: true }
  ];
  const plot = parsePlotBinary(writer([{ points }, { name: "", mode: 2, points: [] }]).data());
  assert.equal(plot.name, '\ufeffPlot "ñ" 🌳');
  assert.deepEqual([plot.xMin, plot.xMax, plot.yMin, plot.yMax], [-5, 12, -3, 9]);
  assert.equal(plot.autoplot, false);
  assert.equal(plot.legend, true);
  assert.equal(plot.currentPen, " ");
  assert.equal(plot.numberOfPens, 2);
  assert.deepEqual(plot.pens[0], {
    name: " ", penDown: false, mode: 0, interval: 0.5, color: 0xff0c2238 | 0, colorFormat: "argb",
    x: 3, hidden: true, inLegend: false, points
  });
  assert.equal(plot.pens[1].name, "");
  assert.equal(plot.pens[1].mode, 2);
  assert.deepEqual(plot.pens[1].points, []);
});

test("binary plot snapshots reject every truncated prefix, trailing bytes, and unknown versions", () => {
  const data = writer([{ points: [{ x: 1, y: 2, color: -1, penDown: true }] }]).data();
  for (let length = 0; length < data.length; length++) {
    assert.throws(() => parsePlotBinary(data.subarray(0, length)));
  }
  assert.throws(() => parsePlotBinary(Buffer.concat([data, Buffer.from([0])])), /Unexpected data/);
  const wrongVersion = Buffer.from(data);
  wrongVersion.writeInt32BE(2, 4);
  assert.throws(() => parsePlotBinary(wrongVersion), /Unsupported/);
  const wrongMagic = Buffer.from(data);
  wrongMagic.writeInt32BE(0, 0);
  assert.throws(() => parsePlotBinary(wrongMagic), /Unsupported/);
});

test("binary plot counts and strings cannot allocate outside the input buffer", () => {
  for (const count of [-1, 2147483647]) {
    const data = writer().data();
    data.writeInt32BE(count, data.length - 4);
    assert.throws(() => parsePlotBinary(data), /record count/);
    const points = writer([{ points: [] }]).data();
    points.writeInt32BE(count, points.length - 4);
    assert.throws(() => parsePlotBinary(points), /record count/);
    data.writeInt32BE(count, 8);
    assert.throws(() => parsePlotBinary(data), /Truncated or invalid/);
  }
  const invalidUtf8 = writer().data();
  invalidUtf8[12] = 0xff;
  assert.throws(() => parsePlotBinary(invalidUtf8));
});

test("binary plots reject invalid flags, non-finite coordinates, ranges, and pen modes", () => {
  const data = writer([{ points: [{ x: 1, y: 2, color: -1, penDown: true }] }]).data();
  const invalidFlag = Buffer.from(data);
  invalidFlag[invalidFlag.length - 1] = 2;
  assert.throws(() => parsePlotBinary(invalidFlag), /Invalid flag/);
  const invalidCoordinate = Buffer.from(data);
  invalidCoordinate.writeDoubleBE(NaN, data.length - 21);
  assert.throws(() => parsePlotBinary(invalidCoordinate), /Non-finite/);
  const invalidRange = Buffer.from(data);
  invalidRange.writeDoubleBE(100, 12 + invalidRange.readInt32BE(8));
  assert.throws(() => parsePlotBinary(invalidRange), /Invalid ranges/);
  assert.throws(() => parsePlotBinary(writer([{ mode: 3, points: [] }]).data()), /Invalid pen mode/);
});

test("binary plots retain long histories rather than sampling or clipping points", () => {
  const points = Array.from({ length: 20_000 }, (_, x) => ({ x, y: x / 3, color: -1, penDown: x % 5 !== 0 }));
  const plot = parsePlotBinary(writer([{ points }]).data());
  assert.deepEqual(plot.pens[0].points, points);
});
