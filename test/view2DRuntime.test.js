const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const source = fs.readFileSync(path.join(__dirname, "../out/netlogoEditor.js"), "utf8");
function fragment(startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start);
  return source.slice(start, end);
}

function fixture() {
  const image = { src: "data:image/png;base64,old" };
  const element = { dataset: { widgetId: "view" }, querySelector: () => image };
  const mounted = [element];
  const state = {
    viewImageDataUri: "data:image/png;base64,new",
    view3DState: null,
    interaction: null,
    interfacePreview: { widgets: [{ id: "view", kind: "view" }, { id: "slider", kind: "slider" }] },
    dirtyPlotWidgets: new Set(),
    runLoop: null
  };
  const surface = { querySelectorAll: selector => {
    assert.equal(selector, ".view-widget");
    return mounted;
  } };
  const refresh = new Function("state", "surface", fragment(
    "function refreshMountedTwoViews()", "function refreshMountedRuntimeWidgets()"
  ) + "return refreshMountedTwoViews;")(state, surface);
  return { state, image, element, mounted, refresh };
}

test("2D frames update the mounted native image without replacing controls or selection", () => {
  const { state, image, refresh } = fixture();
  state.selectedWidgetId = "slider";
  assert.equal(refresh(), true);
  assert.equal(image.src, state.viewImageDataUri);
  assert.equal(state.selectedWidgetId, "slider");
  state.viewImageDataUri = "data:image/png;base64,next";
  assert.equal(refresh(), true);
  assert.equal(image.src, state.viewImageDataUri);
});

test("unchanged native frames do not restart image loading", () => {
  const { state, image, refresh } = fixture();
  Object.defineProperty(image, "src", {
    get: () => state.viewImageDataUri,
    set: () => assert.fail("The unchanged source must not be assigned again")
  });
  assert.equal(refresh(), true);
});

test("2D fast refresh falls back for first setup, changed views, errors, and active dragging", () => {
  for (const change of [
    context => { context.state.viewImageDataUri = null; },
    context => { context.state.view3DState = {}; },
    context => { context.state.interaction = {}; },
    context => { context.state.interfacePreview.widgets = []; },
    context => { context.mounted.length = 0; },
    context => { context.element.querySelector = () => null; },
    context => { context.element.dataset.widgetId = "different-view"; }
  ]) {
    const context = fixture();
    change(context);
    assert.equal(context.refresh(), false);
    assert.equal(context.image.src, "data:image/png;base64,old");
  }
});

test("all 2D views are validated before changing any mounted image", () => {
  const { state, image, mounted, refresh } = fixture();
  const otherImage = { src: "other-old" };
  state.interfacePreview.widgets.push({ id: "other", kind: "view" });
  mounted.push({ dataset: { widgetId: "other" }, querySelector: () => null });
  assert.equal(refresh(), false);
  assert.equal(image.src, "data:image/png;base64,old");
  mounted[1].querySelector = () => otherImage;
  assert.equal(refresh(), true);
  assert.equal(image.src, state.viewImageDataUri);
  assert.equal(otherImage.src, state.viewImageDataUri);
});

test("runtime result reuses mounted 2D views and still refreshes plots, monitors, and ticks", () => {
  const { state, image, refresh } = fixture();
  const calls = [];
  const apply = new Function(
    "state", "renderTickCount", "updateRuntimeBanner", "setStatus", "updateRunControls",
    "refreshMountedThreeViews", "refreshMountedTwoViews", "refreshMountedRuntimeWidgets", "renderInterface",
    fragment("function applyRuntimeResult(result)", "function applyRuntimeError(message)") + "return applyRuntimeResult;"
  )(state, () => calls.push("ticks"), () => {}, () => {}, () => {},
    () => { calls.push("3d"); return true; }, refresh,
    () => calls.push("widgets"), () => calls.push("rebuild"));
  const result = {
    ticks: "5645", viewImageDataUri: "data:image/png;base64,frame",
    monitorValues: [{ widgetId: "monitor", value: "500" }],
    plotValues: [{ widgetId: "plot", data: { pens: [] } }]
  };
  apply(result);
  assert.deepEqual(calls, ["ticks", "widgets"]);
  assert.equal(image.src, result.viewImageDataUri);
  assert.equal(state.ticks, "5645");
  assert.equal(state.runtimeValues.monitor, "500");
  assert.equal(state.plotData.plot, result.plotValues[0].data);
  calls.length = 0;
  apply({ ...result, viewImageDataUri: null, view3DState: {} });
  assert.deepEqual(calls, ["ticks", "3d", "widgets"], "The existing 3D fast path is preserved");
  calls.length = 0;
  apply({ ...result, viewImageDataUri: null });
  assert.deepEqual(calls, ["ticks", "rebuild"], "Failed exports must not leave a stale view visible");
});
