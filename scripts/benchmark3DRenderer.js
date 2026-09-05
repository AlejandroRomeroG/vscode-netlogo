// CPU update comparison on the same alternating native snapshots, in one process.
// Optional second argument: a baseline extension's out/netlogoEditor.js.
const fs = require("node:fs");
const path = require("node:path");
const THREE = require("three");
const { parseView3DBinary } = require("../out/view3D");
const { threeViewFunctions } = require("../test/helpers/threeView");
const directory = path.resolve(process.argv[2]);
const snapshots = ["percolation40.bin", "percolation83.bin"].map(name => parseView3DBinary(fs.readFileSync(path.join(directory, name))));
const paths = [process.argv[3], require.resolve("../out/netlogoEditor")].filter(Boolean);
const contexts = paths.map(editor => ({ editor, view: threeViewFunctions({}, path.resolve(editor)), layer: new THREE.Group(), times: [], faces: [] }));
for (let index = 0; index < 60; index++) {
  // Alternate which implementation goes first to avoid a systematic warm-up/order advantage.
  for (const context of index % 2 ? [...contexts].reverse() : contexts) {
    const start = performance.now();
    context.view.addThreePatches(context.layer, THREE, snapshots[index % 2], []);
    const elapsed = performance.now() - start;
    if (index >= 20) context.times.push(elapsed);
    context.faces[index % 2] = context.layer.userData.patchStats.faces;
  }
}
console.log(JSON.stringify(contexts.map(context => {
  context.times.sort((a, b) => a - b);
  context.view.geometryDispose(context.layer);
  return { editor: context.editor, samples: context.times.length, medianUpdateMs: context.times[20], p95UpdateMs: context.times[38], faces: context.faces };
}), null, 2));
