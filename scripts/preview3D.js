// Local visual/performance check of the actual generated webview renderer.
// Usage: node scripts/preview3D.js /path/to/native-snapshot-directory
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { parseView3DBinary } = require("../out/view3D");
const { threeViewSource } = require("../test/helpers/threeView");
const directory = path.resolve(process.argv[2] || ".");
const names = fs.readdirSync(directory).filter(name => name.endsWith(".bin") && name.startsWith("percolation"));
const html = `<!doctype html><html lang="en"><meta charset="utf-8"><title>NetLogo 3D renderer check</title>
<style>body{background:#18151e;color:#eee;font:14px system-ui;margin:20px}button,select{font:inherit;padding:7px;margin:3px;background:#38323e;color:white;border:1px solid #777;border-radius:4px}.three-view{height:650px;width:850px;max-width:95vw;position:relative}.three-controls{position:absolute;top:8px;left:8px;display:flex}.three-status{position:absolute;bottom:10px;left:10px}.three-inspector{position:absolute;right:10px;bottom:30px;background:#333;padding:10px}canvas{display:block}pre{white-space:pre-wrap}.active{background:#567}h1{font-size:20px}</style>
<h1>NetLogo 3D renderer check</h1><select id="snapshot"></select><button id="benchmark">Check repeated frames</button><button id="dynamic">Check changing frames</button><button id="coplanar">Coplanar scene</button><button id="transparency">Transparency comparison</button><div class="three-view" id="view"></div><pre id="result"></pre>
<script type="module">
import * as THREE from '/three/three.module.js';
const state={threeBackground:'dark',threeInteractionMode:'orbit',threeCamera:null,threeManualRadius:null};
const THREE_INSTANCE_CHUNK_SIZE=60000;
const clampNumber=(v,a,b)=>Math.min(b,Math.max(a,v));
const persistUiState=()=>{};
function node(tag,cls,children){const n=document.createElement(tag);n.className=cls;if(Array.isArray(children))n.append(...children);else n.textContent=children;return n;}
${threeViewSource(process.env.PREVIEW_EDITOR_SOURCE)}
let renderer,controller,snapshot;
const RenderTHREE={...THREE,WebGLRenderer:class extends THREE.WebGLRenderer{constructor(options){super(options);renderer=this;const render=this.render.bind(this);this.render=(scene,camera)=>{this.lastScene=scene;this.lastCamera=camera;render(scene,camera);};}}};
const host=document.querySelector('#view'),result=document.querySelector('#result');
function metrics(){return {drawCalls:renderer.info.render.calls,triangles:renderer.info.render.triangles,geometries:renderer.info.memory.geometries,patches:snapshot.patchCount,camera:renderer.lastCamera.position.toArray(),near:renderer.lastCamera.near,far:renderer.lastCamera.far};}
function readPixels(){const gl=renderer.getContext(),p=new Uint8Array(gl.drawingBufferWidth*gl.drawingBufferHeight*4);gl.readPixels(0,0,gl.drawingBufferWidth,gl.drawingBufferHeight,gl.RGBA,gl.UNSIGNED_BYTE,p);return p;}
function pixels(){renderer.render(renderer.lastScene,renderer.lastCamera);const p=readPixels();let hash=2166136261,colored=0;for(let i=0;i<p.length;i+=4){if(p[i]||p[i+1]||p[i+2])colored++;hash=Math.imul(hash^p[i],16777619);hash=Math.imul(hash^p[i+1],16777619);hash=Math.imul(hash^p[i+2],16777619);}return {hash:hash>>>0,colored};}
function show(value){result.textContent=JSON.stringify(value,null,2);fetch('/result',{method:'POST',body:result.textContent});}
function mount(next){controller?.();snapshot=next;state.threeCamera=null;state.threeObserverCameraKey=null;const start=performance.now();controller=renderThreeView(host,snapshot,RenderTHREE);show({...metrics(),buildAndRenderMs:performance.now()-start,...pixels()});}
const select=document.querySelector('#snapshot');
for(const name of ${JSON.stringify(names)}){const option=document.createElement('option');option.textContent=name;select.append(option);}
async function load(){mount(await (await fetch('/snapshot/'+select.value)).json());}
select.onchange=load;
document.querySelector('#benchmark').onclick=async()=>{const hashes=new Set(),times=[];for(let i=0;i<25;i++){await new Promise(requestAnimationFrame);const start=performance.now();controller.update(snapshot);times.push(performance.now()-start);hashes.add(pixels().hash);}times.sort((a,b)=>a-b);show({...metrics(),medianUpdateMs:times[12],p95UpdateMs:times[23],distinctFrameHashes:hashes.size,...pixels()});};
document.querySelector('#coplanar').onclick=()=>mount({bounds:{minX:-3,maxX:3,minY:-3,maxY:3,minZ:-3,maxZ:3},patches:[{x:0,y:0,z:0,color:55}],turtles:[{who:0,x:0,y:0,z:0.5,size:1,heading:90,pitch:0,shape:'line',color:15},{who:1,x:2,y:0,z:0,size:1,shape:'cube',color:15},{who:2,x:2,y:0,z:0,size:1,shape:'cube',color:55}],links:[],drawingLines:[]});
document.querySelector('#dynamic').onclick=async()=>{
  const frames=await Promise.all([...select.options].map(option=>fetch('/snapshot/'+option.value).then(response=>response.json())));
  mount(frames[0]);
  const times=[];let start;
  for(let i=0;i<70;i++){
    await new Promise(requestAnimationFrame);
    if(i===10) start=performance.now();
    snapshot=frames[i%frames.length];const before=performance.now();controller.update(snapshot);
    if(i>=10) times.push(performance.now()-before);
  }
  const elapsed=performance.now()-start;times.sort((a,b)=>a-b);
  show({...metrics(),frames:60,medianUpdateMs:times[30],p95UpdateMs:times[57],observedFps:60000/elapsed});
};
document.querySelector('#transparency').onclick=()=>{
  const next={bounds:{minX:-3,maxX:3,minY:-3,maxY:3,minZ:-3,maxZ:3},patches:[
    {x:0,y:-1,z:0,color:15,alpha:160},{x:0,y:1,z:0,color:55,alpha:80}],turtles:[
    {who:0,x:-0.4,y:0,z:0,shape:'sphere',size:2,color:105,alpha:120,heading:20,pitch:40},
    {who:1,x:0.4,y:-2,z:0,shape:'cube',size:2,color:45,alpha:200,heading:60,pitch:20,roll:30},
    {who:2,x:1.4,y:1,z:0,shape:'default',size:2,color:115,alpha:100,heading:30,pitch:30}],links:[],drawingLines:[]};
  mount(next);
  const scene=renderer.lastScene,camera=renderer.lastCamera;
  const reference=new THREE.Scene();reference.background=scene.background.clone();
  addThreeLights(reference,THREE);addThreeWorldBox(reference,THREE,next.bounds);
  const layer=new THREE.Group();reference.add(layer);addThreeTransparency(layer,THREE,next,[],true);
  const results=[];
  for(const xyz of [[8,3,8],[-8,3,-8],[0,10,0.1]]){
    camera.position.set(...xyz);camera.lookAt(0,0,0);camera.near=0.1;camera.far=100;camera.updateProjectionMatrix();
    renderer.render(scene,camera);const batched=readPixels();renderer.render(reference,camera);const individual=readPixels();
    let changed=0,maxChannelDifference=0;
    for(let i=0;i<batched.length;i+=4){let delta=0;for(let c=0;c<3;c++)delta=Math.max(delta,Math.abs(batched[i+c]-individual[i+c]));if(delta>1)changed++;maxChannelDifference=Math.max(maxChannelDifference,delta);}
    results.push({camera:xyz,pixelsDifferentAboveOneLevel:changed,maxChannelDifference});
  }
  geometryDispose(reference);renderer.render(scene,camera);
  show({reference:'Individual agents, native distance order and depth writes',comparisons:results,...metrics()});
};
window.addEventListener('error',event=>show({error:event.message,stack:event.error?.stack}));
window.addEventListener('unhandledrejection',event=>show({error:String(event.reason),stack:event.reason?.stack}));
await load();
</script></html>`;

const server = http.createServer((request, response) => {
  const url = new URL(request.url, "http://localhost");
  if (url.pathname === "/result" && request.method === "POST") {
    let body = "";
    request.on("data", chunk => { body += chunk; });
    request.on("end", () => { console.log(body); response.end("ok"); });
  } else if (url.pathname.startsWith("/snapshot/") && names.includes(path.basename(url.pathname))) {
    const snapshot = parseView3DBinary(fs.readFileSync(path.join(directory, path.basename(url.pathname))));
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ ...snapshot, patchData: Buffer.from(snapshot.patchData).toString("base64") }));
  } else if (/^\/three\/three\.(module|core)(\.min)?\.js$/.test(url.pathname)) {
    response.setHeader("Content-Type", "text/javascript");
    fs.createReadStream(path.join(__dirname, "..", "resources", "vendor", "three", path.basename(url.pathname).replace(/(?:\.min)?\.js$/, ".min.js"))).pipe(response);
  } else if (url.pathname === "/") {
    response.setHeader("Content-Type", "text/html");
    response.end(html);
  } else {
    response.writeHead(404).end();
  }
});
server.listen(Number(process.env.PREVIEW_PORT) || 0, "127.0.0.1", () => console.log('Preview: http://127.0.0.1:' + server.address().port));
