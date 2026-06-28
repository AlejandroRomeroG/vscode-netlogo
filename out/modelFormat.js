"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseNetLogoModel = parseNetLogoModel;
exports.serializeNetLogoModel = serializeNetLogoModel;
const ClassicSeparator = "@#$#@#$#@";
function parseNetLogoModel(text, fileName = "") {
    if (isXmlModel(text, fileName)) {
        return parseXmlModel(text);
    }
    return parseClassicModel(text);
}
function serializeNetLogoModel(model) {
    if (model.format === "xml") {
        return serializeXmlModel(model);
    }
    return [model.code, model.interfaceSource, model.info, ...model.rest].join(ClassicSeparator);
}
function isXmlModel(text, fileName) {
    return fileName.toLowerCase().endsWith(".nlogox") || /^\s*<\?xml[\s\S]*<netlogo/i.test(text) || /^\s*<netlogo/i.test(text);
}
function parseClassicModel(text) {
    const parts = text.split(ClassicSeparator);
    return {
        format: "classic",
        code: parts[0] ?? "",
        interfaceSource: parts[1] ?? "",
        info: parts[2] ?? "",
        rest: parts.slice(3),
        originalText: text
    };
}
function parseXmlModel(text) {
    return {
        format: "xml",
        code: readXmlElement(text, "code"),
        interfaceSource: readXmlElementRaw(text, "widgets"),
        info: readXmlElement(text, "info"),
        rest: [],
        originalText: text
    };
}
function serializeXmlModel(model) {
    let text = model.originalText;
    text = writeXmlElement(text, "code", model.code, "text");
    text = writeXmlElement(text, "widgets", model.interfaceSource, "raw");
    text = writeXmlElement(text, "info", model.info, "text");
    return text;
}
function readXmlElement(xml, tagName) {
    const raw = readXmlElementRaw(xml, tagName);
    const cdata = raw.match(/^\s*<!\[CDATA\[([\s\S]*)\]\]>\s*$/);
    return cdata ? cdata[1] : decodeXml(raw);
}
function readXmlElementRaw(xml, tagName) {
    const expression = new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "i");
    const match = xml.match(expression);
    return match?.[1] ?? "";
}
function writeXmlElement(xml, tagName, value, mode) {
    const expression = new RegExp(`(<${tagName}\\b[^>]*>)([\\s\\S]*?)(<\\/${tagName}>)`, "i");
    const match = xml.match(expression);
    const serializedValue = mode === "raw" ? value : serializeXmlText(value, match?.[2] ?? "");
    if (match) {
        return xml.replace(expression, `$1${serializedValue}$3`);
    }
    const closingRoot = xml.match(/<\/netlogo>\s*$/i);
    if (closingRoot) {
        const insert = `\n  <${tagName}>${serializedValue}</${tagName}>\n`;
        return xml.slice(0, closingRoot.index) + insert + xml.slice(closingRoot.index);
    }
    return `${xml}\n<${tagName}>${serializedValue}</${tagName}>\n`;
}
function serializeXmlText(value, previousRawValue) {
    if (/^\s*<!\[CDATA\[[\s\S]*\]\]>\s*$/.test(previousRawValue) || /[<>&]/.test(value)) {
        return `<![CDATA[${value.replace(/\]\]>/g, "]]]]><![CDATA[>")}]]>`;
    }
    return encodeXml(value);
}
function decodeXml(value) {
    return value
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, "\"")
        .replace(/&apos;/g, "'")
        .replace(/&amp;/g, "&");
}
function encodeXml(value) {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;");
}
//# sourceMappingURL=modelFormat.js.map