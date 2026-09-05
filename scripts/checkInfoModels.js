// Read-only corpus check. Requires npm ci + npm run compile, not a running JVM.
const fs = require("node:fs");
const path = require("node:path");
const { parseHTML } = require("linkedom");
const markdownit = require("markdown-it");
const { parseNetLogoModel } = require("../out/modelFormat");
const { createInfoMarkdownRenderer } = require("../resources/infoMarkdown");

function checkInfoModels(root) {
  const { document } = parseHTML("<html><body></body></html>");
  const renderer = createInfoMarkdownRenderer({ document, markdownit });
  const result = { models: 0, headings: 0, tables: 0, codeBlocks: 0, images: 0, errors: [], unsafe: [] };
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) { visit(file); continue; }
      if (!entry.isFile() || !/\.(?:nlogo(?:3d)?|nlogox)$/i.test(file)) continue;
      const name = path.relative(root, file);
      result.models++;
      try {
        const model = parseNetLogoModel(fs.readFileSync(file, "utf8"), file);
        const article = renderer.render(model.info);
        result.headings += article.querySelectorAll("h1,h2,h3,h4,h5,h6").length;
        result.tables += article.querySelectorAll("table").length;
        result.codeBlocks += article.querySelectorAll("pre code").length;
        result.images += article.querySelectorAll(".info-image").length;
        if (article.querySelector("script,iframe,object,embed,svg,style,[onclick],[onerror],[onload]")) result.unsafe.push(name);
      } catch (error) { result.errors.push({ model: name, error: error.message }); }
    }
  }
  visit(root);
  return result;
}

if (require.main === module) {
  const root = path.join(process.env.NETLOGO_HOME || "/Applications/NetLogo 6.4.0", "models");
  const result = checkInfoModels(root);
  console.log(JSON.stringify(result, null, 2));
  if (!result.models || result.errors.length || result.unsafe.length) process.exitCode = 1;
}
module.exports = { checkInfoModels };
