export type NetLogoFormat = "classic" | "xml";

export interface NetLogoModel {
  readonly format: NetLogoFormat;
  readonly code: string;
  readonly interfaceSource: string;
  readonly info: string;
  readonly rest: readonly string[];
  readonly originalText: string;
}

const ClassicSeparator = "@#$#@#$#@";

export function parseNetLogoModel(text: string, fileName = ""): NetLogoModel {
  if (isXmlModel(text, fileName)) {
    return parseXmlModel(text);
  }

  return parseClassicModel(text);
}

export function serializeNetLogoModel(model: NetLogoModel): string {
  if (model.format === "xml") {
    return serializeXmlModel(model);
  }

  return [model.code, model.interfaceSource, model.info, ...model.rest].join(ClassicSeparator);
}

function isXmlModel(text: string, fileName: string): boolean {
  return fileName.toLowerCase().endsWith(".nlogox") || /^\s*<\?xml[\s\S]*<netlogo/i.test(text) || /^\s*<netlogo/i.test(text);
}

function parseClassicModel(text: string): NetLogoModel {
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

function parseXmlModel(text: string): NetLogoModel {
  return {
    format: "xml",
    code: readXmlElement(text, "code"),
    interfaceSource: readXmlElementRaw(text, "widgets"),
    info: readXmlElement(text, "info"),
    rest: [],
    originalText: text
  };
}

function serializeXmlModel(model: NetLogoModel): string {
  let text = model.originalText;
  text = writeXmlElement(text, "code", model.code, "text");
  text = writeXmlElement(text, "widgets", model.interfaceSource, "raw");
  text = writeXmlElement(text, "info", model.info, "text");
  return text;
}

function readXmlElement(xml: string, tagName: string): string {
  const raw = readXmlElementRaw(xml, tagName);
  const cdata = raw.match(/^\s*<!\[CDATA\[([\s\S]*)\]\]>\s*$/);
  return cdata ? cdata[1] : decodeXml(raw);
}

function readXmlElementRaw(xml: string, tagName: string): string {
  const expression = new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "i");
  const match = xml.match(expression);
  return match?.[1] ?? "";
}

function writeXmlElement(xml: string, tagName: string, value: string, mode: "raw" | "text"): string {
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

function serializeXmlText(value: string, previousRawValue: string): string {
  if (/^\s*<!\[CDATA\[[\s\S]*\]\]>\s*$/.test(previousRawValue) || /[<>&]/.test(value)) {
    return `<![CDATA[${value.replace(/\]\]>/g, "]]]]><![CDATA[>")}]]>`;
  }

  return encodeXml(value);
}

function decodeXml(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function encodeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
