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
  const requests = [];
  const host = { image };
  const controller = { host, update: source => requests.push(source) };
  const element = { dataset: { widgetId: "view" }, querySelector: () => host };
  const mounted = [element];
  const state = {
    viewImageDataUri: "data:image/png;base64,new",
    view3DState: null,
    twoViewControllers: new Map([["view", controller]]),
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
  return { state, image, element, mounted, refresh, requests, host };
}

test("2D frames go to the mounted presenter without replacing controls, selection, or the visible image", () => {
  const { state, image, refresh, requests } = fixture();
  state.selectedWidgetId = "slider";
  assert.equal(refresh(), true);
  assert.deepEqual(requests, [state.viewImageDataUri]);
  assert.equal(image.src, "data:image/png;base64,old");
  assert.equal(state.selectedWidgetId, "slider");
  state.viewImageDataUri = "data:image/png;base64,next";
  assert.equal(refresh(), true);
  assert.equal(requests.at(-1), state.viewImageDataUri);
  assert.equal(image.src, "data:image/png;base64,old");
});

test("2D refresh never assigns src on the visible image before decoding", () => {
  const { state, image, refresh } = fixture();
  Object.defineProperty(image, "src", {
    get: () => state.viewImageDataUri,
    set: () => assert.fail("The visible source must not be assigned again")
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
    context => { context.state.twoViewControllers.clear(); },
    context => { context.element.querySelector = () => null; },
    context => { context.element.dataset.widgetId = "different-view"; }
  ]) {
    const context = fixture();
    change(context);
    assert.equal(context.refresh(), false);
    assert.equal(context.image.src, "data:image/png;base64,old");
  }
});

test("all 2D views are validated before requesting any image update", () => {
  const { state, image, mounted, refresh, requests } = fixture();
  const otherHost = {};
  state.interfacePreview.widgets.push({ id: "other", kind: "view" });
  mounted.push({ dataset: { widgetId: "other" }, querySelector: () => null });
  assert.equal(refresh(), false);
  assert.equal(requests.length, 0);
  assert.equal(image.src, "data:image/png;base64,old");
  mounted[1].querySelector = () => otherHost;
  const otherRequests = [];
  state.twoViewControllers.set("other", { host: otherHost, update: source => otherRequests.push(source) });
  assert.equal(refresh(), true);
  assert.deepEqual(requests, [state.viewImageDataUri]);
  assert.deepEqual(otherRequests, [state.viewImageDataUri]);
  assert.equal(image.src, "data:image/png;base64,old");
});

test("runtime result reuses mounted 2D views and still refreshes plots, monitors, and ticks", () => {
  const { state, refresh, requests } = fixture();
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
  assert.equal(requests.at(-1), result.viewImageDataUri);
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

test("2D full renders reuse the presenter and decoded host across layout changes", () => {
  const { state, host, requests } = fixture();
  const render = new Function("state", "node", "createTwoViewFrameQueue", fragment(
    "function renderViewBody(widget)", "function mountThreeView(element)"
  ) + "return renderViewBody;")(state,
    () => assert.fail("The existing view host must be reused"),
    () => assert.fail("The existing queue must be reused"));
  assert.equal(render({ id: "view" }), host);
  state.viewImageDataUri = "next";
  assert.equal(render({ id: "view" }), host);
  assert.deepEqual(requests, ["data:image/png;base64,new", "next"]);
});

test("2D presenters are disposed for removed views, failed exports, and 3D replacement", () => {
  for (const change of [state => { state.viewImageDataUri = null; }, state => { state.view3DState = {}; },
    state => { state.interfacePreview.widgets = []; }]) {
    const { state } = fixture();
    let disposed = 0;
    state.twoViewControllers.get("view").dispose = () => { disposed++; };
    const prune = new Function("state", fragment("function pruneTwoViews(widgets)", "function refreshMountedTwoViews()")
      + "return pruneTwoViews;")(state);
    prune(state.interfacePreview.widgets);
    assert.equal(disposed, 0);
    change(state);
    prune(state.interfacePreview.widgets);
    assert.equal(disposed, 1);
    assert.equal(state.twoViewControllers.size, 0);
  }
});
