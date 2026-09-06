const assert = require("node:assert/strict");
const test = require("node:test");
const { createViewMouseInput, isViewMouseState } = require("../out/viewMouse");
const { plotLayoutSource } = require("./helpers/plotLayout");

function fixture() {
  const sent = [], tasks = new Map();
  let id = 0;
  const input = createViewMouseInput({ send: state => sent.push(state),
    schedule: callback => { tasks.set(++id, callback); return id; }, cancel: key => tasks.delete(key) });
  return { input, sent, tasks, flush() { for (const callback of [...tasks.values()]) callback(); } };
}
const square = { left: 10, top: 20, width: 400, height: 400, naturalWidth: 505, naturalHeight: 505 };

test("mouse input maps CSS pixels to native image fractions without patch rounding", () => {
  const { input, sent } = fixture();
  input.update({ x: 110, y: 320, down: true }, square);
  assert.deepEqual(sent, [{ inside: true, down: true, u: 0.25, v: 0.75 }]);
});

test("letterboxes, clipped edges, wide/tall images and CSS zoom do not place agents outside the image", () => {
  for (const zoom of [0.5, 1, 2]) {
    const { input, sent } = fixture();
    const image = { ...square, left: 0, top: 0, width: 400 * zoom, height: 200 * zoom };
    input.update({ x: 200 * zoom, y: 100 * zoom, down: true }, image);
    assert.deepEqual(sent[0], { inside: true, down: true, u: 0.5, v: 0.5 });
    input.update({ x: 99 * zoom, y: 100 * zoom, down: true }, image);
    assert.deepEqual(sent.at(-1), { inside: false, down: false, u: 0.5, v: 0.5 });
    input.update({ x: 300 * zoom, y: 100 * zoom, down: true }, image);
    assert.equal(sent.at(-1).inside, false);
    input.update({ x: 200 * zoom, y: 100 * zoom, down: true }, { ...image, naturalWidth: 1000, naturalHeight: 250 });
    assert.deepEqual(sent.at(-1), { inside: true, down: true, u: 0.5, v: 0.5 });
    input.update({ x: 200 * zoom, y: 25 * zoom, down: true }, { ...image, naturalWidth: 1000, naturalHeight: 250 });
    assert.equal(sent.at(-1).inside, false);
  }
});

test("motion is bounded to the newest animation-frame update; button edges are immediate", () => {
  const { input, sent, tasks, flush } = fixture();
  input.update({ x: 210, y: 220, down: false }, square);
  for (let i = 0; i < 1000; i++) input.update({ x: 210 + i / 10, y: 220, down: false }, square);
  assert.equal(tasks.size, 1);
  assert.equal(sent.length, 1);
  input.update({ x: 210, y: 220, down: true }, square, true);
  input.update({ x: 210, y: 220, down: false }, square, true);
  assert.deepEqual(sent.map(state => state.down), [false, true, false]);
  assert.equal(tasks.size, 0);
  flush();
  assert.equal(sent.length, 3);
});

test("leaving, cancelling, hidden tabs and disposal release the mouse and keep last coordinates", () => {
  const { input, sent, tasks, flush } = fixture();
  input.update({ x: 110, y: 120, down: true }, square);
  input.update({ x: 130, y: 140, down: true }, square);
  input.reset();
  assert.deepEqual(sent.at(-1), { inside: false, down: false, u: 0.3, v: 0.3 });
  assert.equal(tasks.size, 0);
  input.dispose();
  input.update({ x: 200, y: 200, down: true }, square);
  flush();
  assert.equal(sent.length, 2);
});

test("missing/undecoded images cannot generate a mouse press", () => {
  const { input, sent } = fixture();
  input.update({ x: 210, y: 220, down: true }, null);
  input.update({ x: 210, y: 220, down: true }, { ...square, naturalWidth: 0 });
  assert.equal(sent.length, 0);
});

test("host validation rejects non-finite, malformed and out-of-image payloads", () => {
  assert.equal(isViewMouseState({ inside: true, down: false, u: 0, v: 0.999 }), true);
  for (const value of [null, {}, { inside: true, down: true, u: NaN, v: 0 },
    { inside: true, down: true, u: 1, v: 0 }, { inside: true, down: true, u: 0, v: -1 },
    { inside: false, down: true, u: 0, v: 0 }, { inside: true, down: true, u: "0", v: 0 }]) {
    assert.equal(isViewMouseState(value), false);
  }
});

test("2D and 3D views have no coordinate footer or reserved footer row", () => {
  const { html, css } = plotLayoutSource();
  assert.doesNotMatch(html, /view-footer|viewWorldLabel/);
  assert.match(css, /\.widget\.view-widget\s*\{[^}]*grid-template-rows:\s*auto minmax\(0, 1fr\)/);
  assert.match(html, /mountTwoViewMouse\(host\)/);
  assert.match(html, /window\.addEventListener\("blur", resetViewMouse\)/);
});
