// Real model Info + production CSS/parser. Only serves explicitly listed resources
// on loopback; no simulation, native GUI, or additional VS Code window is opened.
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { infoPreviewSource, infoFixtures } = require("../test/helpers/infoMarkdown");
const { loadInfoLocalImage } = require("../out/infoResources");

function page() {
  const { css, highlight } = infoPreviewSource();
  return `<!doctype html><html lang="en"><meta charset="utf-8"><title>NetLogo Info preview</title>
<style>
:root {--vscode-font-family:-apple-system,BlinkMacSystemFont,Arial,sans-serif;--vscode-editor-font-family:Menlo,monospace;--vscode-font-size:13px}
${css}
body{overflow:auto;height:auto}#preview-controls{position:sticky;top:0;z-index:2;display:flex;gap:12px;align-items:center;padding:12px 18px;background:var(--vscode-sideBar-background);border-bottom:1px solid var(--vscode-panel-border);flex-wrap:wrap}
#viewport{max-width:100%;margin:0 auto}#infoPreview{height:760px;min-height:0}#summary{font-size:12px;margin:0}#results{white-space:pre-wrap;padding:18px}select{max-width:280px}
</style><div id="preview-controls"><label>Model <select id="fixture"></select></label><label>Theme <select id="theme"><option value="dark">Dark</option><option value="light">Light</option><option value="contrast">High contrast</option></select></label><button id="check">Check all sizes</button><p id="summary">Ready</p></div>
<div id="viewport"><div id="infoPreview" class="info-preview"></div></div><pre id="results"></pre>
<script src="/markdown-it.min.js"></script><script src="/infoMarkdown.js"></script><script>
${highlight}
const themes={
dark:{'editor-background':'#241e2c','editor-foreground':'#d7dce5','sideBar-background':'#201a28','editorWidget-background':'#19141f','panel-border':'#51445e','focusBorder':'#9d8bd2','descriptionForeground':'#b2a8c0','textLink-foreground':'#82baf5','textLink-activeForeground':'#a4cffb','textCodeBlock-background':'#1b1622','textBlockQuote-border':'#9782bd','textBlockQuote-background':'#2a2332','button-background':'#5297cf','button-foreground':'#ffffff','symbolIcon-functionForeground':'#81b8f1','symbolIcon-stringForeground':'#96c990','symbolIcon-numberForeground':'#eab777'},
light:{'editor-background':'#ffffff','editor-foreground':'#252832','sideBar-background':'#f4f2f8','editorWidget-background':'#f3f1f7','panel-border':'#d1cbdc','focusBorder':'#7460ad','descriptionForeground':'#5f566d','textLink-foreground':'#005a9e','textLink-activeForeground':'#003d6d','textCodeBlock-background':'#f4f2f8','textBlockQuote-border':'#7460ad','textBlockQuote-background':'#f7f5fb','button-background':'#246daf','button-foreground':'#ffffff','symbolIcon-functionForeground':'#1647a1','symbolIcon-stringForeground':'#276b39','symbolIcon-numberForeground':'#8c4808'},
contrast:{'editor-background':'#000000','editor-foreground':'#ffffff','sideBar-background':'#000000','editorWidget-background':'#111111','panel-border':'#ffffff','focusBorder':'#ffff00','contrastBorder':'#ffffff','descriptionForeground':'#ffffff','textLink-foreground':'#00ffff','textLink-activeForeground':'#ffffff','textCodeBlock-background':'#111111','textBlockQuote-border':'#ffff00','textBlockQuote-background':'#111111','button-background':'#000000','button-foreground':'#ffffff','symbolIcon-functionForeground':'#00ffff','symbolIcon-stringForeground':'#aaffaa','symbolIcon-numberForeground':'#ffff00'}
};
let fixtures=[],renderId=0,pending=[],activeIndex=0;
const cache=new Map(),preview=document.querySelector('#infoPreview'),viewport=document.querySelector('#viewport');
const renderer=NetLogoInfoMarkdown.createInfoMarkdownRenderer({document,markdownit,highlightCode:appendHighlightedNetLogo,
openLink:href=>{document.querySelector('#summary').textContent='Link: '+href},
requestImage:(id,href)=>{
 const key=activeIndex+':'+href;
 if(!cache.has(key))cache.set(key,fetch('/image?model='+activeIndex+'&href='+encodeURIComponent(href)).then(response=>response.json()));
 pending.push(cache.get(key).then(result=>renderer.acceptImage(id,result.data,result.error)));
}});
window.showFixture=async(index,theme='dark',width=1100,zoom=1)=>{
 activeIndex=index;pending=[];document.body.className=theme==='contrast'?'vscode-high-contrast':'vscode-'+theme;
 for(const[key,value]of Object.entries(themes[theme]))document.documentElement.style.setProperty('--vscode-'+key,value);
 document.body.style.zoom=zoom;viewport.style.width=width+'px';preview.replaceChildren(renderer.render(fixtures[index].source));preview.scrollTop=0;
 await Promise.all(pending);await document.fonts.ready;
 // Production images are lazy; QA must request offscreen local fixtures before
 // waiting for decode, or a below-the-fold image can wait indefinitely.
 for(const image of preview.querySelectorAll('img')){image.loading='eager';await image.decode().catch(()=>{});}
 return inspect(index,theme,width,zoom);
};
function inspect(index,theme,width,zoom){
 const failures=[],frame=preview.getBoundingClientRect(),article=preview.querySelector('article'),r=article.getBoundingClientRect();
 if(preview.scrollWidth>preview.clientWidth+1)failures.push('Preview overflow');
 if(r.right>frame.right+1||r.left<frame.left-1)failures.push('Article outside viewport');
 for(const node of article.querySelectorAll('h1,h2,h3,h4,h5,h6,p,ul,ol,blockquote,pre,.info-table-scroll,.info-image')){
   const b=node.getBoundingClientRect();if(b.right>r.right+1||b.left<r.left-1)failures.push('Clipped '+node.tagName);
 }
 const headings=[...article.querySelectorAll('h1,h2,h3,h4,h5,h6')];
 if(new Set(headings.map(node=>node.id)).size!==headings.length)failures.push('Duplicate heading IDs');
 return {model:fixtures[index].name,theme,width,zoom,headings:headings.length,links:article.querySelectorAll('a[href]').length,images:article.querySelectorAll('img').length,tables:article.querySelectorAll('table').length,failures};
}
window.checkInfoLayout=async()=>{
 const checks=[];
 for(let i=0;i<fixtures.length;i++)for(const theme of ['dark','light','contrast'])for(const width of [320,640,1100])for(const zoom of [0.8,1,1.25])checks.push(await showFixture(i,theme,width,zoom));
 const failed=checks.filter(result=>result.failures.length);const result={cases:checks.length,failed};
 document.querySelector('#results').textContent=JSON.stringify(result,null,2);document.querySelector('#summary').textContent=checks.length+' checks; '+failed.length+' failed';await showFixture(0);return result;
};
document.querySelector('#check').onclick=()=>checkInfoLayout();
document.querySelector('#fixture').onchange=()=>showFixture(Number(document.querySelector('#fixture').value),document.querySelector('#theme').value);
document.querySelector('#theme').onchange=()=>showFixture(Number(document.querySelector('#fixture').value),document.querySelector('#theme').value);
window.ready=fetch('/fixtures').then(response=>response.json()).then(values=>{fixtures=values;window.fixtures=values;const select=document.querySelector('#fixture');values.forEach((fixture,index)=>{const option=document.createElement('option');option.value=index;option.textContent=fixture.name;select.append(option)});return showFixture(0)});
</script></html>`;
}

function createInfoPreviewServer() {
  const fixtures = infoFixtures();
  return http.createServer(async (request, response) => {
    const url = new URL(request.url, "http://localhost");
    response.setHeader("Cache-Control", "no-store");
    if (url.pathname === "/") { response.setHeader("Content-Type", "text/html; charset=utf-8"); response.end(page()); }
    else if (url.pathname === "/fixtures") { response.setHeader("Content-Type", "application/json"); response.end(JSON.stringify(fixtures.map(({ name, source }) => ({ name, source })))); }
    else if (url.pathname === "/infoMarkdown.js" || url.pathname === "/markdown-it.min.js") {
      const file = url.pathname === "/infoMarkdown.js" ? "resources/infoMarkdown.js" : "resources/vendor/markdown-it/markdown-it.min.js";
      response.setHeader("Content-Type", "text/javascript; charset=utf-8"); response.end(fs.readFileSync(path.join(__dirname, "..", file)));
    } else if (url.pathname === "/image") {
      response.setHeader("Content-Type", "application/json");
      try {
        const fixture = fixtures[Number(url.searchParams.get("model"))];
        if (!fixture?.file) throw new Error("No local image in this fixture");
        response.end(JSON.stringify({ data: await loadInfoLocalImage(fixture.file, url.searchParams.get("href")) }));
      } catch (error) { response.end(JSON.stringify({ error: error.message })); }
    } else { response.writeHead(404); response.end(); }
  });
}
if (require.main === module) {
  const server = createInfoPreviewServer();
  server.listen(0, "127.0.0.1", () => console.log(`Info preview: http://127.0.0.1:${server.address().port}; PID ${process.pid}`));
}
module.exports = { createInfoPreviewServer };
