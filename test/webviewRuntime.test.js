const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const root = path.join(__dirname, "..");

test("webview exposes a controllable forever run loop", () => {
  const source = fs.readFileSync(path.join(root, "src", "netlogoEditor.ts"), "utf8");
  const commandPromptSource = fs.readFileSync(path.join(root, "src", "commandPrompt.ts"), "utf8");

  assert.match(source, /id="foreverButton"/);
  assert.match(source, /id="commandButton"/);
  assert.match(source, /id="openNativeButton"/);
  assert.match(source, />Open in NetLogo<\/button>/);
  assert.match(source, /id="speedSlider"/);
  assert.match(source, /id="tickCount"/);
  const topbarActions = source.match(/<div class="actions">[\s\S]*?<\/div>\s*<\/header>/)?.[0] ?? "";
  assert.ok(topbarActions.indexOf('id="commandButton"') >= 0);
  assert.ok(topbarActions.indexOf('id="openNativeButton"') > topbarActions.indexOf('id="commandButton"'));
  assert.ok(topbarActions.indexOf('id="speedSlider"') > topbarActions.indexOf('id="openNativeButton"'));
  assert.match(source, /type: "prompt-command"/);
  assert.match(source, /readonly type: "open-native"/);
  assert.match(source, /executeCommand\("netlogo\.openInNetLogo", document\.uri\)/);
  assert.match(source, /promptForNetLogoCommand\(this\.context/);
  assert.match(source, /rememberNetLogoCommand\(this\.context, command\)/);
  assert.match(source, /const command = message\.command\.trim\(\)/);
  assert.match(source, /rememberNetLogoCommand\(this\.context, command\);[\s\S]*?runAndPost\(webviewPanel\.webview, document\.uri, command, \{ showProgress: message\.silent !== true \}\)/);
  assert.match(source, /runAndPost\(webviewPanel\.webview, document\.uri, command, \{ showProgress: true \}\)/);
  assert.match(commandPromptSource, /COMMAND_HISTORY_KEY = "netlogo\.commandHistory"/);
  assert.match(commandPromptSource, /LEGACY_LAST_COMMAND_KEY = "netlogo\.lastCommand"/);
  assert.match(commandPromptSource, /MAX_COMMAND_HISTORY = 8/);
  assert.match(commandPromptSource, /COMMON_NETLOGO_COMMANDS = \[/);
  assert.match(commandPromptSource, /showQuickPick<NetLogoCommandPick>/);
  assert.match(commandPromptSource, /buildNetLogoCommandPicks\(history\)/);
  assert.match(commandPromptSource, /QuickPickItemKind\.Separator/);
  assert.match(commandPromptSource, /Select a command or type a new one/);
  assert.match(commandPromptSource, /showInputBox\(\{/);
  assert.match(commandPromptSource, /value: lastCommand/);
  assert.match(commandPromptSource, /valueSelection: lastCommand \? \[0, lastCommand\.length\] : undefined/);
  assert.match(commandPromptSource, /globalState\.update\(COMMAND_HISTORY_KEY, nextHistory\)/);
  assert.match(commandPromptSource, /globalState\.update\(LEGACY_LAST_COMMAND_KEY, normalizedCommand\)/);
  assert.match(commandPromptSource, /function normalizeNetLogoCommandHistory/);
  assert.match(source, /commandButton\.addEventListener\("click"/);
  assert.match(source, /vscode\.postMessage\(\{ type: "prompt-command" \}\)/);
  assert.match(source, /openNativeButton\.addEventListener\("click"/);
  assert.match(source, /vscode\.postMessage\(\{ type: "open-native" \}\)/);
  assert.match(source, /function startRunLoop\(command, label\)/);
  assert.match(source, /function stopRunLoop\(\)/);
  assert.match(source, /function scheduleRunLoop\(\)/);
  assert.match(source, /function runLoopDelayMs\(\)/);
  assert.match(source, /runLoopDelayMs\(\)\)/);
  assert.match(source, /postRunCommand\(loop\.command, true\)/);
});

test("webview forwards editor save shortcuts to the backing document", () => {
  const source = fs.readFileSync(path.join(root, "src", "netlogoEditor.ts"), "utf8");

  assert.match(source, /readonly type: "save-document"/);
  assert.match(source, /message\.type === "save-document"/);
  assert.match(source, /await document\.save\(\)/);
  assert.match(source, /document\.addEventListener\("keydown"/);
  assert.match(source, /event\.metaKey \|\| event\.ctrlKey/);
  assert.match(source, /event\.key\.toLowerCase\(\) === "s"/);
  assert.match(source, /vscode\.postMessage\(\{ type: "save-document" \}\)/);
});

test("webview separates Interface interaction from layout editing", () => {
  const source = fs.readFileSync(path.join(root, "src", "netlogoEditor.ts"), "utf8");

  assert.match(source, /id="interactModeButton"/);
  assert.match(source, /id="layoutModeButton"/);
  assert.match(source, /interfaceMode: validInterfaceMode\(restoredUiState\.interfaceMode\)/);
  assert.match(source, /function setInterfaceMode\(mode\)/);
  assert.match(source, /state\.interfaceMode !== "layout"/);
  assert.match(source, /runWidgetButton\(widget\)/);
  assert.match(source, /surface\.classList\.toggle\("interact-mode"/);
  assert.match(source, /surface\.classList\.toggle\("layout-mode"/);
});

test("Interface layout clamps slider widgets to a usable minimum height", () => {
  const source = fs.readFileSync(path.join(root, "src", "netlogoEditor.ts"), "utf8");

  assert.match(source, /function normalizeBounds\(bounds, kind\)/);
  assert.match(source, /function widgetMinimumSize\(kind\)/);
  assert.match(source, /slider: \{ width: 90, height: 34 \}/);
  assert.match(source, /height: Math\.max\(minimum\.height, Math\.round\(bounds\.height\)\)/);
  assert.match(source, /normalizeBounds\(\{[\s\S]*?height: interaction\.startHeight \+ dy[\s\S]*?\}, widget\.kind\)/);
  assert.match(source, /pendingBounds: null/);
  assert.match(source, /pendingTransform: null/);
  assert.match(source, /pendingInterfaceRender: false/);
  assert.match(source, /pointerId: event\.pointerId/);
  assert.match(source, /event\.pointerId !== interaction\.pointerId/);
  assert.match(source, /dragProxy: mode === "move" \? createDragProxy\(widget\) : null/);
  assert.match(source, /function schedulePointerInteractionFlush\(interaction\)/);
  assert.match(source, /requestAnimationFrame\(\(\) => \{/);
  assert.match(source, /function flushPointerInteraction\(interaction\)/);
  assert.match(source, /const target = interaction\.dragProxy \?\? interaction\.element/);
  assert.match(source, /target\.style\.transform = "translate3d\("/);
  assert.match(source, /function createDragProxy\(widget\)/);
  assert.match(source, /className = "drag-proxy"/);
  assert.match(source, /function cleanupPointerInteraction\(interaction\)/);
  assert.match(source, /interaction\.dragProxy\?\.remove\(\)/);
  assert.match(source, /function flushPendingInterfaceRender\(\)/);
  assert.match(source, /if \(state\.interaction\) \{[\s\S]*?state\.pendingInterfaceRender = true;[\s\S]*?return;/);
  assert.match(source, /document\.addEventListener\("contextmenu"/);
  assert.match(source, /touch-action: none;/);
  assert.match(source, /interaction\.element\.style\.transform = ""/);
  assert.match(source, /cancelAnimationFrame\(interaction\.frame\)/);
  assert.match(source, /normalizeBounds\(\{[\s\S]*?height: widget\.height \+ deltaY[\s\S]*?\}, widget\.kind\)/);
  assert.match(source, /normalizeBounds\(\{[\s\S]*?height: descriptor\.key === "height" \? Number\(input\.value\) : widget\.height[\s\S]*?\}, widget\.kind\)/);
});

test("webview surfaces runtime configuration and failure status inline", () => {
  const source = fs.readFileSync(path.join(root, "src", "netlogoEditor.ts"), "utf8");

  assert.match(source, /id="runtimeBanner"/);
  assert.match(source, /id="configureRuntimeButton"/);
  assert.match(source, /id="showOutputButton"/);
  assert.match(source, /type: "configure-runtime"/);
  assert.match(source, /type: "show-output"/);
  assert.match(source, /executeCommand\("netlogo\.showOutput"\)/);
  assert.match(source, /runtimeConfigured: this\.isRuntimeConfigured\(document\.uri\)/);
  assert.match(source, /function updateRuntimeBanner\(message\)/);
  assert.match(source, /configureRuntimeButton\.hidden = state\.runtimeStatus !== "not-configured"/);
  assert.match(source, /showOutputButton\.hidden = !text/);
  assert.match(source, /NetLogo runtime not configured/);
  assert.match(source, /Last run failed:/);
});

test("Interface forever buttons toggle the run loop instead of running once", () => {
  const source = fs.readFileSync(path.join(root, "src", "netlogoEditor.ts"), "utf8");

  assert.match(source, /widget\.details\?\.forever/);
  assert.match(source, /const command = widgetRunCommand\(widget\)/);
  assert.match(source, /startRunLoop\(command, widget\.label \|\| widget\.runCommand \|\| command\)/);
  assert.match(source, /stopRunLoop\(\)/);
});

test("Interface buttons respect their NetLogo agent context", () => {
  const source = fs.readFileSync(path.join(root, "src", "netlogoEditor.ts"), "utf8");
  const parserSource = fs.readFileSync(path.join(root, "src", "classicInterface.ts"), "utf8");

  assert.match(parserSource, /buttonType: stringAt\(block, 10\)/);
  assert.match(source, /function widgetRunCommand\(widget\)/);
  assert.match(source, /function toolbarGoCommand\(\)/);
  assert.match(source, /postRunCommand\(toolbarGoCommand\(\), false\)/);
  assert.match(source, /startRunLoop\(toolbarGoCommand\(\), "go"\)/);
  assert.match(source, /buttonType === "TURTLE"/);
  assert.ok(source.includes('return "ask turtles [ " + command + " ]";'));
  assert.match(source, /buttonType === "PATCH"/);
  assert.ok(source.includes('return "ask patches [ " + command + " ]";'));
  assert.match(source, /buttonType === "LINK"/);
  assert.ok(source.includes('return "ask links [ " + command + " ]";'));
});

test("runner can execute webview loop ticks without progress notifications", () => {
  const runnerSource = fs.readFileSync(path.join(root, "src", "runner.ts"), "utf8");
  const editorSource = fs.readFileSync(path.join(root, "src", "netlogoEditor.ts"), "utf8");

  assert.match(runnerSource, /interface NetLogoRunOptions/);
  assert.match(runnerSource, /DEFAULT_COMMAND_TIMEOUT_MS/);
  assert.match(runnerSource, /commandTimeoutMs/);
  assert.match(runnerSource, /cancellable: true/);
  assert.match(runnerSource, /formatDuration\(this\.commandTimeoutMs\)/);
  assert.match(runnerSource, /NetLogo .* timed out after/);
  assert.match(runnerSource, /readonly ticks: string \| null/);
  assert.match(runnerSource, /const ticks = await this\.tryReportTicks\(session\)/);
  assert.match(runnerSource, /return await session\.report\("ticks", \{ showError: false \}\)/);
  assert.match(runnerSource, /private async tryReportMonitor/);
  assert.match(runnerSource, /session\.report\(monitor\.source, \{ showError: false \}\)/);
  assert.match(runnerSource, /return `Error: \$\{message\}`/);
  assert.match(runnerSource, /options\.showProgress === false/);
  assert.match(editorSource, /showProgress: message\.silent !== true/);
  assert.match(editorSource, /state\.ticks = result\.ticks \?\? null/);
  assert.match(editorSource, /function renderTickCount\(\)/);
  assert.match(runnerSource, /verboseOutput", false/);
  assert.match(runnerSource, /logVerbose\(verboseOutput/);
  assert.match(runnerSource, /private logVerbose\(line: string\)/);
});

test("runner saves dirty model documents before headless execution", () => {
  const runnerSource = fs.readFileSync(path.join(root, "src", "runner.ts"), "utf8");

  assert.match(runnerSource, /await saveDocumentIfDirty\(uri\)/);
  assert.match(runnerSource, /async function saveDocumentIfDirty\(uri: vscode\.Uri\): Promise<void>/);
  assert.match(runnerSource, /vscode\.workspace\.textDocuments\.find\(candidate => candidate\.uri\.toString\(\) === uri\.toString\(\)\)/);
  assert.match(runnerSource, /if \(document\?\.isDirty\)/);
  assert.match(runnerSource, /const saved = await document\.save\(\)/);
  assert.match(runnerSource, /if \(!saved\)/);
  assert.match(runnerSource, /NetLogo run cancelled because the model has unsaved changes that could not be saved\./);
});

test("runner reports incompatible model formats with a concise message", () => {
  const runnerSource = fs.readFileSync(path.join(root, "src", "runner.ts"), "utf8");
  const editorSource = fs.readFileSync(path.join(root, "src", "netlogoEditor.ts"), "utf8");

  assert.match(runnerSource, /function formatNetLogoErrorMessage\(error: unknown\)/);
  assert.match(runnerSource, /function stripJavaStackTrace\(message: string\)/);
  assert.match(runnerSource, /Unable to open model with current format/i);
  assert.match(runnerSource, /Unable to run model with current format/);
  assert.ok(runnerSource.includes("NetLogo (?:command|report|run) failed"));
  assert.match(runnerSource, /\\s\+at\\s\+\[A-Za-z_\$]\[\\w\.\$]\*\\\(\[\^\)]\*\\\)/);
  assert.match(runnerSource, /const message = formatNetLogoErrorMessage\(error\)/);
  assert.match(editorSource, /message: formatNetLogoErrorMessage\(error\)/);
  assert.match(editorSource, /setStatus\(displayMessage\)/);
  assert.match(editorSource, /status\.title = message/);
});

test("webview allows exported view images and hides raw Interface source by default", () => {
  const source = fs.readFileSync(path.join(root, "src", "netlogoEditor.ts"), "utf8");

  assert.match(source, /img-src data:/);
  assert.match(source, /#interfaceInput\s*\{\s*display: none;/);
  assert.match(source, /grid-template-rows: auto minmax\(0, 1fr\)/);
  assert.match(source, /\.content\s*\{[\s\S]*?display: grid;[\s\S]*?grid-template-rows: minmax\(0, 1fr\);/);
  assert.match(source, /\.pane\.active\s*\{[\s\S]*?display: grid;[\s\S]*?grid-template-rows: minmax\(0, 1fr\);/);
});

test("webview mounts a local Three.js 3D view when runtime state is available", () => {
  const source = fs.readFileSync(path.join(root, "src", "netlogoEditor.ts"), "utf8");
  const runnerSource = fs.readFileSync(path.join(root, "src", "runner.ts"), "utf8");

  assert.match(source, /resources", "vendor", "three", "three\.module\.min\.js"/);
  assert.match(source, /window\.NetLogoThree = THREE/);
  assert.match(source, /view3DState: null/);
  assert.match(source, /function renderThreeView\(host, viewState, THREE\)/);
  assert.match(source, /function refreshMountedThreeViews\(\)/);
  assert.match(source, /function refreshMountedRuntimeWidgets\(\)/);
  assert.match(source, /controller\.update\(state\.view3DState\)/);
  assert.match(source, /const canRefresh3DOnly = Boolean\(result\.view3DState\)/);
  assert.match(source, /refreshMountedRuntimeWidgets\(\)/);
  assert.match(source, /new THREE\.WebGLRenderer/);
  assert.match(source, /disposeThreeViews\(\)/);
  assert.match(source, /function rebuildAgentLayer\(nextViewState\)/);
  assert.match(source, /agentLayer\.clear\(\)/);
  assert.match(source, /dispose\.update = nextViewState =>/);
  assert.match(source, /function sameThreeBounds\(left, right\)/);
  assert.match(source, /function renderThreeControls\(\)/);
  assert.match(source, /button\.setAttribute\("aria-label", title\)/);
  assert.match(source, /threeBackground: restoredUiState\.threeBackground === "light" \? "light" : "dark"/);
  assert.match(source, /threeInteractionMode: validThreeInteractionMode\(restoredUiState\.threeInteractionMode\)/);
  assert.match(source, /threeControlButton\("orbit", "Orbit"/);
  assert.match(source, /threeControlButton\("zoom", "Zoom"/);
  assert.match(source, /threeControlButton\("move", "Move"/);
  assert.match(source, /threeControlButton\("fullscreen", "Full", "Toggle full screen"\)/);
  assert.match(source, /function updateThreeControlsActive\(container\)/);
  assert.match(source, /function panThreeCamera\(dx, dy, start\)/);
  assert.match(source, /function toggleThreeFullscreen\(targetHost\)/);
  assert.match(source, /requestFullscreen/);
  assert.match(source, /fullscreen-fallback/);
  assert.match(source, /document\.addEventListener\("fullscreenchange", handleFullscreenChange\)/);
  assert.match(source, /document\.removeEventListener\("fullscreenchange", handleFullscreenChange\)/);
  assert.match(source, /targetX: baseTarget\.x/);
  assert.match(source, /controls\.targetX = start\.targetX \+ pan\.x/);
  assert.match(source, /function addThreeWorldBox\(scene, THREE, bounds\)/);
  assert.doesNotMatch(source, /GridHelper/);
  assert.doesNotMatch(source, /function addThreeAxes/);
  assert.match(source, /function addThreePatches\(scene, THREE, patches, pickables\)/);
  assert.match(source, /new THREE\.MeshBasicMaterial/);
  assert.match(source, /new THREE\.InstancedMesh/);
  assert.match(source, /const pickables = \[\]/);
  assert.match(source, /function addThreeTurtles\(scene, THREE, turtles, pickables\)/);
  assert.match(source, /function turtleGeometryKey\(shape\)/);
  assert.match(source, /const color = threeColorHex\(turtle\)/);
  assert.match(source, /const key = geometryKey \+ "\|" \+ color/);
  assert.match(source, /color: group\.color/);
  assert.match(source, /mesh\.setMatrixAt\(index, matrix\)/);
  assert.match(source, /function addThreeLabels\(scene, THREE, turtles, links\)/);
  assert.match(source, /new THREE\.CanvasTexture\(canvas\)/);
  assert.match(source, /function describeThreeHit\(hit\)/);
  assert.match(source, /function renderThreeInspector\(container, hit\)/);
  assert.match(source, /function threeInspectionDetails\(hit\)/);
  assert.match(source, /node\("div", "three-inspector"/);
  assert.match(source, /three-inspector-row/);
  assert.match(source, /raycaster\.intersectObjects\(pickables, false\)/);
  assert.match(source, /function addThreeLinkArrow\(scene, THREE, start, end, color, size\)/);
  assert.match(source, /function formatThreeColor\(value, rgb\)/);
  assert.match(source, /function threeColorHex\(item, colorKey = "color", rgbKey = "colorRgb"\)/);
  assert.match(source, /function rgbValueToHex\(rgb\)/);
  assert.match(source, /function clampRgbChannel\(value\)/);
  assert.match(source, /function mixRgb\(left, right, amount\)/);
  assert.match(source, /function rgbToHex\(red, green, blue\)/);
  assert.match(runnerSource, /readonly view3DState: View3DState \| null/);
  assert.match(runnerSource, /private async tryReportView3D/);
  assert.match(runnerSource, /private async tryReport3DList/);
  assert.match(runnerSource, /min-pzcor max-pzcor/);
  assert.match(runnerSource, /readonly patches: readonly Patch3DValue\[\]/);
  assert.match(runnerSource, /export interface Rgb3DValue/);
  assert.match(runnerSource, /readonly colorRgb\?: Rgb3DValue/);
  assert.match(runnerSource, /readonly shape\?: string/);
  assert.match(runnerSource, /readonly directed\?: boolean/);
  assert.match(runnerSource, /label-color/);
  assert.match(runnerSource, /extract-rgb color/);
  assert.match(runnerSource, /extract-rgb pcolor/);
  assert.match(runnerSource, /function parseRgb3DValue\(parts: string\[\], start: number\)/);
  assert.match(runnerSource, /is-directed-link\? self/);
  assert.match(runnerSource, /n-of \(min \(list 5000 count patches with \[pcolor != black\]\)\) patches with \[pcolor != black\]/);
  assert.match(runnerSource, /export function parseNetLogoDelimitedList/);
  assert.match(runnerSource, /function parseQuotedNetLogoString/);
});

test("webview persists local editor and 3D viewer preferences", () => {
  const source = fs.readFileSync(path.join(root, "src", "netlogoEditor.ts"), "utf8");

  assert.match(source, /const restoredUiState = vscode\.getState\?\.\(\) \?\? \{\}/);
  assert.match(source, /activeTab: validUiTab\(restoredUiState\.activeTab\)/);
  assert.match(source, /infoEditing: Boolean\(restoredUiState\.infoEditing\)/);
  assert.match(source, /interfaceMode: validInterfaceMode\(restoredUiState\.interfaceMode\)/);
  assert.match(source, /runSpeed: restoredRunSpeed\(restoredUiState\.runSpeed\)/);
  assert.match(source, /threeCamera: sanitizeThreeCamera\(restoredUiState\.threeCamera\)/);
  assert.match(source, /function persistUiState\(\)/);
  assert.match(source, /vscode\.setState\?\.\(\{/);
  assert.match(source, /function validUiTab\(tab\)/);
  assert.match(source, /function validThreeInteractionMode\(mode\)/);
  assert.match(source, /function sanitizeThreeCamera\(camera\)/);
  assert.match(source, /setInterfaceMode\(state\.interfaceMode\)/);
  assert.match(source, /activateTab\(state\.activeTab\)/);
  assert.match(source, /speedSlider\.value = String\(state\.runSpeed\)/);
  assert.match(source, /const speed = clampNumber\(Number\(state\.runSpeed\), -5, 5\)/);
});

test("vendored Three.js module dependencies are packaged", () => {
  const threeDir = path.join(root, "resources", "vendor", "three");
  const moduleSource = fs.readFileSync(path.join(threeDir, "three.module.min.js"), "utf8");
  const relativeImports = [...moduleSource.matchAll(/from"(\.\/[^"]+)"/g)].map(match => match[1]);

  assert.ok(relativeImports.length > 0);
  for (const relativeImport of relativeImports) {
    assert.ok(fs.existsSync(path.join(threeDir, relativeImport)), `${relativeImport} is missing`);
  }
});

test("webview parses NetLogo export-plot CSV data rows", () => {
  const source = fs.readFileSync(path.join(root, "src", "netlogoEditor.ts"), "utf8");

  assert.match(source, /function parseCsvLine\(row\)/);
  assert.match(source, /cells\[0\]\?\.toLowerCase\(\) === "x" && cells\[1\]\?\.toLowerCase\(\) === "y"/);
  assert.match(source, /points\.push\(\[x, y\]\)/);
});

test("webview plots include axes ticks and axis titles", () => {
  const source = fs.readFileSync(path.join(root, "src", "netlogoEditor.ts"), "utf8");

  assert.match(source, /function renderPlotAxes\(svg, frame, xDomain, yDomain, widget\)/);
  assert.match(source, /function axisTicks\(domain\)/);
  assert.match(source, /plot-tick-label/);
  assert.match(source, /plot-axis-label/);
  assert.match(source, /axisLabel\(widget\.details\?\.xAxis, "x"\)/);
  assert.match(source, /axisLabel\(widget\.details\?\.yAxis, "y"\)/);
});

test("webview plot domains expand to include exported data", () => {
  const source = fs.readFileSync(path.join(root, "src", "netlogoEditor.ts"), "utf8");

  assert.match(source, /function plotDomain\(points, widget, axis\)/);
  assert.match(source, /\.filter\(value => Number\.isFinite\(value\)\)/);
  assert.match(source, /dataMin >= configuredMin && dataMax <= configuredMax/);
  assert.match(source, /return \[configuredMin, configuredMax\]/);
  assert.match(source, /Math\.min\(dataMin, configuredMin\)/);
  assert.match(source, /Math\.max\(dataMax, configuredMax\)/);
  assert.match(source, /function clampPlotCoordinate\(value, min, max\)/);
  assert.match(source, /clampPlotCoordinate\(scaleLinear\(point\[1\], yDomain, frame\.bottom, frame\.top\), frame\.top, frame\.bottom\)/);
});

test("webview plot ticks use grouped labels and dynamic margins", () => {
  const source = fs.readFileSync(path.join(root, "src", "netlogoEditor.ts"), "utf8");

  assert.match(source, /function plotFrameForDomains\(xDomain, yDomain\)/);
  assert.match(source, /estimateTickLabelWidth\(formatTick\(tick\)\)/);
  assert.match(source, /left: clampNumber\(16 \+ yLabelWidth, 28, 76\)/);
  assert.match(source, /bottom: 80/);
  assert.match(source, /xTickY: 93/);
  assert.match(source, /xLabelY: 110/);
  assert.match(source, /frame\.xTickY/);
  assert.match(source, /frame\.xLabelY/);
  assert.match(source, /new Intl\.NumberFormat\("en-US", formatterOptions\)\.format\(value\)/);
  assert.match(source, /useGrouping: true/);
  assert.match(source, /index === 0 \? "start" : index === xTicks\.length - 1 \? "end" : "middle"/);
});

test("Info tab renders Markdown and toggles to source editing", () => {
  const source = fs.readFileSync(path.join(root, "src", "netlogoEditor.ts"), "utf8");

  assert.match(source, /id="infoPreview"/);
  assert.match(source, /id="infoToggleButton"/);
  assert.match(source, /function setInfoEditing\(editing, selectionOffset, anchorRatio\)/);
  assert.match(source, /function markdownToNodes\(markdown\)/);
  assert.match(source, /function appendInlineMarkdown\(parent, text, sourceStart\)/);
  assert.match(source, /infoPreview\.addEventListener\("click"/);
});

test("Info preview clicks reveal the matching source offset", () => {
  const source = fs.readFileSync(path.join(root, "src", "netlogoEditor.ts"), "utf8");

  assert.match(source, /function setSourceRange\(element, start, end\)/);
  assert.match(source, /dataset\.sourceStart/);
  assert.match(source, /function findInfoSourceOffset\(event\)/);
  assert.match(source, /function caretRangeFromEvent\(event\)/);
  assert.match(source, /function sourceOffsetFromRange\(range\)/);
  assert.match(source, /function infoClickAnchor\(event\)/);
  assert.match(source, /function revealEditableOffset\(editor, offset, anchorRatio\)/);
  assert.match(source, /setInfoEditing\(true, findInfoSourceOffset\(event\), infoClickAnchor\(event\)\)/);
  assert.match(source, /revealEditableOffset\(infoEditorSurface, selectionOffset, anchorRatio\)/);
  assert.match(source, /id="infoEditorSurface" class="highlight-editor markdown-editor hidden" contenteditable="true"/);
  assert.match(source, /id="infoInput" class="source-buffer hidden" spellcheck="true" wrap="soft" aria-hidden="true"/);
  assert.doesNotMatch(source, /id="infoEditor" class="editor-with-gutter hidden"/);
  assert.doesNotMatch(source, /id="infoLineNumbers" class="line-gutter"/);
  assert.doesNotMatch(source, /syncInfoHighlightScroll\(\)/);
  assert.match(source, /\.source-buffer\s*\{[\s\S]*?opacity: 0;[\s\S]*?pointer-events: none;/);
  assert.match(source, /#infoEditorSurface\s*\{[\s\S]*?height: var\(--info-editor-height/);
  assert.match(source, /inputs\.info\.wrap = "soft"/);
  assert.match(source, /setInputValue\(inputs\.info, state\.info\)/);
  assert.match(source, /function updateEditorLayout\(\)/);
  assert.match(source, /infoEditorSurface\.classList\.toggle\("hidden", !state\.infoEditing\)/);
  assert.match(source, /infoEditorSurface\.style\.height = infoEditorHeight \+ "px"/);
  assert.match(source, /function appendHighlightedMarkdown\(parent, source\)/);
  assert.match(source, /md-heading/);
});

test("Code tab uses the simple editable NetLogo source surface", () => {
  const source = fs.readFileSync(path.join(root, "src", "netlogoEditor.ts"), "utf8");
  const codeSurfaceBlock = [...source.matchAll(/^    #codeEditorSurface\s*\{([\s\S]*?)^    \}/gm)]
    .map(match => match[1])
    .find(block => block.includes("--content-height")) ?? "";

  assert.match(source, /id="codeHighlight"/);
  assert.match(source, /id="codeLineNumbers" class="code-line-numbers" aria-hidden="true"/);
  assert.match(source, /id="codeEditorSurface" class="highlight-editor netlogo-editor" contenteditable="true"/);
  assert.match(source, /id="codeInput" class="source-buffer" spellcheck="false" wrap="off" aria-hidden="true"/);
  assert.doesNotMatch(source, /-webkit-text-fill-color: transparent/);
  assert.match(source, /class="code-editor"/);
  assert.match(source, /function renderCodeHighlight\(\)/);
  assert.match(source, /function renderCodeLineNumbers\(\)/);
  assert.match(source, /function appendHighlightedNetLogoLine\(parent, line\)/);
  assert.match(source, /function classifyNetLogoToken\(token\)/);
  assert.match(source, /netLogoKeywords/);
  assert.match(source, /netLogoPrimitives/);
  assert.match(source, /function syncCodeHighlightScroll\(\)/);
  assert.match(source, /codeEditorSurface\.addEventListener\("scroll", syncCodeHighlightScroll\)/);
  assert.match(source, /codeLineNumbers\.scrollTop = codeEditorSurface\.scrollTop/);
  assert.match(source, /setInputValue\(inputs\.code, state\.code\)/);
  assert.match(source, /codeEditorSurface\.focus\(\)/);
  assert.match(source, /\.code-highlight\s*\{[\s\S]*?display: none;/);
  assert.match(source, /\.code-line-numbers\s*\{[\s\S]*?pointer-events: none;/);
  assert.match(source, /\.code-editor\s*\{[\s\S]*?display: grid;[\s\S]*?grid-template-rows: minmax\(0, 1fr\);/);
  assert.match(codeSurfaceBlock, /height: var\(--content-height/);
  assert.match(codeSurfaceBlock, /padding-left: calc\(var\(--code-gutter-width\) \+ 16px\)/);
  assert.match(source, /codeEditorSurface\.style\.height = contentHeight \+ "px"/);
  assert.match(source, /function renderHighlightedEditable\(target, source, renderer, preserveSelection\)/);
  assert.match(source, /function syncHighlightedEditor\(section, editor, input\)/);
  assert.match(source, /function handleHighlightedEditorKeyDown\(event, editor, input, section\)/);
  assert.match(source, /function insertEditableText\(editor, text\)/);
  assert.match(source, /const codeEditorActive = document\.activeElement === codeEditorSurface/);
  assert.match(source, /if \(!codeEditorActive\) \{[\s\S]*?setInputValue\(inputs\.code, state\.code\)/);
  assert.doesNotMatch(source, /function handleSourceEditorKeyDown\(event, input, section\)/);
  assert.doesNotMatch(source, /function insertTextAreaText\(input, text\)/);
});

test("Code editor uses a visual line-number gutter without adding one to Info", () => {
  const source = fs.readFileSync(path.join(root, "src", "netlogoEditor.ts"), "utf8");

  assert.doesNotMatch(source, /\.editor-with-gutter\s*\{/);
  assert.doesNotMatch(source, /\.line-gutter\s*\{/);
  assert.match(source, /const codeLineNumbers = document\.getElementById\("codeLineNumbers"\)/);
  assert.match(source, /function renderCodeLineNumbers\(\)/);
  assert.doesNotMatch(source, /infoLineNumbers/);
  assert.doesNotMatch(source, /function renderLineNumbers/);
  assert.doesNotMatch(source, /measureLineNumbers/);
  assert.doesNotMatch(source, /syncLineNumbers/);
  assert.match(source, /codeEditorSurface\.addEventListener\("input"/);
  assert.match(source, /infoEditorSurface\.addEventListener\("input"/);
});

test("Slider value units reserve visible space instead of truncating", () => {
  const source = fs.readFileSync(path.join(root, "src", "netlogoEditor.ts"), "utf8");
  const sliderRowBlock = [...source.matchAll(/^    \.slider-row\s*\{([\s\S]*?)^    \}/gm)]
    .map(match => match[1])
    .find(block => block.includes("grid-template-columns")) ?? "";
  const controlValueBlock = [...source.matchAll(/^    \.control-value\s*\{([\s\S]*?)^    \}/gm)]
    .map(match => match[1])
    .find(block => block.includes("white-space: nowrap")) ?? "";

  assert.match(sliderRowBlock, /display: grid;/);
  assert.match(sliderRowBlock, /grid-template-columns: minmax\(0, 1fr\) max-content;/);
  assert.match(controlValueBlock, /overflow: visible;/);
  assert.doesNotMatch(controlValueBlock, /text-overflow: ellipsis;/);
  assert.match(source, /node\("span", "control-value", detailText\(widget, \["value", "units"\], ""\)\)/);
});
