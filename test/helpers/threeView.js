const Module = require("node:module");

function threeViewSource(editorPath = require.resolve("../../out/netlogoEditor")) {
  const originalLoad = Module._load;
  let NetLogoModelEditorProvider;
  try {
    Module._load = function (request, parent, isMain) {
      return request === "vscode"
        ? { Uri: { joinPath: (_base, ...parts) => ({ toString: () => parts.join("/") }) }, workspace: {}, window: {} }
        : originalLoad.call(this, request, parent, isMain);
    };
    ({ NetLogoModelEditorProvider } = require(editorPath));
  } finally {
    Module._load = originalLoad;
  }
  const html = new NetLogoModelEditorProvider({ extensionUri: {} }, {}).getHtml({ cspSource: "test", asWebviewUri: value => value });
  const script = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].at(-1)[1];
  return script.slice(script.indexOf("function renderThreeView("), script.indexOf("function renderPlotBody("));
}

function threeViewFunctions(state = {}, editorPath) {
  return new Function("state", "THREE_INSTANCE_CHUNK_SIZE", "clampNumber", threeViewSource(editorPath) + `
    return { addThreePatches, addThreeTurtles, addThreeLinks, threeHitItem, threePatchSource,
      threePatchGroups, threeCameraClipping, threeObserverCameraControls, cameraPose, geometryDispose,
      renderThreePackedTrailSegments,
      addThreeTransparency: typeof addThreeTransparency === "function" ? addThreeTransparency : undefined,
      threeTransparentObjectOrder: typeof threeTransparentObjectOrder === "function" ? threeTransparentObjectOrder : undefined };
  `)(state, 60000, (value, min, max) => Math.min(max, Math.max(min, value)));
}

module.exports = { threeViewSource, threeViewFunctions };
