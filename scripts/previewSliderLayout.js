// Browser regression using the generated production slider/switch CSS and renderer.
// Compile, run this script and open its loopback URL. No model is modified.
const http = require("node:http");
const { sliderLayoutSource, sliderFixtures, switchFixtures } = require("../test/helpers/sliderLayout");

function page() {
  const { css, source } = sliderLayoutSource();
  return `<!doctype html><html lang="en"><meta charset="utf-8"><title>NetLogo control layout checks</title>
<style>:root{--vscode-font-family:Arial,sans-serif;--vscode-font-size:13px;--vscode-editor-foreground:#ddd;--vscode-descriptionForeground:#bbc;--vscode-input-background:#262130;--vscode-panel-border:#665775;--vscode-editor-background:#18131e}
${css}
body{overflow:auto;height:auto;padding:20px}#cases{display:flex;flex-direction:column;gap:12px;margin:20px 0}.case{position:relative}h1{font-size:20px}pre{white-space:pre-wrap}
</style><h1>Slider containment and checkbox alignment</h1><button id="check">Check control sizes and zoom levels</button><p id="summary">Ready</p><div id="cases"></div><pre id="results"></pre>
<script>
const fixtures=${JSON.stringify([...sliderFixtures(), ...switchFixtures()])};
const state={interfaceMode:'interact'};
function commitWidgetProperties(){}
${source}
function render(){
  const cases=document.querySelector('#cases');cases.replaceChildren();
  for(const widget of fixtures){
    const host=node('div','widget '+widget.kind+'-widget case',renderWidgetContent(widget));
    host.dataset.kind=widget.kind;host.dataset.label=widget.label;
    host.style.width=widget.width+'px';host.style.height=widget.height+'px';cases.append(host);
  }
}
function inspect(font,zoom,mode){
  return Array.from(document.querySelectorAll('.case')).map(host=>{
    const r=host.getBoundingClientRect(),failures=[];
    for(const e of host.querySelectorAll('.control-heading,.slider-row,.runtime-slider,.switch-row,.runtime-checkbox,.control-value')){
      const b=e.getBoundingClientRect();
      if(b.top<r.top+zoom-0.5||b.bottom>r.bottom-zoom+0.5||b.left<r.left+zoom-0.5||b.right>r.right-zoom+0.5)failures.push('Clipped '+e.className);
    }
    const input=host.querySelector('input'),value=host.querySelector('.control-value');
    if(host.dataset.kind==='slider'){
      if(input.getBoundingClientRect().height<16*zoom-0.5)failures.push('Thumb row too short');
      if(value.getBoundingClientRect().height<14*zoom-0.5)failures.push('Digit line too short');
    }else{
      for(const e of [input,value]){
        const b=e.getBoundingClientRect();
        if(Math.abs((b.top+b.bottom-r.top-r.bottom)/2)>0.5)failures.push('Off-center '+e.className);
      }
      if(host.querySelector('.control-heading')||input.labels.length!==1)failures.push('Duplicated or missing switch label');
    }
    if(input.disabled!==(mode==='layout'))failures.push('Interaction mode changed');
    return {name:host.dataset.label,kind:host.dataset.kind,font,zoom,mode,height:r.height,value:value.textContent,failures};
  });
}
document.querySelector('#check').onclick=()=>{
  const checks=[];
  for(const font of [11,13,16])for(const zoom of [0.8,1,1.25])for(const mode of ['interact','layout']){
    document.documentElement.style.setProperty('--vscode-font-size',font+'px');document.body.style.zoom=zoom;state.interfaceMode=mode;render();checks.push(...inspect(font,zoom,mode));
  }
  document.documentElement.style.setProperty('--vscode-font-size','13px');document.body.style.zoom=1;state.interfaceMode='interact';render();
  const failed=checks.filter(c=>c.failures.length);
  document.querySelector('#summary').textContent=checks.length+' checks; '+failed.length+' failed';
  document.querySelector('#results').textContent=JSON.stringify({cases:checks.length,failed,checks},null,2);
};render();
</script></html>`;
}

const server = http.createServer((_request, response) => {
  response.setHeader("Content-Type", "text/html; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.end(page());
});
server.listen(0, "127.0.0.1", () => console.log(`Slider layout check: http://127.0.0.1:${server.address().port}; PID ${process.pid}`));
