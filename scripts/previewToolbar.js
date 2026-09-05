// Browser geometry regression check using the editor's actual CSS, header and state toggle.
// Run: node scripts/previewToolbar.js, then open the printed loopback URL.
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const sourcePath = path.join(__dirname, "..", "src", "netlogoEditor.ts");
const baseline = fs.readFileSync(sourcePath, "utf8");

function page(source) {
  const css = source.match(/<style>([\s\S]*?)<\/style>/)[1];
  const header = source.match(/<header class="topbar">[\s\S]*?<\/header>/)[0];
  const toggle = source.slice(source.indexOf("function updateRunControls()"), source.indexOf("function renderTickCount()"));
  return `<!doctype html><html><meta charset="utf-8"><title>NetLogo toolbar geometry check</title>
<style>:root{--vscode-font-family:-apple-system,BlinkMacSystemFont,sans-serif;--vscode-editor-font-family:Menlo,monospace;--vscode-font-size:13px;--vscode-foreground:#ddd;--vscode-descriptionForeground:#bbc;--vscode-editor-foreground:#ddd;--vscode-sideBar-background:#201b28;--vscode-editorWidget-background:#19151f;--vscode-panel-border:#60556d;--vscode-button-background:#5297cf;--vscode-button-foreground:white;--vscode-statusBarItem-errorBackground:#b52332}body{line-height:1.4}${css}
body{overflow:auto}pre{white-space:pre-wrap;padding:20px}#check{margin:20px}</style>
${header}<button id="check">Check geometry</button><pre id="results">Ready</pre><script>
const state={runLoop:null};
const setupButton=document.querySelector('#setupButton'),goButton=document.querySelector('#goButton'),foreverButton=document.querySelector('#foreverButton');
${toggle}
foreverButton.onclick=()=>{state.runLoop=state.runLoop?null:{};updateRunControls()};
function rect(element){const r=element.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};}
function snapshot(){const ticks=document.querySelector('.tick-counter'),value=document.querySelector('#tickCount');return {button:rect(foreverButton),ticks:rect(ticks),tickValue:rect(value),valueCenterOffset:(rect(value).y+rect(value).height/2)-(rect(ticks).y+rect(ticks).height/2)};}
document.querySelector('#check').onclick=()=>{
 const checks=[];
 for(const font of [11,13,16]) for(const zoom of [0.8,1,1.25]) for(const status of ['Ready','Updated after iterate','Running go','Stopping','A long status with a horizontal scrollbar '.repeat(5)]){
  document.documentElement.style.setProperty('--vscode-font-size',font+'px');document.body.style.zoom=zoom;document.querySelector('#status').textContent=status;
  document.querySelector('#tickCount').textContent='1,048,576';
  state.runLoop=null;updateRunControls();const before=snapshot();state.runLoop={};updateRunControls();const after=snapshot();
  checks.push({font,zoom,status:status.slice(0,32),before,after,stable:JSON.stringify(before.button)===JSON.stringify(after.button),centered:Math.abs(after.valueCenterOffset)<0.02});
 }
 document.documentElement.style.setProperty('--vscode-font-size','13px');document.body.style.zoom=1;state.runLoop=null;updateRunControls();document.querySelector('#status').textContent='Ready';
 document.querySelector('#results').textContent=JSON.stringify({cases:checks.length,unstable:checks.filter(c=>!c.stable),offCenter:checks.filter(c=>!c.centered),checks},null,2);
};
</script></html>`;
}
const server = http.createServer((request, response) => {
  response.setHeader("Content-Type", "text/html; charset=utf-8");
  response.end(page(request.url === "/baseline" ? baseline : fs.readFileSync(sourcePath, "utf8")));
});
server.listen(0, "127.0.0.1", () => console.log("Toolbar check: http://127.0.0.1:" + server.address().port));
