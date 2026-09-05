const assert = require("node:assert/strict");
const test = require("node:test");
const THREE = require("three");
const { threeViewFunctions } = require("./helpers/threeView");

const view = threeViewFunctions();
const bounds = { minX: 0, maxX: 2, minY: 0, maxY: 2, minZ: 0, maxZ: 2 };
const patch = (x, y, z, color = 15) => ({ x, y, z, color, alpha: 255 });

test("3D patch surfaces remove only internal opaque faces, preserving coordinates and picking", () => {
  const patches = [];
  for (let x = 0; x < 3; x++) for (let y = 0; y < 3; y++) for (let z = 0; z < 3; z++) patches.push(patch(x, y, z));
  const scene = new THREE.Group();
  const pickables = [];
  view.addThreePatches(scene, THREE, { bounds, patches }, pickables);
  assert.deepEqual(scene.userData.patchStats, { patches: 27, instances: 26, faces: 54 });
  assert.equal(scene.children.reduce((sum, mesh) => sum + mesh.count * mesh.geometry.index.count / 3, 0), 108);
  const mesh = pickables[0];
  const selected = view.threeHitItem({ object: mesh, instanceId: 0 });
  const position = new THREE.Vector3().setFromMatrixPosition(new THREE.Matrix4().fromArray(mesh.instanceMatrix.array));
  assert.deepEqual(position.toArray(), [selected.x, selected.z, selected.y]);
  assert.equal(mesh.material.side, THREE.FrontSide);
  assert.equal(mesh.material.polygonOffset, true);
  const ray = new THREE.Raycaster(new THREE.Vector3(-10, 1, 1), new THREE.Vector3(1, 0, 0));
  scene.updateMatrixWorld(true);
  assert.equal(view.threeHitItem(ray.intersectObjects(pickables)[0]).x, 0);
  view.geometryDispose(scene);
});

test("translucent patches retain their interfaces and native RGBA colors", () => {
  const scene = new THREE.Group();
  const patches = [patch(0, 0, 0), { ...patch(1, 0, 0), alpha: 128, colorRgb: { red: 12, green: 34, blue: 56 } }];
  view.addThreePatches(scene, THREE, { bounds, patches }, []);
  assert.equal(scene.userData.patchStats.faces, 12);
  const mesh = scene.children.find(mesh => mesh.material.transparent);
  assert.equal(mesh.material.opacity, 128 / 255);
  assert.equal(mesh.material.depthWrite, false);
  const color = new THREE.Color();
  mesh.getColorAt(0, color);
  assert.equal(color.getHex(), 0x0c2238);
  view.geometryDispose(scene);
});

test("patch and turtle GPU buffers are reused across color, position, and population changes", () => {
  const scene = new THREE.Group();
  view.addThreePatches(scene, THREE, { bounds, patches: [patch(0, 0, 0)] }, []);
  const original = scene.children[0];
  const attributes = [original.instanceMatrix, original.instanceColor];
  view.addThreePatches(scene, THREE, { bounds, patches: [patch(0, 0, 0, 55), patch(2, 2, 2, 115)] }, []);
  assert.equal(scene.children[0], original);
  assert.equal(original.count, 2);
  assert.deepEqual([original.instanceMatrix, original.instanceColor], attributes);
  assert.ok(original.boundingBox.max.x >= 2.5);
  view.addThreePatches(scene, THREE, { bounds, patches: [] }, []);
  assert.equal(scene.children.length, 0);

  const turtle = { who: 0, x: 0, y: 0, z: 0, heading: 0, pitch: 0, size: 1, shape: "cube", color: 15 };
  view.addThreeTurtles(scene, THREE, [turtle], []);
  const turtleMesh = scene.children[0];
  view.addThreeTurtles(scene, THREE, [{ ...turtle, x: 100, color: 55 }, { ...turtle, who: 1, color: 115 }], []);
  assert.equal(scene.children[0], turtleMesh);
  assert.equal(scene.children.length, 1, "color changes use instance colors rather than separate draw calls");
  assert.ok(turtleMesh.boundingBox.max.x > 100);
  const picked = view.threeHitItem({ object: turtleMesh, instanceId: 0 });
  assert.equal(picked.who, 0);
  view.addThreeTurtles(scene, THREE, [{ ...turtle, hidden: true }, { ...turtle, who: 1, size: 0 }], []);
  assert.equal(scene.children.length, 0);
});

test("3D instancing keeps agents beyond 65,535 and updates line buffers without stale agents", () => {
  const scene = new THREE.Group();
  const turtles = Array.from({ length: 65536 }, (_, who) => ({ who, x: who % 256, y: Math.floor(who / 256), z: 0, size: 1, shape: "cube", color: 15 }));
  const picked = [];
  view.addThreeTurtles(scene, THREE, turtles, picked);
  assert.equal(scene.children.reduce((sum, mesh) => sum + mesh.count, 0), 65536);
  assert.equal(view.threeHitItem({ object: picked[1], instanceId: 5535 }).who, 65535);
  view.addThreeTurtles(scene, THREE, [{ ...turtles[0], shape: "line" }, { ...turtles[1], shape: "line" }], []);
  const line = scene.children[0];
  const positions = line.geometry.getAttribute("position");
  view.addThreeTurtles(scene, THREE, [{ ...turtles[0], shape: "line", color: 55 }], []);
  assert.equal(scene.children[0], line);
  assert.equal(line.geometry.getAttribute("position"), positions);
  assert.equal(line.geometry.drawRange.count, 2);
  view.geometryDispose(scene);
});

test("3D observer coordinates keep the camera on the native side of the world", () => {
  const controls = view.threeObserverCameraControls({ x: -145, y: -145, z: 0 }, { x: 0, y: 0, z: 0 }, 103);
  const position = new THREE.Vector3().setFromSphericalCoords(controls.radius, controls.phi, controls.theta);
  assert.ok(Math.abs(position.x + 145) < 1e-10);
  assert.ok(Math.abs(position.z + 145) < 1e-10);
  const clipping = view.threeCameraClipping(position, new THREE.Vector3(), 43, 43, 103);
  assert.ok(clipping.near > 100 && clipping.far / clipping.near < 3);
  const inside = view.threeCameraClipping(new THREE.Vector3(), new THREE.Vector3(), 43, 43, 103);
  assert.ok(inside.near > 0 && inside.near < 0.1 && inside.far > 51.5);
});

test("Reset camera restores the native observer after manual orbit, pan, and zoom", () => {
  const view = threeViewFunctions({ threeCamera: { theta: 1, phi: 0.5, radius: 40, targetX: 20, targetY: 30, targetZ: 40 } });
  const observer = { x: -145, y: -145, z: 0 };
  const center = { x: 0, y: 0, z: 0 };
  assert.deepEqual(view.cameraPose("home", 103, center, observer), view.threeObserverCameraControls(observer, center, 103));
  assert.equal(view.cameraPose("top", 103, center, observer).radius, 40, "axis presets retain the user's zoom");
  assert.equal(view.cameraPose("home", 103, center).radius, 103 * 1.9, "legacy snapshots still have a default pose");
});

test("transparent patches and turtle shapes share a native-distance-sorted RGBA batch", () => {
  const layer = new THREE.Group();
  const snapshot = { bounds, links: [], patches: [{ ...patch(0, 0, 1), alpha: 90 }], turtles: [
    { who: 4, x: 0, y: -1, z: 0, size: 1, shape: "cube", color: 15, alpha: 128 },
    { who: 8, x: 0, y: 2, z: 0, size: 1, shape: "sphere", color: 55, alpha: 200 }
  ] };
  const pickables = [];
  view.addThreeTransparency(layer, THREE, snapshot, pickables);
  const mesh = pickables[0];
  assert.equal(mesh.isBatchedMesh, true);
  assert.equal(layer.children.length, 1, "shape, color and opacity do not partition transparent draw order");
  assert.equal(mesh.material.depthWrite, true, "matches NetLogo GL depth writes during blending");
  const rgba = mesh.getColorAt(0, new THREE.Vector4());
  assert.ok(Math.abs(rgba.w - 128 / 255) < 1e-7);
  assert.equal(new THREE.Color(rgba.x, rgba.y, rgba.z).getHex(), 0xd73229);
  const list = [0, 1, 2].map(index => ({ index }));
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(0, 0, 10);
  mesh.customSort(list, camera);
  assert.deepEqual(list.map(item => item.index), [0, 2, 1]);
  camera.position.z = -10;
  mesh.customSort(list, camera);
  assert.deepEqual(list.map(item => item.index), [1, 2, 0], "orbit reverses the order inside the batch");
  assert.equal(view.threeHitItem({ object: mesh, batchId: 1 }).who, 8);
  assert.equal(mesh.userData.kindAt(2), "patch");
  view.addThreeTransparency(layer, THREE, { ...snapshot, turtles: [snapshot.turtles[1]], patches: [] }, []);
  assert.equal(layer.children[0], mesh);
  assert.equal(mesh.getVisibleAt(1), false, "removed instances cannot remain visible");
  view.addThreeTransparency(layer, THREE, { ...snapshot, turtles: [], patches: [] }, []);
  assert.equal(layer.children.length, 0);
});

test("transparent lines interleave with patches and turtles instead of rendering a whole material group first", () => {
  const layer = new THREE.Group();
  const snapshot = { bounds, patches: [{ ...patch(0, 2, 0), alpha: 128 }], links: [], turtles: [
    { who: 1, x: 0, y: -2, z: 0, size: 1, shape: "cube", color: 55, alpha: 128 },
    { who: 2, x: 0, y: 0, z: 0, size: 1, shape: "line", color: 15, alpha: 128 }
  ] };
  const pickables = [];
  view.addThreeTransparency(layer, THREE, snapshot, pickables);
  assert.equal(layer.userData.mode, "individual");
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(0, 0, 10);
  const list = pickables.map((object, id) => ({ object, id, groupOrder: 0 }));
  list.sort((a, b) => view.threeTransparentObjectOrder(a, b, camera));
  assert.deepEqual(list.map(item => item.object.userData.kind), ["turtle", "turtle", "patch"]);
  assert.deepEqual(list.map(item => item.object.userData.transparentCenter.z), [-2, 0, 2]);
  camera.position.z = -10;
  list.sort((a, b) => view.threeTransparentObjectOrder(a, b, camera));
  assert.deepEqual(list.map(item => item.object.userData.transparentCenter.z), [2, 0, -2]);
  assert.ok(pickables.every(object => object.material.depthWrite && object.material.side === THREE.FrontSide));
  view.geometryDispose(layer);
});

test("transparent batches grow, update alpha and shape, and switch modes without leaking resources", () => {
  const layer = new THREE.Group();
  const turtle = { who: 0, x: 0, y: 0, z: 0, size: 1, shape: "cube", color: 15, alpha: 128 };
  const snapshot = { bounds, turtles: [turtle], patches: [], links: [] };
  view.addThreeTransparency(layer, THREE, snapshot, []);
  const mesh = layer.children[0];
  const turtles = Array.from({ length: 257 }, (_, who) => ({ ...turtle, who, x: who }));
  view.addThreeTransparency(layer, THREE, { ...snapshot, turtles }, []);
  assert.equal(layer.children[0], mesh);
  assert.equal(mesh.userData.capacity, 512);
  assert.equal(view.threeHitItem({ object: mesh, batchId: 256 }).who, 256);
  view.addThreeTransparency(layer, THREE, { ...snapshot, turtles: [{ ...turtle, shape: "sphere", alpha: 90 }] }, []);
  assert.equal(mesh.getVisibleAt(256), false);
  assert.ok(Math.abs(mesh.getColorAt(0, new THREE.Vector4()).w - 90 / 255) < 1e-7);
  assert.equal(mesh.userData.entries[0].geometry, "sphere");
  let meshDisposals = 0, geometryDisposals = 0, materialDisposals = 0;
  const dispose = mesh.dispose.bind(mesh);
  mesh.dispose = () => { meshDisposals++; return dispose(); };
  mesh.geometry.addEventListener("dispose", () => geometryDisposals++);
  mesh.material.addEventListener("dispose", () => materialDisposals++);
  view.addThreeTransparency(layer, THREE, { ...snapshot, turtles: [{ ...turtle, shape: "line" }] }, []);
  assert.equal(layer.userData.mode, "individual");
  assert.deepEqual([meshDisposals, geometryDisposals, materialDisposals], [1, 1, 1]);
  view.addThreeTransparency(layer, THREE, snapshot, []);
  assert.equal(layer.userData.mode, "batched");
  assert.equal(layer.children.length, 1);
  assert.notEqual(layer.children[0], mesh);
  view.geometryDispose(layer);
});

test("transparent links with shared endpoints remain distinct and sort by their midpoint", () => {
  const layer = new THREE.Group();
  const turtles = [0, 1].map(who => ({ who, x: 0, y: who * 2, z: 0, size: 1, shape: "cube", color: 15 }));
  const links = [15, 55].map(color => ({ end1: 0, end2: 1, color, alpha: 128 }));
  const pickables = [];
  view.addThreeTransparency(layer, THREE, { bounds, turtles, links, patches: [] }, pickables);
  assert.equal(layer.children.length, 2);
  assert.deepEqual(pickables.map(object => object.userData.item.color), [15, 55]);
  assert.ok(pickables.every(object => object.userData.transparentCenter.z === 1));
  view.geometryDispose(layer);
});

test("dense and sparse patch occupancy preserve neighbor faces in offset worlds", () => {
  const patches = [patch(-5, -3, -2), patch(-4, -3, -2), patch(-4, -2, -2), patch(-4, -2, -1)];
  const dense = new THREE.Group(), sparse = new THREE.Group();
  const offset = { minX: -5, maxX: -3, minY: -3, maxY: -1, minZ: -2, maxZ: 0 };
  view.addThreePatches(dense, THREE, { bounds: offset, patches }, []);
  view.addThreePatches(sparse, THREE, { bounds: { ...offset, maxX: 10000, maxY: 10000, maxZ: 10000 }, patches }, []);
  assert.equal(dense.userData.patchStats.faces, 18);
  assert.deepEqual(sparse.userData.patchStats, dense.userData.patchStats);
  assert.deepEqual([...sparse.userData.threeBatches.keys()].sort(), [...dense.userData.threeBatches.keys()].sort());
  view.geometryDispose(dense);
  view.geometryDispose(sparse);
});
