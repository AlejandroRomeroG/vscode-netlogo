// Keep the browser parser and its license in the VSIX, without a CDN at runtime.
const fs = require("node:fs");
const path = require("node:path");
const source = path.dirname(require.resolve("markdown-it/package.json"));
const target = path.join(__dirname, "../resources/vendor/markdown-it");
fs.mkdirSync(target, { recursive: true });
fs.copyFileSync(path.join(source, "dist/markdown-it.min.js"), path.join(target, "markdown-it.min.js"));
fs.copyFileSync(path.join(source, "LICENSE"), path.join(target, "LICENSE"));
