const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const root = path.join(__dirname, "..");

test("webview exposes a controllable forever run loop", () => {
  const source = fs.readFileSync(path.join(root, "src", "netlogoEditor.ts"), "utf8");
  const commandPromptSource = fs.readFileSync(path.join(root, "src", "commandPrompt.ts"), "utf8");

  assert.match(source, /id="foreverButton"/);
  assert.match(source, /\.actions button\s*\{[\s\S]*?display: inline-flex;[\s\S]*?align-items: center;[\s\S]*?justify-content: center;[\s\S]*?height: 28px;[\s\S]*?padding-top: 0;[\s\S]*?padding-bottom: 0;/);
  assert.match(source, /\.status\s*\{[\s\S]*?display: inline-flex;[\s\S]*?width: 35ch;[\s\S]*?min-width: 35ch;[\s\S]*?min-height: 28px;[\s\S]*?overflow-x: auto;[\s\S]*?overflow-y: hidden;[\s\S]*?border: 1px solid var\(--vscode-input-border, var\(--vscode-panel-border\)\);[\s\S]*?background: var\(--vscode-editorWidget-background\);[\s\S]*?scrollbar-width: thin;/);
  assert.match(source, /\.status::-webkit-scrollbar\s*\{[\s\S]*?height: 4px;/);
  assert.match(source, /\.run-controls\s*\{[\s\S]*?display: inline-flex;[\s\S]*?align-items: center;[\s\S]*?gap: 6px;/);
  assert.match(source, /#foreverButton\s*\{[\s\S]*?width: 68px;[\s\S]*?min-width: 68px;/);
  assert.match(source, /id="commandButton"/);
  assert.match(source, /id="openNativeButton"/);
  assert.match(source, />Open in NetLogo<\/button>/);
  assert.match(source, /id="speedLabel" class="speed-label">normal speed<\/span>/);
  assert.match(source, /class="speed-normal-mark" aria-hidden="true"/);
  assert.match(source, /id="speedSlider"/);
  assert.match(source, /min="-110" max="112" step="1"/);
  assert.match(source, /id="tickCount"/);
  assert.match(source, /foreverButton\.textContent = running \? "Stop" : "Forever"/);
  assert.match(source, /foreverButton\.classList\.toggle\("running", running\)/);
  const topbarActions = source.match(/<div class="actions">[\s\S]*?<\/div>\s*<\/header>/)?.[0] ?? "";
  assert.ok(topbarActions.indexOf('id="status"') >= 0);
  assert.ok(topbarActions.indexOf('id="commandButton"') >= 0);
  assert.ok(topbarActions.indexOf('id="commandButton"') > topbarActions.indexOf('id="status"'));
  assert.ok(topbarActions.indexOf('id="openNativeButton"') > topbarActions.indexOf('id="commandButton"'));
  assert.ok(topbarActions.indexOf('id="speedSlider"') > topbarActions.indexOf('id="openNativeButton"'));
  assert.ok(topbarActions.indexOf('id="tickCount"') > topbarActions.indexOf('id="speedSlider"'));
  assert.ok(topbarActions.indexOf('id="setupButton"') > topbarActions.indexOf('id="tickCount"'));
  assert.ok(topbarActions.indexOf('id="goButton"') > topbarActions.indexOf('id="setupButton"'));
  assert.ok(topbarActions.indexOf('id="foreverButton"') > topbarActions.indexOf('id="goButton"'));
  assert.match(source, /type: "prompt-command"/);
  assert.match(source, /readonly type: "open-native"/);
  assert.match(source, /executeCommand\("netlogo\.openInNetLogo", document\.uri\)/);
  assert.match(source, /promptForNetLogoCommand\(this\.context/);
  assert.match(source, /rememberNetLogoCommand\(this\.context, command\)/);
  assert.match(source, /const command = message\.command\.trim\(\)/);
  assert.ok(source.indexOf('window.addEventListener("message"') < source.indexOf('vscode.postMessage({ type: "ready" })'));
  assert.match(source, /rememberNetLogoCommand\(this\.context, command\);[\s\S]*?runAndPost\(webviewPanel\.webview, document\.uri, command, \{ showProgress: message\.silent !== true \}\)/);
  assert.match(source, /runAndPost\(webviewPanel\.webview, document\.uri, command, \{ showProgress: true \}\)/);
  assert.match(source, /await this\.postRuntimeResult\(webview, result\)/);
  assert.match(source, /const delivered = await webview\.postMessage/);
  assert.match(source, /if \(!delivered\)/);
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
  assert.match(source, /function runLoopBatchSize\(\)/);
  assert.match(source, /RUN_SPEED_DEFAULT_FRAME_RATE = 30/);
  assert.match(source, /RUN_SPEED_MAX_BATCH = 256/);
  assert.ok(source.indexOf("const RUN_SPEED_RAW_MIN") < source.indexOf("const state = {"));
  assert.match(source, /function runSpeedPosition\(\)/);
  assert.match(source, /defaultFrameRate \+ speed - 1 \+ Math\.pow\(1\.3, speed\)/);
  assert.match(source, /defaultFrameRate \* Math\.pow\(0\.9, -speed\)/);
  assert.match(source, /Math\.pow\(Math\.pow\(9000, 0\.02\), -speed\)/);
  assert.match(source, /speed <= 25/);
  assert.match(source, /Math\.min\(RUN_SPEED_MAX_BATCH, Math\.max\(1, tickGap\)\)/);
  assert.match(source, /loop\.requestStartedAt = performance\.now\(\)/);
  assert.match(source, /Math\.max\(0, runLoopDelayMs\(\) - requestElapsed\)/);
  assert.match(source, /function runSpeedLabel\(\)/);
  assert.match(source, /return "normal speed"/);
  assert.match(source, /return "faster"/);
  assert.match(source, /return "slower"/);
  assert.match(source, /speedLabel\.textContent = label/);
  assert.match(source, /\}, remainingDelay\)/);
  assert.match(source, /postRunCommand\(loop\.command, true, runLoopBatchSize\(\)\)/);
  assert.match(source, /readonly repeat\?: number/);
  assert.match(source, /const executionCommand = repeat > 1 \? `repeat \$\{repeat\} \[ \$\{command\} \]` : command/);
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
  assert.match(source, /if \(state\.interfaceMode === "interact"\) \{\s*state\.selectedWidgetId = null;\s*\}/);
  assert.match(source, /deleteWidgetButton\.hidden = state\.interfaceMode !== "layout"/);
  assert.match(source, /id="deleteWidgetButton" type="button" hidden disabled/);
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
  assert.match(source, /\.runtime-banner\s*\{[\s\S]*?color: #241a0a;[\s\S]*?background: #e6c07a;[\s\S]*?font-weight: 600;/);
  assert.match(source, /#runtimeBannerText\s*\{[\s\S]*?flex: 1;[\s\S]*?min-width: 0;[\s\S]*?text-overflow: ellipsis;/);
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
  assert.match(source, /threeBackground: restoredThreeBackground\(restoredUiState\)/);
  assert.match(source, /threeInteractionMode: validThreeInteractionMode\(restoredUiState\.threeInteractionMode\)/);
  assert.match(source, /threeTrailState: null/);
  assert.match(source, /threeObserverCameraKey: null/);
  assert.match(source, /threeManualRadius: null/);
  assert.match(source, /threeControlButton\("orbit", "Orbit"/);
  assert.match(source, /threeControlButton\("zoom", "Zoom"/);
  assert.match(source, /threeControlButton\("move", "Move"/);
  assert.match(source, /threeControlButton\("fullscreen", "Full", "Toggle full screen"\)/);
  assert.match(source, /function updateThreeControlsActive\(container\)/);
  assert.match(source, /function updateThreeTheme\(scene, worldBox, controlsBar, THREE\)/);
  assert.match(source, /updateThreeTheme\(scene, worldBox, controlsBar, THREE\)/);
  assert.doesNotMatch(source, /if \(action === "background"\) \{[\s\S]*?renderInterface\(\);[\s\S]*?return;/);
  assert.match(source, /function panThreeCamera\(dx, dy, start\)/);
  assert.match(source, /function applyThreeObserverCamera\(viewState\)/);
  assert.match(source, /function clampThreeRadius\(value\)/);
  assert.match(source, /function threeObserverCameraControls\(observer, baseTarget, span\)/);
  assert.match(source, /theta: Math\.atan2\(-dx, dz\)/);
  assert.match(source, /function threeObserverCameraKey\(observer\)/);
  assert.match(source, /state\.threeObserverCameraKey = key/);
  assert.match(source, /saveThreeCamera\(useManualRadius = false\)/);
  assert.match(source, /state\.threeManualRadius = controls\.radius/);
  assert.match(source, /saveThreeCamera\(drag\.mode === "zoom"\)/);
  assert.match(source, /saveThreeCamera\(true\)/);
  assert.match(source, /state\.threeManualRadius = null/);
  assert.match(source, /state\.threeManualRadius[\s\S]*observerControls\.radius/);
  assert.match(source, /function toggleThreeFullscreen\(targetHost\)/);
  assert.match(source, /requestFullscreen/);
  assert.match(source, /fullscreen-fallback/);
  assert.match(source, /document\.addEventListener\("fullscreenchange", handleFullscreenChange\)/);
  assert.match(source, /document\.removeEventListener\("fullscreenchange", handleFullscreenChange\)/);
  assert.match(source, /targetX: baseTarget\.x/);
  assert.match(source, /controls\.targetX = start\.targetX \+ pan\.x/);
  assert.match(source, /bounds\.maxX - bounds\.minX \+ 1/);
  assert.match(source, /bounds\.maxY - bounds\.minY \+ 1/);
  assert.match(source, /bounds\.maxZ - bounds\.minZ \+ 1/);
  assert.match(source, /function addThreeWorldBox\(scene, THREE, bounds\)/);
  assert.match(source, /function threeWorldEdgeBounds\(THREE, bounds\)/);
  assert.match(source, /bounds\.minX - 0\.5/);
  assert.match(source, /bounds\.minY - 0\.5/);
  assert.match(source, /bounds\.minZ - 0\.5/);
  assert.match(source, /bounds\.maxX \+ 0\.5/);
  assert.match(source, /bounds\.maxY \+ 0\.5/);
  assert.match(source, /bounds\.maxZ \+ 0\.5/);
  assert.doesNotMatch(source, /GridHelper/);
  assert.doesNotMatch(source, /function addThreeAxes/);
  assert.match(source, /function addThreeLights\(scene, THREE\)/);
  assert.match(source, /new THREE\.AmbientLight/);
  assert.match(source, /new THREE\.DirectionalLight/);
  assert.match(source, /function addThreePatches\(scene, THREE, patches, pickables\)/);
  assert.match(source, /const groups = new Map\(\)/);
  assert.doesNotMatch(source, /new THREE\.MeshBasicMaterial/);
  assert.doesNotMatch(source, /mesh\.setColorAt/);
  assert.match(source, /new THREE\.MeshLambertMaterial/);
  assert.doesNotMatch(source, /opacity:\s*0\.88/);
  assert.match(source, /const trailLayer = new THREE\.Group\(\)/);
  assert.match(source, /ensureThreeTrailState\(bounds, span\)/);
  assert.match(source, /function ensureThreeTrailState\(bounds, span\)/);
  assert.match(source, /function createThreeTrailState\(boundsKey, span\)/);
  assert.match(source, /source: "turtle"/);
  assert.match(source, /function updateThreePenTrails\(layer, THREE, trailState, viewState\)/);
  assert.match(source, /function renderThreePackedTrailSegments\(layer, THREE, data\)/);
  assert.match(source, /function threeDrawingBytes\(data\)/);
  assert.match(source, /data instanceof ArrayBuffer/);
  assert.match(source, /magic !== 0x4e4c4433/);
  assert.match(source, /new DataView\(bytes\.buffer/);
  assert.match(source, /!\[1, 2\]\.includes\(version\)/);
  assert.match(source, /const batches = \[\]/);
  assert.match(source, /const positions = new Float32Array\(batch\.count \* 6\)/);
  assert.match(source, /new THREE\.Uint16BufferAttribute\(colors, 3, true\)/);
  assert.match(source, /vertexColors: true/);
  assert.match(source, /lines\.renderOrder = batchIndex/);
  assert.match(source, /function renderThreeTrailSegments\(layer, THREE, segments\)/);
  assert.match(source, /function threeDrawingLineSegments\(lines, maxSegments\)/);
  assert.match(source, /function threeDrawingLineEnd\(line\)/);
  assert.match(source, /viewState\.drawingLines/);
  assert.match(source, /Math\.max\(trailState\.maxSegments, drawingLines\.length\)/);
  assert.match(source, /trailState\.source = "drawing"/);
  assert.match(source, /trailState\.source === "drawing-packed"[\s\S]*?clearThreeTrailState\(layer, trailState\)/);
  assert.match(source, /new THREE\.LineSegments\(geometry, material\)/);
  assert.match(source, /function threePenIsDown\(turtle\)/);
  assert.match(source, /maxNewTurtleDistance/);
  assert.match(source, /nearestThreeTrailPrevious\(point, trailState\.previous, trailState\.maxNewTurtleDistance\)/);
  assert.match(source, /function nearestThreeTrailPrevious\(point, previous, maxDistance\)/);
  assert.match(source, /function threeBoundsKey\(bounds\)/);
  assert.match(source, /sharesPreviousTurtle/);
  assert.match(source, /turtle\.penMode/);
  assert.match(source, /Math\.max\(0\.01, rawSize\)/);
  assert.match(source, /const THREE_INSTANCE_CHUNK_SIZE = 60000/);
  assert.doesNotMatch(source, /THREE_LINE_TURTLE_THRESHOLD/);
  assert.doesNotMatch(source, /raycaster\.params\.Points/);
  assert.match(source, /function forEachThreeChunk\(items, size, visit\)/);
  assert.match(source, /forEachThreeChunk\(group\.items, THREE_INSTANCE_CHUNK_SIZE, chunk =>/);
  assert.doesNotMatch(source, /function addThreeTurtleLineCloud/);
  assert.doesNotMatch(source, /lineCloud: true/);
  assert.doesNotMatch(source, /new THREE\.PointsMaterial/);
  assert.match(source, /new THREE\.InstancedMesh/);
  assert.match(source, /const pickables = \[\]/);
  assert.match(source, /function addThreeTurtles\(scene, THREE, turtles, pickables\)/);
  assert.match(source, /function addThreeLineTurtleGroup\(scene, THREE, group, pickables\)/);
  assert.match(source, /lineItems: true/);
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
  assert.match(source, /function threeHitItem\(hit\)/);
  assert.match(source, /Math\.floor\(\(Number\(hit\.index\) \|\| 0\) \/ 2\)/);
  assert.match(source, /node\("div", "three-inspector"/);
  assert.match(source, /three-inspector-row/);
  assert.match(source, /function displayThreeCount\(total, rendered\)/);
  assert.match(source, /function displayThreeCoverage\(total, rendered\)/);
  assert.match(source, /raycaster\.intersectObjects\(pickables, false\)/);
  assert.match(source, /function addThreeLinkArrow\(scene, THREE, start, end, color, opacity, size\)/);
  assert.match(source, /function formatThreeColor\(value, rgb\)/);
  assert.match(source, /function threeColorHex\(item, colorKey = "color", rgbKey = "colorRgb"\)/);
  assert.match(source, /function rgbValueToHex\(rgb\)/);
  assert.match(source, /function clampRgbChannel\(value\)[\s\S]*?Math\.trunc/);
  assert.match(source, /const rawPalette = \[/);
  assert.match(source, /function threeOpacity\(item, alphaKey = "alpha"\)/);
  assert.match(source, /function rgbToHex\(red, green, blue\)/);
  assert.match(source, /renderer\.outputColorSpace = THREE\.SRGBColorSpace/);
  assert.match(source, /renderer\.toneMapping = THREE\.NoToneMapping/);
  assert.match(source, /texture\.colorSpace = THREE\.SRGBColorSpace/);
  assert.match(runnerSource, /readonly view3DState: View3DState \| null/);
  assert.match(runnerSource, /private async tryReportView3D/);
  assert.match(runnerSource, /NetLogoCommandBridge\.sha256/);
  assert.match(runnerSource, /function fileSha256\(filePath: string\)/);
  assert.match(runnerSource, /private async tryReportView3DObserver/);
  assert.match(runnerSource, /private async tryReportDrawing3D/);
  assert.match(runnerSource, /private async tryReport3DCount/);
  assert.match(runnerSource, /private async tryReport3DList/);
  assert.match(runnerSource, /min-pzcor max-pzcor/);
  assert.match(runnerSource, /readonly observer\?: Observer3DValue/);
  assert.match(runnerSource, /export interface Observer3DValue/);
  assert.match(runnerSource, /list __oxcor __oycor __ozcor/);
  assert.match(runnerSource, /function parseView3DObserver\(value: string\)/);
  assert.match(runnerSource, /readonly turtleCount\?: number/);
  assert.match(runnerSource, /readonly linkCount\?: number/);
  assert.match(runnerSource, /readonly patchCount\?: number/);
  assert.match(runnerSource, /readonly drawingLineCount\?: number/);
  assert.match(runnerSource, /readonly drawingData\?: ArrayBuffer/);
  assert.match(runnerSource, /function exactArrayBuffer\(value: Buffer\): ArrayBuffer/);
  assert.match(runnerSource, /readonly patches: readonly Patch3DValue\[\]/);
  assert.match(runnerSource, /readonly drawingLines: readonly DrawingLine3DValue\[\]/);
  assert.match(runnerSource, /export interface DrawingLine3DValue/);
  assert.match(runnerSource, /readonly heading\?: number/);
  assert.match(runnerSource, /readonly pitch\?: number/);
  assert.match(runnerSource, /readonly length\?: number/);
  assert.match(runnerSource, /private static readonly drawing3DMarker = "__NETLOGO_DRAWING_3D__"/);
  assert.match(runnerSource, /public async reportDrawing3D\(\)/);
  assert.match(runnerSource, /public async exportDrawing3D\(filePath: string, maxLines: number\)/);
  assert.match(runnerSource, /public async exportDrawing3DBinary\(filePath: string\)/);
  assert.match(runnerSource, /public async exportReport\(reporter: string, filePath: string\)/);
  assert.match(runnerSource, /private async reportDrawing3DNow\(\)/);
  assert.match(runnerSource, /private async exportDrawing3DNow\(filePath: string, maxLines: number\)/);
  assert.match(runnerSource, /private async exportDrawing3DBinaryNow\(filePath: string\)/);
  assert.match(runnerSource, /private async exportReportNow\(reporter: string, filePath: string\)/);
  assert.match(runnerSource, /EXPORT_REPORT \$\{encodedReporter\} \$\{encodedPath\}/);
  assert.match(runnerSource, /EXPORT_DRAWING_3D \$\{encodedPath\} \$\{lineLimit\}/);
  assert.match(runnerSource, /EXPORT_DRAWING_3D_BINARY \$\{encodedPath\}/);
  assert.match(runnerSource, /report-3d-exports/);
  assert.match(runnerSource, /drawing-3d-exports/);
  assert.match(runnerSource, /function parseDrawingLine3DCount\(value: string\)/);
  assert.match(runnerSource, /export function parseDrawing3DBinaryCount\(value: Buffer\)/);
  assert.match(runnerSource, /export function parseDrawing3DBinaryMetadata\(value: Buffer\)/);
  assert.match(runnerSource, /this\.child\.stdin\.write\("DRAWING_3D\\n"/);
  assert.match(runnerSource, /function parseDrawingLine3DValues\(value: string\)/);
  assert.match(runnerSource, /function parseOptionalNumber\(value: string \| undefined\)/);
  assert.match(runnerSource, /export interface Rgb3DValue/);
  assert.match(runnerSource, /readonly colorRgb\?: Rgb3DValue/);
  assert.match(runnerSource, /readonly alpha\?: number/);
  assert.match(runnerSource, /readonly penMode\?: string/);
  assert.match(runnerSource, /readonly penSize\?: number/);
  assert.match(runnerSource, /readonly shape\?: string/);
  assert.match(runnerSource, /readonly directed\?: boolean/);
  assert.match(runnerSource, /label-color/);
  assert.match(runnerSource, /pen-mode/);
  assert.match(runnerSource, /pen-size/);
  assert.match(runnerSource, /extract-rgb color/);
  assert.match(runnerSource, /extract-rgb pcolor/);
  assert.match(runnerSource, /function parseRgb3DValue\(parts: string\[\], start: number\)/);
  assert.match(runnerSource, /function parseNetLogoColorAlpha\(value: string \| undefined\)/);
  assert.match(runnerSource, /is-directed-link\? self/);
  assert.match(runnerSource, /sublist \(sort patches with \[pcolor != black\]\) 0 \(min \(list 5000 count patches with \[pcolor != black\]\)\)/);
  assert.match(runnerSource, /export function parseNetLogoDelimitedList/);
  assert.match(runnerSource, /function parseQuotedNetLogoString/);
});

test("webview persists local editor and 3D viewer preferences", () => {
  const source = fs.readFileSync(path.join(root, "src", "netlogoEditor.ts"), "utf8");

  assert.match(source, /const restoredUiState = vscode\.getState\?\.\(\) \?\? \{\}/);
  assert.match(source, /activeTab: validUiTab\(restoredUiState\.activeTab\)/);
  assert.match(source, /hasLoadedModel: false/);
  assert.match(source, /const firstModelLoad = !state\.hasLoadedModel/);
  assert.match(source, /state\.hasLoadedModel = true/);
  assert.match(source, /firstModelLoad \|\| !codeEditorActive/);
  assert.match(source, /firstModelLoad \|\| !sourceEditorActive/);
  assert.match(source, /infoEditing: Boolean\(restoredUiState\.infoEditing\)/);
  assert.match(source, /interfaceMode: validInterfaceMode\(restoredUiState\.interfaceMode\)/);
  assert.match(source, /runSpeed: restoredRunSpeed\(restoredUiState\.runSpeed\)/);
  assert.match(source, /runSpeedScaleVersion: 2/);
  assert.match(source, /function restoredThreeBackground\(restored\)/);
  assert.match(source, /restored\.threeBackgroundPreferenceVersion === 1/);
  assert.match(source, /threeBackgroundPreferenceVersion: 1/);
  assert.match(source, /threeCamera: sanitizeThreeCamera\(restoredUiState\.threeCamera\)/);
  assert.match(source, /function persistUiState\(\)/);
  assert.match(source, /vscode\.setState\?\.\(\{/);
  assert.match(source, /function validUiTab\(tab\)/);
  assert.match(source, /function validThreeInteractionMode\(mode\)/);
  assert.match(source, /function sanitizeThreeCamera\(camera\)/);
  assert.match(source, /setInterfaceMode\(state\.interfaceMode\)/);
  assert.match(source, /activateTab\(state\.activeTab\)/);
  assert.match(source, /speedSlider\.value = String\(state\.runSpeed\)/);
  assert.match(source, /function clampRunSpeed\(value\)/);
  assert.match(source, /clampNumber\(Math\.round\(Number\(value\)\), RUN_SPEED_RAW_MIN, RUN_SPEED_RAW_MAX\)/);
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

test("runner parses complete NetLogo export-plot CSV data before posting it to the webview", () => {
  const runnerSource = fs.readFileSync(path.join(root, "src", "runner.ts"), "utf8");
  const webviewSource = fs.readFileSync(path.join(root, "src", "netlogoEditor.ts"), "utf8");

  assert.match(runnerSource, /import \{ parsePlotCsv, type ParsedPlotCsv \} from "\.\/plotCsv"/);
  assert.match(runnerSource, /readonly data: ParsedPlotCsv/);
  assert.match(runnerSource, /data: parsePlotCsv\(csv\)/);
  assert.match(webviewSource, /state\.plotData\[plot\.widgetId\] = plot\.data \?\? null/);
  assert.match(webviewSource, /function plotSeriesForWidget\(widget, runtimePlot, configurationDirty\)/);
  assert.match(webviewSource, /for \(const pen of series\) \{\s*renderPlotSeries/);
});

test("webview renders plot pen colors, modes, legends, and exposes the full pen editor", () => {
  const source = fs.readFileSync(path.join(root, "src", "netlogoEditor.ts"), "utf8");

  assert.match(source, /function renderPlotSeries\(svg, pen, frame, xDomain, yDomain\)/);
  assert.match(source, /if \(mode === 1\)/);
  assert.match(source, /if \(mode === 2\)/);
  assert.match(source, /if \(point\.penDown === false\)/);
  assert.match(source, /point\.x \+ interval/);
  assert.match(source, /Math\.abs\(barEndX - normalized\[0\]\)/);
  assert.match(source, /function svgPlotPoint\(x, y, fill\)/);
  assert.match(source, /plotCssColor\(point\.color \?\? fallbackColor\)/);
  assert.match(source, /function renderPlotLegend\(svg, series\)/);
  assert.match(source, /runtimePlot\?\.legend/);
  assert.match(source, /pen\.inLegend !== false/);
  assert.match(source, /function renderPlotPensEditor\(widget\)/);
  assert.match(source, /"Add pen"/);
  assert.match(source, /"Pen setup commands"/);
  assert.match(source, /"Pen update commands"/);
  assert.match(source, /function plotPalette\(\)/);
  assert.match(source, /commitWidgetProperties\(widget, "pens", nextPens\)/);
  assert.match(source, /descriptor\("autoplot", "Auto scale"/);
  assert.match(source, /descriptor\("legend", "Show legend"/);
  assert.match(source, /descriptor\("setupCode", "Plot setup commands"/);
  assert.match(source, /descriptor\("updateCode", "Plot update commands"/);
  assert.match(source, /state\.dirtyPlotWidgets\.add\(widget\.id\)/);
  assert.match(source, /Plot definition changed\. Run Setup to reload the model workspace\./);
});

test("monitor widgets show their reporter title and format numeric values like NetLogo", () => {
  const source = fs.readFileSync(path.join(root, "src", "netlogoEditor.ts"), "utf8");

  assert.match(source, /node\("div", "monitor-heading", widget\.label \|\| widget\.details\?\.source \|\| "Monitor"\)/);
  assert.match(source, /function formatMonitorValue\(value, precision\)/);
  assert.match(source, /function netLogoMonitorApproximate\(value, decimalPlaces\)/);
  assert.match(source, /Math\.floor\(value \* scale \+ 0\.5\) \/ scale/);
  assert.match(source, /function groupMonitorDecimal\(source\)/);
  assert.match(source, /formatMonitorValue\(state\.runtimeValues\[widget\.id\] \?\? "\.\.\."/);
  assert.match(source, /\.monitor-widget\s*\{[\s\S]*?grid-template-rows: auto minmax\(0, 1fr\)/);
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

test("webview plot domains honor exact runtime ranges and expand configured fallbacks", () => {
  const source = fs.readFileSync(path.join(root, "src", "netlogoEditor.ts"), "utf8");

  assert.match(source, /function plotDomain\(points, widget, runtimePlot, axis, configurationDirty\)/);
  assert.match(source, /runtimePlot\?\.\[axis \+ "Min"\]/);
  assert.match(source, /runtimePlot\?\.\[axis \+ "Max"\]/);
  assert.match(source, /for \(const point of points\)/);
  assert.match(source, /if \(!Number\.isFinite\(value\)\)/);
  assert.doesNotMatch(source, /Math\.(?:min|max)\(\.\.\.values\)/);
  assert.match(source, /dataMin >= configuredMin && dataMax <= configuredMax/);
  assert.match(source, /return \[configuredMin, configuredMax\]/);
  assert.match(source, /Math\.min\(dataMin, configuredMin\)/);
  assert.match(source, /Math\.max\(dataMax, configuredMax\)/);
  assert.match(source, /function plotSeriesLayer\(svg, frame, widgetId\)/);
  assert.match(source, /clipPath\.setAttribute\("clipPathUnits", "userSpaceOnUse"\)/);
  assert.match(source, /scaleLinear\(point\.y, yDomain, frame\.bottom, frame\.top\)/);
  assert.doesNotMatch(source, /function clampPlotCoordinate/);
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
  assert.match(source, /if \(firstModelLoad \|\| !codeEditorActive\) \{[\s\S]*?setInputValue\(inputs\.code, state\.code\)/);
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
