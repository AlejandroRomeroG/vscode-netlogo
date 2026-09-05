const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const { parseHTML } = require("linkedom");
const markdownit = require("markdown-it");
const { createInfoMarkdownRenderer, safeHref } = require("../resources/infoMarkdown");
const { parseNetLogoModel } = require("../out/modelFormat");

function fixture(options = {}) {
  const { document, window } = parseHTML("<html><body></body></html>");
  const renderer = createInfoMarkdownRenderer({ document, markdownit, ...options });
  function render(source) { const article = renderer.render(source); document.body.replaceChildren(article); return article; }
  return { document, window, renderer, render };
}

test("Info renders six heading levels, nested lists, references, emphasis and NetLogo line breaks", () => {
  const { render } = fixture();
  const article = render("# Main\n\n## Section\n\n### Third\n\n#### Fourth\n\n##### Fifth\n\n###### Sixth\n\n_**Nested**_ &amp; **_formatting_**.\nNew line.\n\n- Outer\n  - Inner\n    - Deep\n\n3. Three\n4. Four\n\n[reference][ref]\n\n[ref]: https://example.org/\n");
  assert.equal(article.querySelectorAll("h1,h2,h3,h4,h5,h6").length, 6);
  assert.equal(article.querySelector("em strong").textContent, "Nested");
  assert.equal(article.querySelector("strong em").textContent, "formatting");
  assert.equal(article.querySelectorAll("br").length, 1);
  assert.equal(article.querySelector("ul ul ul li").textContent, "Deep");
  assert.equal(article.querySelector("ol").getAttribute("start"), "3");
  assert.equal(article.querySelector("a").href, "https://example.org/");
  assert.doesNotMatch(article.textContent, /\[ref\]:|&amp;/);
});

test("Info preserves Markdown and legacy HTML tables, chemistry subscripts and superscripts", () => {
  const { render } = fixture();
  const article = render("| Species | Value |\n|:---|---:|\n|H<sub>2</sub>O|10<sup>-7</sup>|\n\n<table border><tr><th>Acid<th>pKa<tr><td>HOAc<td>4.8</table>\n\n> H<sub>3</sub>O<sup>+</sup>\n> a second line\n\n---");
  assert.equal(article.querySelectorAll("table").length, 2);
  assert.equal(article.querySelectorAll(".info-table-scroll[tabindex='0']").length, 2);
  assert.equal(article.querySelectorAll("table")[1].querySelectorAll("td").length, 2);
  assert.equal(article.querySelector("sub").textContent, "2");
  assert.equal(article.querySelector("sup").textContent, "-7");
  assert.equal(article.querySelector("th:last-child").style.textAlign, "right");
  assert.equal(article.querySelectorAll("blockquote").length, 1);
  assert.ok(article.querySelector("blockquote br"));
  assert.ok(article.querySelector("hr"));
});

test("Info preserves literal ASCII diagrams and longer fences, highlighting only NetLogo blocks", () => {
  const highlighted = [];
  const { render } = fixture({ highlightCode: (element, value) => { highlighted.push(value); element.textContent = value; } });
  const diagram = "A  <=======>  B\n  x &amp; y\n";
  const article = render("```text\n" + diagram + "```\n\n````text\n```\nnot a fence end\n```\n````\n\n    to go\n      tick\n    end\n\n~~~netlogo\ncrt 2\n~~~");
  const code = [...article.querySelectorAll("pre code")];
  assert.equal(code.length, 4);
  assert.equal(code[0].textContent, diagram);
  assert.equal(code[1].textContent, "```\nnot a fence end\n```\n");
  assert.deepEqual(highlighted, ["to go\n  tick\nend\n", "crt 2\n"]);
});

test("Info strips comments and active HTML instead of mounting model-supplied markup", () => {
  const { render } = fixture();
  const article = render('## Safe\n\n<!-- invisible citation -->\n\n<script>bad()</script>\n\n<div onclick="bad()" style="position:fixed" id="outside"><strong>Visible</strong><iframe src="https://evil.test"></iframe><svg onload="bad()"><script>bad()</script></svg><input autofocus><style>body{display:none}</style></div>\n\n<a href="javascript:bad()" onmouseover="bad()">blocked link</a>\n\n<img src="data:image/svg+xml,bad" onerror="bad()" alt="Fallback">');
  assert.equal(article.querySelector("script,iframe,svg,input,style,[onclick],[onerror],[onmouseover],[style]"), null);
  assert.equal(article.querySelector("#outside"), null);
  assert.equal(article.querySelector("a").hasAttribute("href"), false);
  assert.doesNotMatch(article.textContent, /invisible citation|bad\(\)|display:none/);
  assert.match(article.textContent, /Visible/);
  assert.match(article.textContent, /Fallback/);
});

test("Info links retain nested inline code, bare URLs, balanced destinations and click navigation", () => {
  const opened = [];
  const { render, window } = fixture({ openLink: href => opened.push(href) });
  const article = render('[`tick`](https://example.org/function_(tick)) and https://example.org/auto.\n\n[Local](file:docs/My%20file.md)');
  assert.equal(article.querySelector("a code").textContent, "tick");
  const links = [...article.querySelectorAll("a")];
  assert.equal(links.length, 3);
  let parentClicks = 0;
  article.addEventListener("click", () => parentClicks++);
  for (const link of links) link.dispatchEvent(new window.Event("click", { bubbles: true, cancelable: true }));
  assert.deepEqual(opened, ["https://example.org/function_(tick)", "https://example.org/auto", "file:docs/My%20file.md"]);
  assert.equal(parentClicks, 0, "Link clicks must not become edit gestures");
  for (const href of ["javascript:alert(1)", "command:workbench.action.closeWindow", "data:text/html,bad", "//evil.test", "https://user:secret@evil.test", "https://evil.test\n"]) assert.equal(safeHref(href), null);
});

test("Info remote images require a deliberate click and local images accept only checked raster data", () => {
  const requests = [];
  const { render, window, renderer } = fixture({ requestImage: (id, href) => requests.push({ id, href }) });
  const article = render("![Remote](https://example.org/image.png)\n\n![Local](file:Picture%20one.png)");
  assert.equal(article.querySelectorAll("img").length, 0);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].href, "file:Picture%20one.png");
  article.querySelector("button").dispatchEvent(new window.Event("click", { bubbles: true, cancelable: true }));
  assert.equal(article.querySelector("img").getAttribute("src"), "https://example.org/image.png");
  renderer.acceptImage(requests[0].id, "data:image/png;base64,iVBORw0KGgo=");
  assert.equal(article.querySelectorAll("img").length, 2);
  article.querySelector("img").dispatchEvent(new window.Event("error"));
  assert.match(article.textContent, /Remote — image unavailable/);
  const next = render("![Local](file:Picture%20one.png)");
  renderer.acceptImage(requests.at(-1).id, "data:image/svg+xml;base64,ABC=");
  assert.equal(next.querySelector("img"), null);
  assert.match(next.textContent, /image unavailable/);
});

test("Info click-to-source maps nested formatting, entities, escapes, Unicode, CRLF and code exactly", () => {
  const { render, renderer } = fixture();
  const source = '## Title\r\n\r\nPrefix _**niño 🌳**_ &amp; \\*literal\\* [`tick`](https://example.org/tick) suffix.\r\n\r\n```\r\nto go\r\n  tick\r\nend\r\n```';
  const article = render(source);
  const spans = [...article.querySelectorAll("span[data-source-start]")];
  function check(text, index, expected) {
    const span = spans.find(element => element.textContent === text);
    assert.ok(span, `Missing text: ${text}`);
    const walker = span.ownerDocument.createTreeWalker(span, 4);
    let node;
    while ((node = walker.nextNode()) && index > node.textContent.length) index -= node.textContent.length;
    assert.equal(renderer.sourceOffsetForRange({ startContainer: node, startOffset: index }), expected, text);
  }
  check("Title", 3, source.indexOf("Title") + 3);
  check("niño 🌳", 5, source.indexOf("niño 🌳") + 5);
  check(" & *literal* ", 1, source.indexOf("&amp;"));
  check(" & *literal* ", 2, source.indexOf("&amp;") + 5);
  check(" & *literal* ", 3, source.indexOf("\\*literal"));
  check("tick", 2, source.indexOf("[`tick`]") + 4);
  check(" suffix.", 3, source.indexOf(" suffix.") + 3);
  const code = article.querySelector("pre code");
  assert.equal(renderer.sourceOffsetForRange({ startContainer: code.firstChild, startOffset: 8 }), source.indexOf("  tick") + 2);
});

test("Info empty content has a useful placeholder and heading anchors are unique", () => {
  const { render } = fixture();
  assert.match(render("<!-- only comment -->").textContent, /Choose Edit/);
  const article = render("## Repeated\n\n## Repeated\n\n## Repeated");
  assert.deepEqual([...article.querySelectorAll("h2")].map(element => element.id), ["info-repeated", "info-repeated-1", "info-repeated-2"]);
});

test("NetLogo two-space ordered nesting preserves source offsets and literal list examples", () => {
  const { render, renderer } = fixture();
  const source = "## Lists\n\n  1. Outer\n    1. Inner\n      1. Deep\n    2. Sibling\n  2. Next\n\n```text\n  1. Outer\n    1. Inner\n```\n\n    1. Literal code\n      1. Not a list\n";
  const article = render(source);
  assert.equal(article.querySelector("ol ol ol li").textContent.trim(), "Deep");
  assert.equal(article.querySelector("ol ol > li:nth-child(2)").textContent.trim(), "Sibling");
  const inner = [...article.querySelectorAll("span[data-source-start]")].find(node => node.textContent === "Inner");
  assert.equal(renderer.sourceOffsetForRange({ startContainer: inner.firstChild, startOffset: 2 }), source.indexOf("Inner") + 2);
  assert.equal(article.querySelector("pre code").textContent, "  1. Outer\n    1. Inner\n");
  assert.equal(article.querySelectorAll("pre code")[1].textContent, "1. Literal code\n  1. Not a list\n");
});

test("Info internal anchors navigate and legacy HTML blocks retain a source location", () => {
  const { render, renderer, window } = fixture();
  const source = "<!-- hidden -->\n\n## Heading\n\n[Jump](#heading)\n\n<table><tr><td>Cell</td></tr></table>\n";
  const article = render(source);
  assert.equal(article.firstElementChild.tagName, "H2");
  let scrolled = false;
  article.querySelector("h2").scrollIntoView = () => { scrolled = true; };
  article.querySelector("a").dispatchEvent(new window.Event("click", { bubbles: true, cancelable: true }));
  assert.equal(scrolled, true);
  assert.equal(renderer.sourceOffsetForRange({ startContainer: article.querySelector("td").firstChild, startOffset: 2 }), source.indexOf("<table>"));
});

const modelRoot = path.join(process.env.NETLOGO_HOME || "/Applications/NetLogo 6.4.0", "models");
test("the local model corpus renders without exceptions or active model HTML", { skip: !fs.existsSync(modelRoot) }, () => {
  const result = require("../scripts/checkInfoModels").checkInfoModels(modelRoot);
  assert.ok(result.models > 0);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.unsafe, []);
});

test("Info ships its exact local Markdown parser and license, before the editor script", () => {
  const root = path.join(__dirname, "..");
  const bundled = path.join(root, "resources/vendor/markdown-it");
  const installed = path.dirname(require.resolve("markdown-it/package.json"));
  assert.deepEqual(fs.readFileSync(path.join(bundled, "markdown-it.min.js")), fs.readFileSync(path.join(installed, "dist/markdown-it.min.js")));
  assert.deepEqual(fs.readFileSync(path.join(bundled, "LICENSE")), fs.readFileSync(path.join(installed, "LICENSE")));
  const { html } = require("./helpers/plotLayout").plotLayoutSource();
  assert.ok(html.indexOf("markdown-it.min.js") < html.indexOf("infoMarkdown.js"));
  assert.ok(html.indexOf("infoMarkdown.js") < html.indexOf("createInfoMarkdownRenderer"));
  assert.doesNotMatch(html, /<script[^>]+src="https?:/);
});

test("real NetLogo Info examples cover disease documentation, tables, legacy HTML and Markdown teaching material", { skip: !fs.existsSync(modelRoot) }, () => {
  const { render } = fixture();
  function model(name) { const file = path.join(modelRoot, name); return render(parseNetLogoModel(fs.readFileSync(file, "utf8"), file).info); }
  const spread = model("IABM Textbook/chapter 6/Spread of Disease.nlogo");
  assert.ok(spread.querySelector('a code'));
  assert.ok(spread.querySelector('a[href="http://www.intro-to-abm.com/"]'));
  assert.doesNotMatch(spread.textContent, /<!--|\[CC BY|`tick`/);
  const info = model("Code Examples/Info Tab Example.nlogo");
  assert.ok(info.querySelector("h4"));
  assert.ok(info.querySelector("ul ul"));
  assert.ok(info.querySelector("ol ol"));
  assert.ok(info.querySelector("sub"));
  assert.ok(info.querySelector("sup"));
  assert.ok(info.querySelector("blockquote br"));
  const acid = model("Sample Models/Chemistry & Physics/Chemical Reactions/Acids and Bases/Weak Acid.nlogo");
  assert.equal(acid.querySelectorAll("table tr").length, 5);
  assert.ok(acid.querySelector("td sup"));
  const dilemma = model("Sample Models/Social Science/Prisoner's Dilemma/Prisoner's Dilemma Basic.nlogo");
  assert.match(dilemma.querySelector("pre code").textContent, /Your Action \| Partner's Action/);
});
