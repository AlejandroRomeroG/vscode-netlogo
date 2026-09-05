const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { externalInfoUrl, resolveInfoLocalFile, loadInfoLocalImage } = require("../out/infoResources");

test("Info external links only accept explicit web/email schemes without credentials or controls", () => {
  assert.equal(externalInfoUrl("https://example.org/docs#go"), "https://example.org/docs#go");
  assert.equal(externalInfoUrl("mailto:reader@example.org"), "mailto:reader@example.org");
  for (const href of ["javascript:alert(1)", "command:open", "file:/etc/passwd", "data:text/html,test", "//example.org", "https://user:secret@example.org", "https://example.org/\n", "mailto:test@example.org?subject=a%0d%0abcc:b@example.org"]) {
    assert.equal(externalInfoUrl(href), undefined, href);
  }
});

test("Info resolves encoded local image names without crossing the model directory or following an outside symlink", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "netlogo-info-resources-"));
  try {
    const root = path.join(directory, "model");
    fs.mkdirSync(root);
    const model = path.join(root, "Example.nlogo");
    const file = path.join(root, "Picture one.png");
    const bytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aSncAAAAASUVORK5CYII=", "base64");
    fs.writeFileSync(file, bytes);
    fs.writeFileSync(path.join(directory, "outside.png"), bytes);
    fs.symlinkSync(path.join(directory, "outside.png"), path.join(root, "outside-link.png"));
    assert.equal(await resolveInfoLocalFile(model, "file:Picture%20one.png"), fs.realpathSync(file));
    assert.equal(await loadInfoLocalImage(model, "Picture%20one.png"), "data:image/png;base64," + bytes.toString("base64"));
    for (const href of ["../outside.png", "%2e%2e/outside.png", "file:/etc/passwd", "file:%2fetc/passwd", "outside-link.png", "javascript:alert(1)", "file:command:run", "%00.png", "https://example.org/image.png"]) {
      await assert.rejects(resolveInfoLocalFile(model, href), undefined, href);
    }
    fs.writeFileSync(path.join(root, "not-image.png"), '<svg onload="alert(1)"></svg>');
    await assert.rejects(loadInfoLocalImage(model, "not-image.png"), /Supported documentation images/);
    fs.writeFileSync(path.join(root, "large.png"), Buffer.alloc(8 * 1024 * 1024 + 1));
    await assert.rejects(loadInfoLocalImage(model, "large.png"), /8 MB/);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
