// Replay native PNG frames through the real generated 2D presenter. An optional
// JSON file contains data:image/png;base64,... strings; otherwise use synthetic
// frames. This opens no native application and never modifies a model.
const fs = require("node:fs");
const { bridgeSourcePaths } = require("../out/javaBridge");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");
const { execFileSync, spawnSync } = require("node:child_process");
const { plotLayoutSource } = require("../test/helpers/plotLayout");
const { installationFromHome } = require("../out/netlogoInstallation");

function captureHotellingFrames() {
  const installation = installationFromHome(process.env.NETLOGO_HOME || "/Applications/NetLogo 6.4.0");
  if (!installation) throw new Error("Set NETLOGO_HOME to an installed NetLogo with Hotelling's Law.");
  const model = path.join(installation.home, "models/Sample Models/Social Science/Economics/Hotelling's Law.nlogo");
  const original = fs.readFileSync(model);
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "netlogo-frame-preview-"));
  try {
    const compile = spawnSync("javac", ["-cp", installation.classPath.join(path.delimiter), "-d", temp,
      ...bridgeSourcePaths(path.join(__dirname, "../resources/java"))], { encoding: "utf8", timeout: 30000 });
    assert.equal(compile.status, 0, compile.error?.message || compile.stderr);
    const commands = [["COMMAND", 'random-seed 24680 set number-of-stores 5 set rules "normal" set layout "plane" setup']];
    for (let i = 0; i < 90; i++) commands.push(["COMMAND", "go"], ["EXPORT_VIEW", path.join(temp, "frame.png")]);
    const run = spawnSync("java", [...installation.jvmArgs, "-Djava.awt.headless=true", "-cp",
      [temp, ...installation.classPath].join(path.delimiter), "NetLogoCommandBridge", model], {
      input: commands.map(([kind, value]) => `${kind} ${Buffer.from(value).toString("base64")}`).join("\n") + "\n",
      encoding: "utf8", timeout: 45000, maxBuffer: 16 * 1024 * 1024
    });
    assert.equal(run.status, 0, run.error?.message || run.stderr);
    assert.doesNotMatch(run.stdout, /__NETLOGO_ERROR__/);
    const frames = [...run.stdout.matchAll(/__NETLOGO_VIEW__([^\r\n]+)/g)].map(match => "data:image/png;base64," + match[1]);
    assert.equal(frames.length, 90);
    assert.ok(original.equals(fs.readFileSync(model)), "The native model must not be modified");
    return frames;
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

function createFramePreviewServer({ frames = [], baseline = "4f83da8" } = {}) {
  if (!Array.isArray(frames) || !frames.every(frame => typeof frame === "string" && /^data:image\/png;base64,[\da-z+/=]+$/i.test(frame))) {
    throw new Error("Expected an array of base64 PNG data URIs.");
  }
  const { html, css } = plotLayoutSource();
  const script = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].at(-1)[1];
  const previous = execFileSync("git", ["show", `${baseline}:out/netlogoEditor.js`], { encoding: "utf8" });
  function fragment(source, from, to) {
    const start = source.indexOf(from), end = source.indexOf(to, start);
    if (start < 0 || end <= start) throw new Error(`Missing production code: ${from}`);
    return source.slice(start, end);
  }
  const body = `<!doctype html><html lang="en"><meta charset="utf-8"><title>2D frame presentation</title>
<style>:root{--vscode-font-family:Arial,sans-serif;--vscode-font-size:13px;--vscode-editorWidget-background:#000;--vscode-editor-background:#18131e;--vscode-editor-foreground:#ddd}
${css}
body{display:block;overflow:auto;height:auto;padding:20px}h1{font-size:20px}.comparison{display:flex;gap:24px;margin:16px 0}.case{width:451px}.screen{position:relative;width:451px;height:451px;background:#000}.two-view{width:100%;height:100%}pre{white-space:pre-wrap}
</style><h1>Native 2D frame presentation</h1><button id="play">Replay 90 frames</button> <span id="status">Ready</span>
<div class="comparison"><div class="case"><p>Previous renderer</p><div id="previous" class="screen view-widget" data-widget-id="view"><img class="view-image" decoding="async" alt="Previous native view"></div></div>
<div class="case"><p>Decoded-frame presenter</p><div id="surface" class="screen"><div class="view-widget" data-widget-id="view" style="width:100%;height:100%"></div></div></div></div>
<pre id="results"></pre><script>
${fragment(script, "const createTwoViewFrameQueue =", "const vscode =")}
${fragment(script, "function node(", "function setInputValue(")}
${fragment(script, "function renderViewBody(widget)", "function mountThreeView(element)")}
${fragment(script, "function pruneTwoViews(widgets)", "function refreshPlotBody(")}
const suppliedFrames=${JSON.stringify(frames)};
const surface=document.querySelector('#surface');
const state={viewImageDataUri:null,view3DState:null,interaction:null,twoViewControllers:new Map(),interfacePreview:{widgets:[{id:'view',kind:'view'}]}};
const previousState={...state};
const previousHost=document.querySelector('#previous');
const previousSurface={querySelectorAll:()=>[previousHost]};
const previousRefresh=new Function('state','surface',${JSON.stringify(fragment(previous, "function refreshMountedTwoViews()", "function refreshPlotBody("))}+'return refreshMountedTwoViews;')(previousState,previousSurface);
const errors=[];
function setStatus(message){errors.push(message);}
function syntheticFrames(){
  const canvas=document.createElement('canvas');canvas.width=canvas.height=451;const ctx=canvas.getContext('2d');
  return Array.from({length:90},(_,i)=>{ctx.fillStyle='hsl('+((i*19)%360)+' 65% 65%)';ctx.fillRect(0,0,451,451);ctx.fillStyle='#fff';ctx.fillRect(i*5,0,4,451);return canvas.toDataURL('image/png');});
}
window.framesToReplay=suppliedFrames.length?suppliedFrames:syntheticFrames();
// Isolate the image-cache keys without changing PNG bytes. Otherwise predecoding
// the updated panel can accidentally fix the previous panel in a comparison.
const previousFrames=framesToReplay.map(frame=>frame.replace('image/png;','image/png;renderer=previous;'));
window.ready=(async()=>{
  state.viewImageDataUri=framesToReplay[0];previousState.viewImageDataUri=previousFrames[0];
  previousHost.querySelector('img').src=previousFrames[0];
  surface.querySelector('.view-widget').append(renderViewBody({id:'view'}));
  await previousHost.querySelector('img').decode();
  while(!surface.querySelector('img'))await new Promise(requestAnimationFrame);
})();
window.replay=async({interval=33,mode='both'}={})=>{
  await ready;errors.length=0;
  document.querySelector('#play').disabled=true;document.querySelector('#status').textContent='Running';
  const started=performance.now();
  for(let i=1;i<framesToReplay.length;i++){
    await new Promise(resolve=>setTimeout(resolve,interval));
    state.viewImageDataUri=framesToReplay[i];previousState.viewImageDataUri=previousFrames[i];
    if(mode!=='updated')previousRefresh();
    if(mode!=='previous')refreshMountedTwoViews();
  }
  // This wait is only the preview's completion probe, not runtime pacing.
  if(mode!=='previous')while(surface.querySelector('img')?.src!==framesToReplay.at(-1))await new Promise(requestAnimationFrame);
  if(mode!=='updated')await previousHost.querySelector('img').decode();
  const result={frames:framesToReplay.length,mode,elapsedMs:performance.now()-started,errors:errors.slice(),latestFramePresented:true};
  document.querySelector('#results').textContent=JSON.stringify(result,null,2);
  document.querySelector('#status').textContent='Complete';document.querySelector('#play').disabled=false;
  return result;
};
document.querySelector('#play').onclick=()=>replay();
window.addEventListener('pagehide',()=>{state.viewImageDataUri=null;pruneTwoViews([]);});
</script></html>`;
  return http.createServer((_request, response) => {
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    response.setHeader("Cache-Control", "no-store");
    response.end(body);
  });
}

if (require.main === module) {
  const frames = process.argv[2] === "--hotelling" ? captureHotellingFrames()
    : process.argv[2] ? JSON.parse(fs.readFileSync(process.argv[2], "utf8")) : [];
  const server = createFramePreviewServer({ frames, baseline: process.argv[3] || "4f83da8" });
  server.listen(0, "127.0.0.1", () => console.log(`2D frame check: http://127.0.0.1:${server.address().port}; PID ${process.pid}`));
}
module.exports = { createFramePreviewServer, captureHotellingFrames };
