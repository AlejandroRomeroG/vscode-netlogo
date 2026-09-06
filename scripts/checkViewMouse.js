// Real browser pointer events -> production webview handlers -> native Paths.
// Requires Playwright and a local NetLogo installation; opens no VS Code or
// NetLogo desktop window and never saves a model.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");
const { plotLayoutSource } = require("../test/helpers/plotLayout");
const { installation, compileMouseBridge, openMouseBridge } = require("../test/helpers/mouseBridge");

function previewSource() {
  const { html, css } = plotLayoutSource();
  const script = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].at(-1)[1];
  const fragment = (from, to) => {
    const start = script.indexOf(from), end = script.indexOf(to, start);
    if (start < 0 || end <= start) throw new Error("Missing production code: " + from);
    return script.slice(start, end);
  };
  return `<!doctype html><html><meta charset="utf-8"><title>Native 2D mouse check</title>
<style>:root{--vscode-font-family:Arial;--vscode-font-size:13px;--vscode-editorWidget-background:#18131e;--vscode-editor-background:#211b28;--vscode-editor-foreground:#ddd;--vscode-descriptionForeground:#aaa;--vscode-panel-border:#62506f}
${css}
body{display:block;padding:20px}#surface{position:relative}.widget{position:relative;width:600px;height:450px}
</style><div id="surface" class="interact-mode"><div class="widget view-widget" data-widget-id="view"><div class="view-title">View</div></div></div>
<script>
${fragment("const createTwoViewFrameQueue =", "const vscode =")}
${fragment("function node(", "function setInputValue(")}
${fragment("function renderViewBody(widget)", "function mountThreeView(element)")}
${fragment("function pruneTwoViews(widgets)", "function refreshPlotBody(")}
const state={viewImageDataUri:null,view3DState:null,interaction:null,interfaceMode:'interact',activeTab:'interface',twoViewControllers:new Map(),interfacePreview:{widgets:[{id:'view',kind:'view'}]}};
const surface=document.querySelector('#surface');
window.mouseWrites=[];
const vscode={postMessage:message=>{if(message.type==='view-mouse')mouseWrites.push(window.sendMouse(message.state));}};
function setStatus(message){throw new Error(message);}
window.addEventListener('blur',resetViewMouse);
window.setFrame=async frame=>{
  state.viewImageDataUri=frame;
  if(!refreshMountedTwoViews())surface.querySelector('.view-widget').append(renderViewBody({id:'view'}));
  while(surface.querySelector('img')?.src!==frame)await new Promise(requestAnimationFrame);
};
window.fitFrame=()=>fitTwoViewFrame(surface.querySelector('.view-widget'));
window.setMode=mode=>{state.interfaceMode=mode;surface.className=mode+'-mode';if(mode!=='interact')resetViewMouse();};
window.setTab=tab=>{state.activeTab=tab;if(tab!=='interface')resetViewMouse();};
window.finishMouseWrites=async()=>{await new Promise(requestAnimationFrame);await Promise.all(mouseWrites.splice(0));};
</script></html>`;
}

async function main() {
  if (!installation) throw new Error("Set NETLOGO_HOME to an installed NetLogo with Paths.");
  const directory = compileMouseBridge();
  const model = path.join(installation.home, "models/Sample Models/Social Science/Paths.nlogo");
  const original = fs.readFileSync(model);
  let bridge, browser;
  try {
    bridge = await openMouseBridge(directory, model);
    browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || "msedge", headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 1000 }, deviceScaleFactor: 2 });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.exposeFunction("sendMouse", mouse => bridge.mouse(mouse.inside, mouse.down, mouse.u, mouse.v));
    await page.setContent(previewSource());
    const settle = () => page.evaluate(() => window.finishMouseWrites());
    const frame = async () => page.evaluate(frame => window.setFrame(frame), "data:image/png;base64," + await bridge.view());
    const point = async (u, v) => page.locator('.two-view').evaluate((host, { u, v }) => {
      const rect = host.getBoundingClientRect(), image = host.querySelector('img');
      const scale = Math.min(rect.width / image.naturalWidth, rect.height / image.naturalHeight);
      const width = scale * image.naturalWidth, height = scale * image.naturalHeight;
      return { x: rect.left + (rect.width - width) / 2 + u * width, y: rect.top + (rect.height - height) / 2 + v * height };
    }, { u, v });
    let checks = 0;
    for (const [width, height] of [[600, 450], [310, 640], [500, 500]]) {
      for (const zoom of [0.8, 1, 1.25]) {
        await page.locator('.widget').evaluate((element, { width, height, zoom }) => {
          element.style.width = width + 'px'; element.style.height = height + 'px'; element.style.zoom = zoom;
          window.fitFrame();
        }, { width, height, zoom });
        await bridge.command("random-seed 24680 set walker-count 0 setup go");
        await frame();
        const gaps = await page.locator('.two-view').evaluate(host => {
          const rect = host.getBoundingClientRect(), image = host.querySelector('img');
          const scale = Math.min(rect.width / image.naturalWidth, rect.height / image.naturalHeight);
          return [rect.width - image.naturalWidth * scale, rect.height - image.naturalHeight * scale];
        });
        assert.ok(gaps.every(gap => gap < 1), 'The fitted frame must not leave letterboxes: ' + gaps);
        const at = await point(0.25, 0.25);
        await page.mouse.move(at.x, at.y);
        await page.mouse.down();
        await settle();
        await bridge.command("go");
        assert.equal(await bridge.report("count buildings"), "1.0");
        assert.deepEqual(JSON.parse(await bridge.report("[ (list xcor ycor) ] of buildings")), [[-25, 25]]);
        await page.evaluate(() => { window.originalHost = document.querySelector('.two-view'); });
        await frame();
        assert.equal(await page.evaluate(() => window.originalHost === document.querySelector('.two-view')), true);
        assert.equal(await bridge.report("mouse-down?"), "true", "Swapping decoded PNGs must not release a held pointer");
        await bridge.command("repeat 3 [go]");
        assert.equal(await bridge.report("count buildings"), "1.0");
        await page.mouse.up();
        await settle();
        await bridge.command("go");
        await page.mouse.down();
        await settle();
        await bridge.command("go");
        assert.equal(await bridge.report("count buildings"), "0.0", "Clicking the same building again removes it");
        await page.mouse.up();
        await settle();
        await bridge.command("go");

        const rect = await page.locator('.two-view').boundingBox();
        await page.mouse.move(rect.x + rect.width + 3, rect.y + rect.height / 2);
        await page.mouse.down();
        await settle();
        assert.equal(await bridge.report("mouse-inside?"), "false");
        await bridge.command("go");
        assert.equal(await bridge.report("count buildings"), "0.0", "Outside the fitted frame cannot place buildings");
        await page.mouse.up();
        await settle();
        checks++;
      }
    }

    const at = await point(0.5, 0.5);
    for (const reset of [() => window.setMode('layout'), () => window.setTab('info'), () => window.dispatchEvent(new Event('blur'))]) {
      await page.mouse.move(at.x, at.y);
      await page.mouse.down();
      await settle();
      assert.equal(await bridge.report("mouse-down?"), "true");
      await page.evaluate(reset);
      await settle();
      assert.equal(await bridge.report("mouse-down?"), "false");
      await page.mouse.up();
      await settle();
      await page.evaluate(() => { window.setMode('interact'); window.setTab('interface'); });
      checks++;
    }
    await page.evaluate(() => window.setMode('layout'));
    await page.mouse.move(at.x + 2, at.y + 2);
    await page.mouse.down();
    await settle();
    assert.equal(await bridge.report("mouse-down?"), "false", "Layout must not send model presses");
    await page.mouse.up();
    assert.equal(await page.locator('.view-footer').count(), 0);
    assert.deepEqual(errors, []);
    assert.ok(original.equals(fs.readFileSync(model)));
    console.log(JSON.stringify({ checks, browser: await browser.version(), model: path.basename(model), errors, modelUnchanged: true }));
  } finally {
    await browser?.close();
    await bridge?.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { previewSource };
