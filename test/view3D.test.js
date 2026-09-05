const assert = require("node:assert/strict");
const test = require("node:test");
const { parseView3DBinary } = require("../out/view3D");

function snapshotWriter(turtles = 0, links = 0, patches = 0) {
  const parts = [];
  const writer = {
    int(value) { const b = Buffer.alloc(4); b.writeInt32BE(value); parts.push(b); return writer; },
    number(value) { const b = Buffer.alloc(8); b.writeDoubleBE(value); parts.push(b); return writer; },
    byte(value) { parts.push(Buffer.from([value])); return writer; },
    string(value) { const b = Buffer.from(value); writer.int(b.length); parts.push(b); return writer; },
    color(value, argb) { return writer.number(value).int(argb | 0); },
    data() { return Buffer.concat(parts); }
  };
  writer.int(0x4e4c5633).int(1);
  for (const value of [-100, 100, -100, 100, -100, 100]) writer.int(value);
  for (const value of [-145, -145, 0]) writer.number(value);
  writer.int(turtles).int(links).int(patches);
  return writer;
}

test("native 3D snapshot preserves hidden agents, roll, exact labels and RGBA", () => {
  const writer = snapshotWriter(1, 1, 1);
  for (const value of [7, 1, 2, 3, 90, 15, 33, 2]) writer.number(value);
  writer.color(NaN, 0x4e0c2238).byte(1).string("cube").string('hoja | ñ 🌳 "\\\n');
  writer.color(15, 0xffd73229).string("down").number(2.5);
  writer.number(7).number(9).color(55, 0xff59b03c).number(0.5).byte(1).byte(0);
  writer.string("default").string("enlace | →").color(9.9, 0xffffffff);
  writer.int(-1).int(2).int(3).color(35, 0xff9d6e48);
  const result = parseView3DBinary(writer.data());
  const turtle = result.turtles[0];
  assert.equal(turtle.hidden, true);
  assert.equal(turtle.roll, 33);
  assert.equal(turtle.label, 'hoja | ñ 🌳 "\\\n');
  assert.equal(turtle.penSize, 2.5);
  assert.equal(turtle.alpha, 78);
  assert.deepEqual(turtle.colorRgb, { red: 12, green: 34, blue: 56 });
  assert.equal(result.links[0].directed, true);
  assert.equal(result.links[0].label, "enlace | →");
  assert.equal(result.patchData.byteLength, 24);
  assert.equal(new DataView(result.patchData).getInt32(0), -1);
  assert.equal(result.patches.length, 0, "large patch sections stay packed during transport");
});

test("native 3D snapshot rejects truncated and inconsistent records", () => {
  const valid = snapshotWriter().data();
  assert.equal(parseView3DBinary(valid).patchCount, 0);
  for (let end = 0; end < valid.length; end++) assert.throws(() => parseView3DBinary(valid.subarray(0, end)));
  assert.throws(() => parseView3DBinary(Buffer.concat([valid, Buffer.from([1])])), /Unexpected data/);
  assert.throws(() => parseView3DBinary(snapshotWriter(-1).data()), /agent counts/);
  assert.throws(() => parseView3DBinary(snapshotWriter(2147483647).data()), /agent counts/);
  const unsupported = Buffer.from(valid);
  unsupported.writeInt32BE(2, 4);
  assert.throws(() => parseView3DBinary(unsupported), /Unsupported/);
});
