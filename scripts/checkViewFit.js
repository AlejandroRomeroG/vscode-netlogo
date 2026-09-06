// Geometry checks for the production 2D view at multiple image/widget aspects,
// fonts and zooms. Synthetic PNG fixtures; no native model or app is opened.
const assert = require("node:assert/strict");
const { chromium } = require("playwright");
const { previewSource } = require("./checkViewMouse");

async function main() {
  const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || "msedge", headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 1200 }, deviceScaleFactor: 2 });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.exposeFunction("sendMouse", () => {});
    await page.setContent(previewSource());
    const result = await page.evaluate(async () => {
      const fixtures = [
        { name: 'Paths', width: 513, height: 514, imageWidth: 505, imageHeight: 505 },
        { name: 'Traffic', width: 1030, height: 190, imageWidth: 1020, imageHeight: 180 },
        { name: 'Mouse Drag One', width: 473, height: 324, imageWidth: 465, imageHeight: 315 },
        { name: 'Tall world', width: 210, height: 600, imageWidth: 101, imageHeight: 401 },
        { name: 'Wide frame', width: 650, height: 160, imageWidth: 505, imageHeight: 505 },
        { name: 'Tall frame', width: 160, height: 650, imageWidth: 505, imageHeight: 505 },
        { name: 'Minimum frame', width: 80, height: 80, imageWidth: 701, imageHeight: 501 }
      ];
      const checks = [];
      for (const fixture of fixtures) for (const zoom of [0.8, 1, 1.25]) for (const font of [11, 13, 16]) for (const mode of ['interact', 'layout']) {
        const widget = document.querySelector('.widget');
        window.setMode(mode);
        widget.classList.toggle('selected', mode === 'layout');
        widget.style.width = fixture.width + 'px'; widget.style.height = fixture.height + 'px';
        widget.style.zoom = zoom;
        document.documentElement.style.setProperty('--vscode-font-size', font + 'px');
        window.fitFrame();
        const canvas = document.createElement('canvas');
        canvas.width = fixture.imageWidth; canvas.height = fixture.imageHeight;
        const context = canvas.getContext('2d');
        context.fillStyle = '#55aa33'; context.fillRect(0, 0, canvas.width, canvas.height);
        context.fillStyle = '#ff3333'; context.fillRect(0, 0, 4, canvas.height);
        context.fillStyle = '#3333ff'; context.fillRect(canvas.width - 4, 0, 4, canvas.height);
        await window.setFrame(canvas.toDataURL());
        const host = widget.querySelector('.two-view'), image = host.querySelector('img');
        const rect = host.getBoundingClientRect(), outer = widget.getBoundingClientRect();
        const scale = Math.min(rect.width / image.naturalWidth, rect.height / image.naturalHeight);
        checks.push({ name: fixture.name, zoom, font, mode,
          horizontalGap: rect.width - image.naturalWidth * scale,
          verticalGap: rect.height - image.naturalHeight * scale,
          withinBounds: outer.width <= fixture.width * zoom + 1 && outer.height <= fixture.height * zoom + 1,
          declaredBoundsIntact: widget.style.width === fixture.width + 'px' && widget.style.height === fixture.height + 'px',
          fit: getComputedStyle(image).objectFit,
          hasFooter: !!widget.querySelector('.view-footer') });
      }
      return checks;
    });
    const failed = result.filter(check => check.horizontalGap >= 1 || check.verticalGap >= 1 || !check.withinBounds
      || !check.declaredBoundsIntact || check.fit !== 'contain' || check.hasFooter);
    console.log(JSON.stringify({ checks: result.length, failed, errors, browser: await browser.version() }));
    assert.deepEqual(failed, []);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
