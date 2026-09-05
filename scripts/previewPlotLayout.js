// Real-browser layout regression using generated editor CSS and plot functions.
// Run npm run compile, then node scripts/previewPlotLayout.js and open its URL.
// Fixtures are deterministic drawing data; no model or application state changes.
const http = require("node:http");
const { plotLayoutSource, plotFixtures } = require("../test/helpers/plotLayout");

function page() {
  const { css, source } = plotLayoutSource();
  return `<!doctype html><html lang="en"><meta charset="utf-8"><title>NetLogo plot layout checks</title>
<style>:root{--vscode-font-family:Arial,sans-serif;--vscode-font-size:13px;--vscode-editor-foreground:#ddd;--vscode-descriptionForeground:#bbc;--vscode-input-background:#262130;--vscode-panel-border:#665775;--vscode-editor-background:#18131e}
${css}
body{overflow:auto;height:auto;padding:20px}#cases{display:flex;flex-wrap:wrap;gap:24px;align-items:flex-start;margin:20px 0}.case .widget{position:relative}h1{font-size:20px}pre{white-space:pre-wrap}#summary{font-weight:bold}
</style><h1>Plot geometry and axis precision</h1><p>Synthetic fixtures at the saved Traffic widget sizes, plus narrow, wide, tall and many-pen cases.</p>
<button id="check">Check all sizes and zoom levels</button><p id="summary">Ready</p><div id="cases"></div><pre id="results"></pre>
<script>
const fixtures=${JSON.stringify(plotFixtures()).replace(/</g, "\\u003c")};
const state={plotData:{},dirtyPlotWidgets:new Set()};
function node(tag,className,content){const e=document.createElement(tag);e.className=className;if(Array.isArray(content))e.append(...content);else e.textContent=content;return e;}
${source}
function render(){
  document.querySelector('#cases').replaceChildren();
  for(const fixture of fixtures){
    const {widget,runtime}=fixture;state.plotData[widget.id]=runtime;
    const card=node('section','case',''),host=node('div','widget plot-widget',[node('div','plot-title',widget.label),renderPlotBody(widget)]);
    host.style.width=widget.width+'px';host.style.height=widget.height+'px';card.append(host);document.querySelector('#cases').append(card);
  }
}
function inspect(zoom,font){
  const cases=[];
  for(const host of document.querySelectorAll('.plot-widget')){
    const r=host.getBoundingClientRect(),body=host.querySelector('.plot-body'),s=body.querySelector('svg'),m=s.getScreenCTM();
    const failures=[];
    if(s.hasAttribute('viewBox')||s.clientWidth!==body.clientWidth||s.clientHeight!==body.clientHeight)failures.push('SVG viewport differs from available CSS size');
    if(Math.abs(m.a/zoom-1)>0.002||Math.abs(m.d/zoom-1)>0.002)failures.push('Text is scaled with widget size');
    for(const e of [body,s,...s.querySelectorAll('text'),...body.querySelectorAll('.plot-legend')]){
      const b=e.getBoundingClientRect();
      if(b.width&&b.height&&(b.left<r.left-0.5||b.top<r.top-0.5||b.right>r.right+0.5||b.bottom>r.bottom+0.5))failures.push('Clipped '+e.tagName+' '+(e.textContent||'').slice(0,30));
    }
    for(const axis of ['x','y']){
      const labels=Array.from(s.querySelectorAll('[data-axis="'+axis+'"]'));
      for(let i=0;i<labels.length;i++)for(let j=i+1;j<labels.length;j++){
        const a=labels[i].getBoundingClientRect(),b=labels[j].getBoundingClientRect();
        if(Math.min(a.right,b.right)>Math.max(a.left,b.left)+0.5&&Math.min(a.bottom,b.bottom)>Math.max(a.top,b.top)+0.5)failures.push('Overlapping '+axis+' tick labels');
      }
    }
    const legend=host.querySelector('.plot-legend');
    cases.push({name:host.querySelector('.plot-title').textContent,zoom,font,svg:[s.clientWidth,s.clientHeight],scale:[m.a,m.d],legendRows:legend?.children.length??0,legendScrollable:legend?legend.scrollHeight>legend.clientHeight:false,failures});
  }
  return cases;
}
document.querySelector('#check').onclick=()=>{
  const checks=[];
  for(const font of [11,13,16])for(const zoom of [0.8,1,1.25]){
    document.documentElement.style.setProperty('--vscode-font-size',font+'px');document.body.style.zoom=zoom;render();checks.push(...inspect(zoom,font));
  }
  document.documentElement.style.setProperty('--vscode-font-size','13px');document.body.style.zoom=1;render();
  const failed=checks.filter(c=>c.failures.length);
  document.querySelector('#summary').textContent=checks.length+' checks; '+failed.length+' failed';
  document.querySelector('#results').textContent=JSON.stringify({cases:checks.length,failed,checks},null,2);
};
render();
</script></html>`;
}

const server = http.createServer((_request, response) => {
  response.setHeader("Content-Type", "text/html; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.end(page());
});
server.listen(0, "127.0.0.1", () => console.log(`Plot layout check: http://127.0.0.1:${server.address().port}; PID ${process.pid}`));
