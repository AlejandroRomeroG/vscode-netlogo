const assert = require("node:assert/strict");
const test = require("node:test");
const vm = require("node:vm");
const { createTwoViewFrameQueue } = require("../out/view2D");
const { plotLayoutSource } = require("./helpers/plotLayout");

const settle = () => new Promise(resolve => setImmediate(resolve));
function fixture(factory = createTwoViewFrameQueue) {
  const images = [], presented = [], errors = [];
  const queue = factory({
    createImage() {
      let resolve, reject;
      const pending = new Promise((yes, no) => { resolve = yes; reject = no; });
      const image = {
        src: "", ready: false, cancelled: false,
        decode: () => pending,
        resolve() { this.ready = true; resolve(); },
        reject,
        removeAttribute(name) { assert.equal(name, "src"); this.cancelled = true; this.src = ""; }
      };
      images.push(image);
      return image;
    },
    present(image) {
      assert.equal(image.ready, true, "An undecoded image must never replace the visible frame");
      presented.push(image);
    },
    onError: error => errors.push(error)
  });
  return { queue, images, presented, errors };
}

test("2D swaps the decoded image itself and never changes the visible image source", async () => {
  const { queue, images, presented } = fixture();
  queue.update("first");
  assert.equal(presented.length, 0);
  images[0].resolve();
  await settle();
  assert.equal(presented[0], images[0]);
  queue.update("second");
  assert.equal(presented.length, 1);
  assert.equal(presented[0].src, "first", "Previous frame stays intact throughout decoding");
  images[1].resolve();
  await settle();
  assert.equal(presented[1], images[1], "Do not copy src to a different, undecoded image");
});

test("2D repeated frames do not allocate or restart an active/completed decode", async () => {
  const { queue, images, presented } = fixture();
  for (let i = 0; i < 20; i++) queue.update("same");
  assert.equal(images.length, 1);
  images[0].resolve();
  await settle();
  for (let i = 0; i < 20; i++) queue.update("same");
  assert.equal(images.length, 1);
  assert.equal(presented.length, 1);
});

test("2D slow decoding keeps one in-flight frame and one latest request without starving presentation", async () => {
  const { queue, images, presented } = fixture();
  queue.update("frame-0");
  for (let i = 1; i <= 1000; i++) queue.update(`frame-${i}`);
  assert.equal(images.length, 1);
  images[0].resolve();
  await settle();
  assert.deepEqual(presented.map(image => image.src), ["frame-0"]);
  assert.equal(images.length, 2);
  assert.equal(images[1].src, "frame-1000");
  images[1].resolve();
  await settle();
  assert.deepEqual(presented.map(image => image.src), ["frame-0", "frame-1000"]);
  assert.equal(images.length, 2);
});

test("2D returning to the displayed frame cannot publish a superseded pending image", async () => {
  const { queue, images, presented } = fixture();
  queue.update("first"); images[0].resolve(); await settle();
  queue.update("second");
  queue.update("first");
  images[1].resolve(); await settle();
  assert.deepEqual(presented.map(image => image.src), ["first"]);
  assert.equal(images.length, 2);
});

test("2D decode failure retains the good frame, reports the error, and recovers on the next frame", async () => {
  const { queue, images, presented, errors } = fixture();
  queue.update("good"); images[0].resolve(); await settle();
  queue.update("broken");
  const failure = new Error("Invalid PNG");
  images[1].reject(failure); await settle();
  assert.deepEqual(errors, [failure]);
  assert.deepEqual(presented.map(image => image.src), ["good"]);
  queue.update("broken");
  assert.equal(images.length, 2, "Do not spin retrying the same failed payload");
  queue.update("recovered"); images[2].resolve(); await settle();
  assert.deepEqual(presented.map(image => image.src), ["good", "recovered"]);
});

test("2D a failed superseded decode still advances to the latest waiting request", async () => {
  const { queue, images, presented } = fixture();
  queue.update("broken"); queue.update("latest");
  images[0].reject(new Error("Invalid PNG")); await settle();
  assert.equal(images[1].src, "latest");
  images[1].resolve(); await settle();
  assert.deepEqual(presented.map(image => image.src), ["latest"]);
});

test("2D disposal cancels loading and late completions cannot paint or start more work", async () => {
  for (const completion of ["resolve", "reject"]) {
    const { queue, images, presented, errors } = fixture();
    queue.update("pending"); queue.update("queued");
    queue.dispose(); queue.dispose();
    assert.equal(images[0].cancelled, true);
    images[0][completion](new Error("Cancelled")); await settle();
    queue.update("after-disposal");
    assert.equal(images.length, 1);
    assert.equal(presented.length, 0);
    assert.equal(errors.length, 0);
  }
});

test("the actual webview embeds the tested frame queue without host dependencies", async () => {
  const { html } = plotLayoutSource();
  const script = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].at(-1)[1];
  const start = script.indexOf("const createTwoViewFrameQueue =");
  assert.ok(start >= 0);
  const factory = vm.runInNewContext(script.slice(start, script.indexOf("const vscode =", start)) + "createTwoViewFrameQueue;");
  const { queue, images, presented } = fixture(factory);
  queue.update("native-frame");
  assert.equal(presented.length, 0);
  images[0].resolve(); await settle();
  assert.equal(presented[0], images[0]);
});
