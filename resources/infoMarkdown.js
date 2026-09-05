/* Theme-independent Info rendering. markdown-it is bundled locally under MIT.
 * Parser HTML is only read in an inert template, then rebuilt with an allowlist.
 * No model-supplied element, event handler, style, or resource is mounted directly.
 */
(function (root) {
  "use strict";

  function createInfoMarkdownRenderer(options) {
    const { document, markdownit } = options;
    const md = markdownit({ html: true, breaks: true, linkify: true, typographer: false });
    // NetLogo documents explicitly use file:relative/path for local resources.
    md.validateLink = href => safeHref(href) !== null;
    const allowed = new Set("article section div span p h1 h2 h3 h4 h5 h6 ul ol li blockquote pre code em strong b i s del u sub sup kbd br hr a img table thead tbody tfoot tr th td caption dl dt dd".split(" "));
    const forbidden = new Set("script style iframe object embed form input button select textarea svg math video audio link meta base template".split(" "));
    const sourceMaps = new WeakMap();
    const loadedRemote = new Set();
    let maps = [], source = "", pendingImages = new Map(), requestId = 0;

    function mapId(mapping) { maps.push(mapping); return String(maps.length - 1); }
    function range(start, end, offsets) { return { start, end, offsets }; }
    function bounded(value) { return Math.max(0, Math.min(source.length, value)); }

    // Decode only Markdown text escapes/entities, retaining the original UTF-16
    // offsets. The source itself is never normalized or rewritten when rendering.
    function decodedUnits(raw) {
      let text = "";
      const starts = [], ends = [];
      for (let i = 0; i < raw.length;) {
        const match = /^(?:\\[!"#$%&'()*+,\-./:;<=>?@[\]\\^_`{|}~]|&(?:#[xX][\da-fA-F]+|#\d+|[a-zA-Z][a-zA-Z\d]+);)/.exec(raw.slice(i));
        const part = match ? match[0] : raw[i];
        const value = match ? md.utils.unescapeAll(part) : part;
        for (let j = 0; j < value.length; j++) { starts.push(i); ends.push(i + part.length); }
        text += value;
        i += part.length;
      }
      return { text, starts, ends };
    }

    function contentOffsets(content, start, end) {
      const offsets = [];
      let cursor = start;
      const lines = content.split("\n");
      for (let index = 0; index < lines.length; index++) {
        const line = lines[index];
        let at = source.indexOf(line, cursor);
        if (at < cursor || at + line.length > end) at = cursor;
        for (let i = 0; i < line.length; i++) offsets.push(bounded(at + i));
        cursor = at + line.length;
        if (index < lines.length - 1) {
          const newline = source.indexOf("\n", cursor);
          offsets.push(bounded(newline >= 0 && newline < end ? newline : cursor));
          cursor = newline >= 0 && newline < end ? newline + 1 : cursor;
        } else offsets.push(bounded(cursor));
      }
      // One entry per source character boundary, including the final boundary.
      return offsets.slice(0, content.length + 1);
    }

    function annotateInline(token, start, end) {
      const raw = token.content;
      const offsets = contentOffsets(raw, start, end);
      const units = decodedUnits(raw);
      let cursor = 0;
      const links = [];
      const absolute = position => offsets[Math.min(offsets.length - 1, position)] ?? start;
      for (const child of token.children || []) {
        if (child.type === "link_open") {
          const explicit = child.markup !== "linkify" && child.markup !== "autolink";
          links.push(explicit);
          if (explicit) { const at = raw.indexOf("[", cursor); if (at >= cursor) cursor = at + 1; }
        } else if (child.type === "link_close") {
          if (links.pop()) cursor = skipLinkEnd(raw, cursor);
        } else if (["em_open", "em_close", "strong_open", "strong_close", "s_open", "s_close"].includes(child.type)) {
          const at = raw.indexOf(child.markup, cursor);
          if (at >= cursor) cursor = at + child.markup.length;
        } else if (child.type === "html_inline") {
          const at = raw.indexOf(child.content, cursor);
          if (at >= cursor) cursor = at + child.content.length;
        } else if (child.type === "softbreak" || child.type === "hardbreak") {
          const at = raw.indexOf("\n", cursor);
          if (at >= cursor) cursor = at + 1;
        } else if (child.type === "image") {
          const at = raw.indexOf("![", cursor);
          const finish = skipLinkEnd(raw, at >= 0 ? at + 2 : cursor);
          child.attrSet("data-info-map", mapId(range(absolute(Math.max(cursor, at)), absolute(finish))));
          cursor = finish;
        } else if (child.type === "code_inline") {
          const at = raw.indexOf(child.markup, cursor);
          const finish = at >= 0 ? raw.indexOf(child.markup, at + child.markup.length) : -1;
          if (finish >= 0) {
            let begin = at + child.markup.length;
            const inner = raw.slice(begin, finish).replace(/\n/g, " ");
            if (inner.startsWith(" ") && inner.endsWith(" ") && /\S/.test(inner)) begin++;
            child.meta = { infoMap: mapId(range(absolute(begin), absolute(begin + child.content.length),
              Array.from({ length: child.content.length + 1 }, (_, i) => absolute(begin + i)))) };
            cursor = finish + child.markup.length;
          }
        } else if (child.type === "text" || child.type === "text_special") {
          if (!child.content) continue;
          let from = units.starts.findIndex(position => position >= cursor);
          if (from < 0) from = units.text.length;
          const at = units.text.indexOf(child.content, from);
          if (at >= 0) {
            const finish = at + child.content.length - 1;
            const positions = units.starts.slice(at, finish + 1).map(absolute);
            positions.push(absolute(units.ends[finish]));
            child.meta = { infoMap: mapId(range(positions[0], positions.at(-1), positions)) };
            cursor = units.ends[finish];
          }
        }
      }
    }

    function skipLinkEnd(raw, from) {
      const close = raw.indexOf("]", from);
      if (close < 0) return from;
      let cursor = close + 1;
      if (raw[cursor] === "(") {
        let depth = 1;
        while (++cursor < raw.length && depth) {
          if (raw[cursor] === "\\") { cursor++; continue; }
          if (raw[cursor] === "(") depth++;
          if (raw[cursor] === ")") depth--;
        }
        return Math.min(raw.length, cursor);
      }
      if (raw[cursor] === "[") { const end = raw.indexOf("]", cursor + 1); if (end >= 0) return end + 1; }
      return cursor;
    }

    function tokenText(token) {
      const text = md.utils.escapeHtml(token.content);
      return token.meta?.infoMap !== undefined ? `<span data-info-map="${token.meta.infoMap}">${text}</span>` : text;
    }
    md.renderer.rules.text = (tokens, index) => tokenText(tokens[index]);
    md.renderer.rules.code_inline = (tokens, index) => `<code>${tokenText(tokens[index])}</code>`;
    // Legacy models contain HTML tables. Keep a block source range even when
    // their text does not have Markdown inline tokens (never jump to offset 0).
    md.renderer.rules.html_block = (tokens, index) => `<div data-info-map="${tokens[index].meta.infoMap}">${tokens[index].content}</div>\n`;
    for (const type of ["fence", "code_block"]) {
      md.renderer.rules[type] = (tokens, index) => {
        const token = tokens[index];
        const language = token.info.trim().split(/\s+/)[0].toLowerCase();
        const highlight = !language || language === "netlogo" || language === "nlogo";
        return `<pre><code data-info-map="${token.meta.infoMap}"${highlight ? ' class="language-netlogo"' : ''}>${md.utils.escapeHtml(token.content)}</code></pre>\n`;
      };
    }

    function parseNetLogoMarkdown(value, env) {
      const tokens = md.parse(value, env);
      // NetLogo's Info Tab Example uses two spaces per nested list level,
      // including ordered markers, which CommonMark otherwise treats as prose.
      // Adjust parser-only indentation inside known lists. Line numbers and the
      // model source stay unchanged; literal fenced/indented code is protected.
      const lines = value.split("\n");
      const inList = new Set(), literal = new Set(), adjacentCode = new Set();
      for (const token of tokens) {
        if (!token.map) continue;
        const target = /^(?:ordered|bullet)_list_open$/.test(token.type) ? inList
          : ["fence", "code_block", "html_block"].includes(token.type) ? literal : null;
        if (target) for (let line = token.map[0]; line < token.map[1]; line++) target.add(line);
      }
      for (const token of tokens) {
        // A legacy sibling starting with "2." can terminate a CommonMark list
        // and be classified as code. Only reconsider immediately adjacent list
        // markers, never a separated code example or a fenced block.
        if (token.type === "code_block" && inList.has(token.map[0] - 1) && lines[token.map[0] - 1].trim()) {
          for (let line = token.map[0]; line < token.map[1]; line++) adjacentCode.add(line);
        }
      }
      const stack = [];
      let changed = false;
      const normalized = lines.map((line, index) => {
        const indent = /^ */.exec(line)[0].length;
        const legacySibling = adjacentCode.has(index) && stack.some(parent => indent === parent.indent + 2);
        if (!inList.has(index) && !legacySibling) { stack.length = 0; return line; }
        const marker = (!literal.has(index) || legacySibling) && /^( *)(?:\d{1,9}[.)]|[-+*]) +(?! )\S/.exec(line);
        if (marker) {
          while (stack.length && stack.at(-1).indent >= indent) stack.pop();
          const parent = stack.at(-1);
          let shift = parent?.shift || 0;
          if (parent && indent === parent.indent + 2) shift = Math.max(shift, parent.content - indent);
          const content = /^( *)(?:\d{1,9}[.)]|[-+*]) +/.exec(line)[0].length + shift;
          stack.push({ indent, shift, content });
        } else if (line.trim() && !literal.has(index)) {
          while (stack.length && indent <= stack.at(-1).indent) stack.pop();
        }
        const shift = stack.at(-1)?.shift || 0;
        changed ||= shift > 0;
        return " ".repeat(shift) + line;
      });
      // Reference definitions share env; reparse into a fresh environment.
      if (changed) { for (const key of Object.keys(env)) delete env[key]; return md.parse(normalized.join("\n"), env); }
      return tokens;
    }

    function render(markdown) {
      source = String(markdown ?? "");
      maps = [];
      pendingImages = new Map();
      const env = {};
      const tokens = parseNetLogoMarkdown(source, env);
      const lineStarts = [0];
      for (let i = 0; i < source.length; i++) if (source[i] === "\n") lineStarts.push(i + 1);
      lineStarts.push(source.length);
      let start = 0, end = source.length, inlineCursor = 0;
      for (const token of tokens) {
        if (token.map) {
          start = lineStarts[token.map[0]] ?? source.length;
          end = lineStarts[token.map[1]] ?? source.length;
          inlineCursor = start;
          if (token.nesting === 1) token.attrSet("data-info-map", mapId(range(start, end)));
        }
        if (token.type === "inline") {
          annotateInline(token, inlineCursor, end);
          const at = source.indexOf(token.content, inlineCursor);
          if (at >= inlineCursor && at < end) inlineCursor = at + token.content.length;
        } else if (token.type === "fence" || token.type === "code_block") {
          const bodyStart = token.type === "fence" ? (lineStarts[token.map[0] + 1] ?? start) : start;
          const positions = contentOffsets(token.content, bodyStart, end);
          token.meta = { infoMap: mapId(range(positions[0] ?? start, positions.at(-1) ?? end, positions)) };
        } else if (token.type === "html_block") {
          token.meta = { infoMap: mapId(range(start, end)) };
        }
      }
      const template = document.createElement("template");
      template.innerHTML = md.renderer.render(tokens, md.options, env);
      const article = document.createElement("article");
      article.className = "info-document";
      for (const child of template.content.childNodes) appendSafe(article, child);
      // Comment-only HTML blocks must not create spacing ahead of a heading.
      for (const block of article.querySelectorAll("div[data-source-start]")) {
        if (!block.textContent.trim() && !block.querySelector("img,.info-image,br,hr,table")) block.remove();
      }
      const headings = new Map();
      for (const heading of article.querySelectorAll("h1,h2,h3,h4,h5,h6")) {
        const key = slug(heading.textContent);
        const count = headings.get(key) || 0;
        headings.set(key, count + 1);
        heading.id = "info-" + key + (count ? "-" + count : "");
      }
      for (const table of article.querySelectorAll("table")) {
        const container = document.createElement("div");
        container.className = "info-table-scroll";
        container.tabIndex = 0;
        container.setAttribute("role", "region");
        container.setAttribute("aria-label", table.querySelector("caption")?.textContent || "Documentation table");
        table.replaceWith(container);
        container.append(table);
      }
      for (const code of article.querySelectorAll("pre > code.language-netlogo")) {
        if (options.highlightCode) {
          const value = code.textContent;
          code.replaceChildren();
          options.highlightCode(code, value);
        }
      }
      if (!article.textContent.trim() && !article.querySelector("img")) {
        const empty = document.createElement("p");
        empty.className = "info-empty";
        empty.textContent = "This model has no documentation yet. Choose Edit to add it.";
        article.append(empty);
      }
      return article;
    }

    function appendSafe(parent, input) {
      if (input.nodeType === 3) { parent.append(document.createTextNode(input.textContent)); return; }
      if (input.nodeType !== 1) return; // Includes invisible HTML comments.
      const tag = input.tagName.toLowerCase();
      if (forbidden.has(tag)) return;
      if (!allowed.has(tag)) { for (const child of input.childNodes) appendSafe(parent, child); return; }
      if (tag === "img") { parent.append(renderImage(input)); return; }
      const element = document.createElement(tag);
      const mapping = maps[Number(input.getAttribute("data-info-map"))];
      if (input.hasAttribute("data-info-map") && mapping) {
        element.dataset.sourceStart = String(mapping.start);
        element.dataset.sourceEnd = String(mapping.end);
        if (mapping.offsets) sourceMaps.set(element, mapping.offsets);
      }
      if (tag === "code" && input.classList.contains("language-netlogo")) element.className = "language-netlogo";
      if (input.hasAttribute("title")) element.title = input.getAttribute("title");
      if (tag === "ol" && /^\d{1,9}$/.test(input.getAttribute("start") || "")) element.setAttribute("start", input.getAttribute("start"));
      if (tag === "td" || tag === "th") {
        for (const attr of ["colspan", "rowspan"]) {
          const value = Number(input.getAttribute(attr));
          if (Number.isInteger(value) && value >= 1 && value <= 100) element.setAttribute(attr, String(value));
        }
        const alignment = /(?:^|;)\s*text-align:\s*(left|center|right)\s*(?:;|$)/i.exec(input.getAttribute("style") || "");
        if (alignment) element.style.textAlign = alignment[1].toLowerCase();
      }
      if (tag === "a") {
        const href = safeHref(input.getAttribute("href"));
        if (href) {
          element.href = href;
          element.addEventListener("click", event => {
            event.preventDefault(); event.stopPropagation();
            if (href.startsWith("#")) {
              let anchor;
              try { anchor = decodeURIComponent(href.slice(1)); } catch { return; }
              const target = element.closest(".info-document")?.querySelectorAll("[id]");
              Array.from(target || []).find(item => item.id === "info-" + anchor || item.id === "info-" + slug(anchor))?.scrollIntoView({ block: "start" });
            } else options.openLink?.(href);
          });
        }
      }
      for (const child of input.childNodes) appendSafe(element, child);
      parent.append(element);
    }

    function renderImage(input) {
      const container = document.createElement("span");
      container.className = "info-image";
      const alt = input.getAttribute("alt") || "Documentation image";
      const href = safeHref(input.getAttribute("src"));
      const label = document.createElement("span");
      label.className = "info-image-label";
      label.textContent = alt;
      container.append(label);
      function display(src) {
        const image = document.createElement("img");
        image.alt = alt;
        image.decoding = "async";
        image.loading = "lazy";
        image.referrerPolicy = "no-referrer";
        image.addEventListener("error", () => { label.textContent = alt + " — image unavailable"; container.replaceChildren(label); });
        image.src = src;
        container.replaceChildren(image);
      }
      if (href && /^https?:/i.test(href)) {
        if (loadedRemote.has(href)) display(href);
        else {
          const button = document.createElement("button");
          button.type = "button";
          button.className = "info-load-image";
          button.textContent = "Load image";
          button.title = "Load external image from " + new URL(href).hostname;
          button.addEventListener("click", event => {
            event.preventDefault(); event.stopPropagation();
            loadedRemote.add(href); display(href);
          });
          container.append(button);
        }
      } else if (href && !/^(?:#|mailto:)/i.test(href)) {
        const id = String(++requestId);
        pendingImages.set(id, { display, label, alt });
        options.requestImage?.(id, href);
      } else label.textContent = alt + " — unsupported image address";
      return container;
    }

    function acceptImage(id, data, error) {
      const pending = pendingImages.get(id);
      if (!pending) return;
      pendingImages.delete(id);
      if (typeof data === "string" && /^data:image\/(?:png|jpeg|gif|webp);base64,[a-z\d+/=]+$/i.test(data)) pending.display(data);
      else pending.label.textContent = pending.alt + " — " + (error || "image unavailable");
    }

    function sourceOffsetForRange(selection) {
      const target = selection?.startContainer;
      const element = (target?.nodeType === 1 ? target : target?.parentElement)?.closest?.("[data-source-start]");
      if (!element) return null;
      const positions = sourceMaps.get(element);
      if (!positions || target.nodeType !== 3) return Number(element.dataset.sourceStart);
      let offset = selection.startOffset;
      const walker = document.createTreeWalker(element, 4);
      let current;
      while ((current = walker.nextNode()) && current !== target) offset += current.textContent.length;
      return positions[Math.min(offset, positions.length - 1)];
    }

    return { render, acceptImage, sourceOffsetForRange };
  }

  function slug(text) {
    return String(text).trim().toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, "").replace(/\s+/g, "-") || "section";
  }

  function safeHref(value) {
    if (typeof value !== "string" || !value || /[\u0000-\u0020\u007f\\]/.test(value)) return null;
    if (value.startsWith("#")) return value;
    if (/^https?:|^mailto:/i.test(value)) {
      try {
        const url = new URL(value);
        return !url.username && !url.password && !/%0[ad]/i.test(value) ? url.href : null;
      } catch { return null; }
    }
    const relative = value.replace(/^file:/i, "");
    if (/^[a-z][a-z\d+.-]*:/i.test(relative) || /^[\/]/.test(relative)) return null;
    return value;
  }

  const api = { createInfoMarkdownRenderer, safeHref };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.NetLogoInfoMarkdown = api;
})(globalThis);
