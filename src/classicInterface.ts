import type { NetLogoFormat } from "./modelFormat";
import { createChooserCodec, type ChooserValue } from "./chooserValues";

const chooserCodec = createChooserCodec();

export interface InterfacePreview {
  readonly widgets: readonly InterfaceWidget[];
  readonly bounds: InterfaceBounds;
}

export interface InterfaceBounds {
  readonly width: number;
  readonly height: number;
}

export interface PlotPen {
  readonly name: string;
  readonly interval: number;
  readonly mode: number;
  readonly color: number;
  readonly inLegend: boolean;
  readonly setupCode: string;
  readonly updateCode: string;
}

export type WidgetPropertyValue = ChooserValue | readonly PlotPen[];

export interface InterfaceWidget {
  readonly id: string;
  readonly type: string;
  readonly kind: WidgetKind;
  readonly label: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly raw: readonly string[];
  readonly runCommand?: string;
  readonly details?: Record<string, WidgetPropertyValue>;
}

export interface WidgetBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export type WidgetPropertyUpdates = Record<string, WidgetPropertyValue>;

export interface MonitorReporter {
  readonly widgetId: string;
  readonly label: string;
  readonly source: string;
}

export interface PlotExporter {
  readonly widgetId: string;
  readonly label: string;
  readonly plotName: string;
}

export type WidgetKind =
  | "view"
  | "button"
  | "slider"
  | "switch"
  | "chooser"
  | "monitor"
  | "plot"
  | "input"
  | "textbox"
  | "output"
  | "generic";

export type AddableWidgetKind = Exclude<WidgetKind, "generic">;

const KnownClassicWidgetTypes = new Set([
  "GRAPHICS-WINDOW",
  "BUTTON",
  "SLIDER",
  "SWITCH",
  "CHOOSER",
  "MONITOR",
  "PLOT",
  "INPUTBOX",
  "TEXTBOX",
  "OUTPUT",
  "CC-WINDOW",
  "VIEW"
]);

export function parseInterfacePreview(source: string, format: NetLogoFormat): InterfacePreview {
  const parsedWidgets = format === "xml" ? parseXmlWidgets(source) : parseClassicWidgets(source);
  const widgets = format === "xml" ? parsedWidgets : positionExternal3DViews(parsedWidgets);
  return {
    widgets,
    bounds: getBounds(widgets)
  };
}

export function parseClassicWidgets(source: string): readonly InterfaceWidget[] {
  return getClassicBlocks(source)
    .map((block, index) => parseClassicWidgetBlock(block, index))
    .filter((widget): widget is InterfaceWidget => widget !== undefined);
}

export function updateInterfaceWidgetBounds(
  source: string,
  format: NetLogoFormat,
  widgetId: string,
  bounds: WidgetBounds
): string {
  return format === "xml"
    ? updateXmlWidgetBounds(source, widgetId, bounds)
    : updateClassicWidgetBounds(source, widgetId, bounds);
}

export function updateInterfaceWidgetProperties(
  source: string,
  format: NetLogoFormat,
  widgetId: string,
  updates: WidgetPropertyUpdates
): string {
  if (updates.choices !== undefined) {
    if (!chooserCodec.isChoices(updates.choices) || updates.choices.length === 0) {
      throw new Error("A chooser needs at least one valid choice.");
    }
    const widget = parseInterfacePreview(source, format).widgets.find(candidate => candidate.id === widgetId);
    if (widget?.kind === "chooser") {
      const previous = chooserCodec.isChoices(widget.details?.choices) ? widget.details.choices : [];
      updates = { ...updates, selectedIndex: chooserCodec.selectionAfterEdit(previous, Number(widget.details?.selectedIndex), updates.choices) };
      if (!widget.details?.choicesError && chooserCodec.format(previous) === chooserCodec.format(updates.choices as readonly ChooserValue[])) {
        delete updates.choices;
      }
    }
  }
  return format === "xml"
    ? updateXmlWidgetProperties(source, widgetId, updates)
    : updateClassicWidgetProperties(source, widgetId, updates);
}

export function createInterfaceWidget(
  source: string,
  format: NetLogoFormat,
  kind: AddableWidgetKind,
  bounds: WidgetBounds
): string {
  return format === "xml"
    ? createXmlWidget(source, kind, bounds)
    : createClassicWidget(source, kind, bounds);
}

export function deleteInterfaceWidget(source: string, format: NetLogoFormat, widgetId: string): string {
  return format === "xml"
    ? deleteXmlWidget(source, widgetId)
    : deleteClassicWidget(source, widgetId);
}

export function getWidgetRuntimeCommands(widgets: readonly InterfaceWidget[]): readonly string[] {
  return widgets
    .map(widgetRuntimeCommand)
    .filter((command): command is string => command !== undefined);
}

export function getMonitorReporters(widgets: readonly InterfaceWidget[]): readonly MonitorReporter[] {
  return widgets
    .filter(widget => widget.kind === "monitor")
    .map(widget => ({
      widgetId: widget.id,
      label: widget.label,
      source: String(widget.details?.source ?? "")
    }))
    .filter(monitor => monitor.source.trim().length > 0);
}

export function getPlotExporters(widgets: readonly InterfaceWidget[]): readonly PlotExporter[] {
  return widgets
    .filter(widget => widget.kind === "plot")
    .map(widget => ({
      widgetId: widget.id,
      label: widget.label,
      plotName: widget.label
    }))
    .filter(plot => plot.plotName.trim().length > 0);
}

function getClassicBlocks(source: string): string[][] {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const blocks: string[][] = [];
  let current: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (KnownClassicWidgetTypes.has(trimmed)) {
      if (current.length > 0) {
        blocks.push(trimTrailingBlankLines(current));
      }
      current = [trimmed];
    } else if (current.length > 0) {
      current.push(line);
    }
  }

  if (current.length > 0) {
    blocks.push(trimTrailingBlankLines(current));
  }

  return blocks;
}

function updateClassicWidgetBounds(source: string, widgetId: string, bounds: WidgetBounds): string {
  const targetIndex = parseWidgetId(widgetId, "classic");
  if (targetIndex === undefined) {
    return source;
  }

  const lineEnding = source.includes("\r\n") ? "\r\n" : "\n";
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const starts: number[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    if (KnownClassicWidgetTypes.has(lines[index].trim())) {
      starts.push(index);
    }
  }

  const start = starts[targetIndex];
  if (start === undefined || start + 4 >= lines.length) {
    return source;
  }

  const normalized = normalizeBounds(bounds);
  lines[start + 1] = String(normalized.x);
  lines[start + 2] = String(normalized.y);
  lines[start + 3] = String(normalized.x + normalized.width);
  lines[start + 4] = String(normalized.y + normalized.height);
  return lines.join(lineEnding);
}

function updateClassicWidgetProperties(source: string, widgetId: string, updates: WidgetPropertyUpdates): string {
  const targetIndex = parseWidgetId(widgetId, "classic");
  if (targetIndex === undefined) {
    return source;
  }

  const lineEnding = source.includes("\r\n") ? "\r\n" : "\n";
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const starts = getClassicWidgetStarts(lines);
  const start = starts[targetIndex];
  if (start === undefined) {
    return source;
  }

  const type = lines[start].trim();
  const offsets = classicPropertyOffsets(type);
  let changed = false;

  for (const [property, value] of Object.entries(updates)) {
    const offset = offsets[property];
    if (offset === undefined) {
      continue;
    }

    const absoluteIndex = start + offset;
    while (lines.length <= absoluteIndex) {
      lines.push("");
    }

    const nextValue = serializeClassicProperty(type, property, value);
    if (lines[absoluteIndex] !== nextValue) {
      lines[absoluteIndex] = nextValue;
      changed = true;
    }
  }

  if (type === "PLOT") {
    changed = updateClassicPlotCommands(lines, start, updates) || changed;
    changed = updateClassicPlotPens(lines, start, updates) || changed;
  }

  return changed ? lines.join(lineEnding) : source;
}

function updateClassicPlotCommands(lines: string[], start: number, updates: WidgetPropertyUpdates): boolean {
  if (!("setupCode" in updates) && !("updateCode" in updates)) {
    return false;
  }

  const end = findClassicWidgetEnd(lines, start);
  const pensIndex = lines.findIndex((line, index) => index >= start && index < end && line.trim() === "PENS");
  if (pensIndex < 0) {
    return false;
  }

  const commandIndex = start + 14;
  const hasCommandLine = commandIndex < pensIndex;
  const current = hasCommandLine ? parsePlotCommands(lines[commandIndex]) : { setupCode: "", updateCode: "" };
  const setupCode = typeof updates.setupCode === "string" ? updates.setupCode : current.setupCode;
  const updateCode = typeof updates.updateCode === "string" ? updates.updateCode : current.updateCode;
  const serialized = `${serializeClassicQuoted(setupCode)} ${serializeClassicQuoted(updateCode)}`;

  if (!hasCommandLine) {
    lines.splice(pensIndex, 0, serialized);
    return true;
  }

  if (lines[commandIndex] === serialized) {
    return false;
  }

  lines[commandIndex] = serialized;
  return true;
}

function updateClassicPlotPens(
  lines: string[],
  start: number,
  updates: WidgetPropertyUpdates
): boolean {
  if (!("pens" in updates) || !isPlotPenArray(updates.pens)) {
    return false;
  }

  const end = findClassicWidgetEnd(lines, start);
  const pensIndex = lines.findIndex((line, index) => index >= start && index < end && line.trim() === "PENS");
  if (pensIndex < 0) {
    return false;
  }

  let penEnd = Math.min(end, lines.length);
  while (penEnd > pensIndex + 1 && lines[penEnd - 1].trim() === "") {
    penEnd -= 1;
  }

  const serializedPens = updates.pens.map(serializeClassicPlotPen);
  const currentPens = lines.slice(pensIndex + 1, penEnd);
  if (currentPens.length === serializedPens.length && currentPens.every((line, index) => line === serializedPens[index])) {
    return false;
  }

  lines.splice(pensIndex + 1, penEnd - pensIndex - 1, ...serializedPens);
  return true;
}

function findClassicWidgetEnd(lines: readonly string[], start: number): number {
  const nextWidgetIndex = lines.findIndex((line, index) => index > start && KnownClassicWidgetTypes.has(line.trim()));
  return nextWidgetIndex < 0 ? lines.length : nextWidgetIndex;
}

function createClassicWidget(source: string, kind: AddableWidgetKind, bounds: WidgetBounds): string {
  const lineEnding = source.includes("\r\n") ? "\r\n" : "\n";
  const block = classicWidgetTemplate(kind, normalizeBounds(bounds)).join(lineEnding);
  if (source.trim().length === 0) {
    return block;
  }

  const separator = source.endsWith(lineEnding + lineEnding) ? "" : source.endsWith(lineEnding) ? lineEnding : lineEnding + lineEnding;
  return `${source}${separator}${block}`;
}

function deleteClassicWidget(source: string, widgetId: string): string {
  const targetIndex = parseWidgetId(widgetId, "classic");
  if (targetIndex === undefined) {
    return source;
  }

  const lineEnding = source.includes("\r\n") ? "\r\n" : "\n";
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const starts = getClassicWidgetStarts(lines);
  const start = starts[targetIndex];
  if (start === undefined) {
    return source;
  }

  const end = starts[targetIndex + 1] ?? lines.length;
  lines.splice(start, end - start);
  return lines.join(lineEnding).replace(new RegExp(`(?:${escapeRegExp(lineEnding)}){3,}`, "g"), `${lineEnding}${lineEnding}`);
}

function parseClassicWidgetBlock(block: readonly string[], index: number): InterfaceWidget | undefined {
  const type = block[0]?.trim();
  if (!type) {
    return undefined;
  }

  const box = parseClassicBox(block);
  if (!box) {
    return undefined;
  }

  switch (type) {
    case "GRAPHICS-WINDOW":
    case "VIEW":
      return {
        ...baseWidget(index, type, "view", "View", box, block),
        details: parseClassicViewDetails(block)
      };

    case "BUTTON": {
      const display = stringAt(block, 5);
      const code = stringAt(block, 6);
      const forever = booleanAt(block, 7);
      return {
        ...baseWidget(index, type, "button", display || code || "Button", box, block),
        runCommand: code || display,
        details: compactDetails({
          code,
          forever,
          buttonType: stringAt(block, 10),
          actionKey: stringAt(block, 12)
        })
      };
    }

    case "SLIDER":
      return {
        ...baseWidget(index, type, "slider", stringAt(block, 5) || stringAt(block, 6) || "Slider", box, block),
        details: compactDetails({
          variable: stringAt(block, 6),
          min: stringAt(block, 7),
          max: stringAt(block, 8),
          value: numberAt(block, 9),
          step: stringAt(block, 10),
          units: stringAt(block, 12),
          orientation: stringAt(block, 13)
        })
      };

    case "SWITCH":
      return {
        ...baseWidget(index, type, "switch", stringAt(block, 5) || stringAt(block, 6) || "Switch", box, block),
        details: compactDetails({
          variable: stringAt(block, 6),
          on: inverseBooleanAt(block, 7)
        })
      };

    case "CHOOSER":
      return {
        ...baseWidget(index, type, "chooser", stringAt(block, 5) || stringAt(block, 6) || "Chooser", box, block),
        details: compactDetails({
          variable: stringAt(block, 6),
          ...readChooserDetails(() => chooserCodec.parse(block[7] ?? ""), block[7] ?? ""),
          selectedIndex: numberAt(block, 8)
        })
      };

    case "MONITOR":
      return {
        ...baseWidget(index, type, "monitor", stringAt(block, 5) || stringAt(block, 6) || "Monitor", box, block),
        details: compactDetails({
          source: stringAt(block, 6),
          precision: numberAt(block, 7),
          fontSize: numberAt(block, 9)
        })
      };

    case "PLOT": {
      const commands = parsePlotCommands(block[14]);
      return {
        ...baseWidget(index, type, "plot", stringAt(block, 5) || "Plot", box, block),
        details: {
          ...compactDetails({
            xAxis: stringAt(block, 6),
            yAxis: stringAt(block, 7),
            xMin: numberAt(block, 8),
            xMax: numberAt(block, 9),
            yMin: numberAt(block, 10),
            yMax: numberAt(block, 11),
            autoplot: booleanAt(block, 12),
            legend: booleanAt(block, 13)
          }),
          setupCode: commands.setupCode,
          updateCode: commands.updateCode,
          pens: parsePlotPens(block)
        }
      };
    }

    case "INPUTBOX":
      return {
        ...baseWidget(index, type, "input", stringAt(block, 5) || "Input", box, block),
        details: compactDetails({
          variable: stringAt(block, 5),
          value: stringAt(block, 6),
          multiline: booleanAt(block, 7),
          inputType: stringAt(block, 9)
        })
      };

    case "TEXTBOX":
      return {
        ...baseWidget(index, type, "textbox", stringAt(block, 5) || "Text", box, block),
        details: compactDetails({
          text: stringAt(block, 5),
          fontSize: numberAt(block, 6),
          color: numberAt(block, 7),
          transparent: booleanAt(block, 8)
        })
      };

    case "OUTPUT":
      return {
        ...baseWidget(index, type, "output", "Output", box, block),
        details: compactDetails({
          fontSize: numberAt(block, 5)
        })
      };

    default:
      return baseWidget(index, type, "generic", type, box, block);
  }
}

function positionExternal3DViews(widgets: readonly InterfaceWidget[]): readonly InterfaceWidget[] {
  const controls = widgets.filter(widget => widget.kind !== "view");
  if (controls.length === 0) {
    return widgets;
  }

  const controlRight = Math.max(...controls.map(widget => widget.x + widget.width));
  const nextViewX = Math.max(280, controlRight + 24);
  return widgets.map(widget => {
    if (!isExternal3DView(widget)) {
      return widget;
    }
    return {
      ...widget,
      x: nextViewX
    };
  });
}

function isExternal3DView(widget: InterfaceWidget): boolean {
  return widget.kind === "view"
    && widget.x <= 20
    && widget.y <= 20
    && widget.details?.minPzcor !== undefined
    && widget.details?.maxPzcor !== undefined;
}

function parseClassicViewDetails(block: readonly string[]): Record<string, WidgetPropertyValue> {
  const tickCounterIndex = findClassicViewTickCounterIndex(block);
  const isThreeD = tickCounterIndex !== undefined && tickCounterIndex >= 26 && hasNumericRun(block, tickCounterIndex - 9, 6);
  const boundsStart = tickCounterIndex !== undefined
    ? tickCounterIndex - (isThreeD ? 9 : 7)
    : fallbackClassicViewBoundsStart(block);
  const updateModeIndex = tickCounterIndex !== undefined ? tickCounterIndex - 1 : boundsStart + (isThreeD ? 8 : 6);

  return compactDetails({
    patchSize: numberAt(block, 7),
    minPxcor: numberAt(block, boundsStart),
    maxPxcor: numberAt(block, boundsStart + 1),
    minPycor: numberAt(block, boundsStart + 2),
    maxPycor: numberAt(block, boundsStart + 3),
    minPzcor: isThreeD ? numberAt(block, boundsStart + 4) : undefined,
    maxPzcor: isThreeD ? numberAt(block, boundsStart + 5) : undefined,
    updateMode: numberAt(block, updateModeIndex) === 1 ? "Tick based" : "Continuous",
    tickCounter: tickCounterIndex !== undefined ? stringAt(block, tickCounterIndex) : undefined,
    frameRate: tickCounterIndex !== undefined ? numberAt(block, tickCounterIndex + 1) : undefined
  });
}

function findClassicViewTickCounterIndex(block: readonly string[]): number | undefined {
  for (let index = block.length - 2; index >= 16; index -= 1) {
    const label = block[index]?.trim();
    const nextNumeric = Number(block[index + 1]);
    if (label && !Number.isFinite(Number(label)) && Number.isFinite(nextNumeric)) {
      return index;
    }
  }

  return undefined;
}

function fallbackClassicViewBoundsStart(block: readonly string[]): number {
  if (hasNumericRun(block, 17, 4)) {
    return 17;
  }

  return 16;
}

function hasNumericRun(block: readonly string[], start: number, length: number): boolean {
  if (start < 0 || start + length > block.length) {
    return false;
  }

  for (let index = start; index < start + length; index += 1) {
    if (!Number.isFinite(Number(block[index]))) {
      return false;
    }
  }

  return true;
}

interface XmlWidgetElement {
  readonly tagName: string;
  readonly attrs: Record<string, string>;
  readonly box: Box;
  readonly start: number;
  readonly openingEnd: number;
  readonly innerStart: number;
  readonly innerEnd: number;
  readonly end: number;
  readonly openingTag: string;
  readonly inner: string;
  readonly closingTag: string;
  readonly source: string;
  readonly selfClosing: boolean;
}

const NonWidgetXmlTags = new Set([
  "widgets",
  "pen",
  "setup",
  "update",
  "setupcode",
  "updatecode",
  "source",
  "reporter"
]);

function findXmlWidgetElements(source: string): readonly XmlWidgetElement[] {
  const widgets: XmlWidgetElement[] = [];
  const expression = /<([a-zA-Z][\w:-]*)([^>]*)>/g;
  let match: RegExpExecArray | null;

  while ((match = expression.exec(source)) !== null) {
    const tagName = match[1].toLowerCase();
    if (NonWidgetXmlTags.has(tagName)) {
      continue;
    }

    const attrs = parseAttributes(match[2]);
    const box = parseXmlBox(attrs);
    if (!box) {
      continue;
    }

    const openingTag = match[0];
    const start = match.index;
    const openingEnd = start + openingTag.length;
    const selfClosing = /\/\s*>$/.test(openingTag);
    let innerEnd = openingEnd;
    let end = openingEnd;
    let closingTag = "";

    if (!selfClosing) {
      const closeExpression = new RegExp(`</${escapeRegExp(tagName)}\\s*>`, "i");
      const closeMatch = closeExpression.exec(source.slice(openingEnd));
      if (!closeMatch || closeMatch.index === undefined) {
        continue;
      }
      innerEnd = openingEnd + closeMatch.index;
      closingTag = closeMatch[0];
      end = innerEnd + closingTag.length;
      expression.lastIndex = end;
    }

    widgets.push({
      tagName,
      attrs,
      box,
      start,
      openingEnd,
      innerStart: openingEnd,
      innerEnd,
      end,
      openingTag,
      inner: source.slice(openingEnd, innerEnd),
      closingTag,
      source: source.slice(start, end),
      selfClosing
    });
  }

  return widgets;
}

function parseXmlWidgets(source: string): readonly InterfaceWidget[] {
  return findXmlWidgetElements(source).map((element, index) => {
    const { tagName, attrs, box } = element;
    const type = tagName.toUpperCase();
    const elementText = readXmlElementText(element);
    const kind = xmlKind(tagName);
    const details = normalizeXmlDetails(element, elementText);
    const label = kind === "monitor"
      ? ((attrs.display ?? String(details.source ?? "")) || type)
      : attrs.display ?? attrs.label ?? attrs.name ?? attrs.variable ?? (kind === "button" || kind === "textbox" ? elementText : undefined) ?? type;
    return {
      id: `xml-${index}`,
      type,
      kind,
      label,
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height,
      raw: [element.source],
      runCommand: xmlRunCommand(tagName, attrs, elementText),
      details
    };
  });
}

function updateXmlWidgetBounds(source: string, widgetId: string, bounds: WidgetBounds): string {
  const targetIndex = parseWidgetId(widgetId, "xml");
  if (targetIndex === undefined) {
    return source;
  }

  const element = findXmlWidgetElements(source)[targetIndex];
  if (!element) {
    return source;
  }

  const updatedTag = writeXmlBounds(element.openingTag, element.attrs, normalizeBounds(bounds));
  return replaceXmlOpeningTag(source, element, updatedTag);
}

function updateXmlWidgetProperties(source: string, widgetId: string, updates: WidgetPropertyUpdates): string {
  const targetIndex = parseWidgetId(widgetId, "xml");
  if (targetIndex === undefined) {
    return source;
  }

  const element = findXmlWidgetElements(source)[targetIndex];
  if (!element) {
    return source;
  }

  const updatedElement = updateXmlElementProperties(element, updates);
  return updatedElement === element.source
    ? source
    : source.slice(0, element.start) + updatedElement + source.slice(element.end);
}

function createXmlWidget(source: string, kind: AddableWidgetKind, bounds: WidgetBounds): string {
  const tag = xmlWidgetTemplate(kind, normalizeBounds(bounds));
  const lineEnding = source.includes("\r\n") ? "\r\n" : "\n";

  if (/<\/widgets>/i.test(source)) {
    return source.replace(/<\/widgets>/i, `${lineEnding}  ${tag}${lineEnding}</widgets>`);
  }

  if (source.trim().length === 0) {
    return tag;
  }

  return `${source}${source.endsWith("\n") ? "" : lineEnding}${tag}`;
}

function deleteXmlWidget(source: string, widgetId: string): string {
  const targetIndex = parseWidgetId(widgetId, "xml");
  if (targetIndex === undefined) {
    return source;
  }

  const element = findXmlWidgetElements(source)[targetIndex];
  if (!element) {
    return source;
  }

  const end = source[element.end] === "\n" ? element.end + 1 : element.end;
  return source.slice(0, element.start) + source.slice(end);
}

function baseWidget(
  index: number,
  type: string,
  kind: WidgetKind,
  label: string,
  box: Box,
  raw: readonly string[]
): InterfaceWidget {
  return {
    id: `classic-${index}`,
    type,
    kind,
    label: cleanDisplayValue(label),
    x: box.x,
    y: box.y,
    width: box.width,
    height: box.height,
    raw
  };
}

function parseClassicBox(block: readonly string[]): Box | undefined {
  const left = numberAt(block, 1);
  const top = numberAt(block, 2);
  const right = numberAt(block, 3);
  const bottom = numberAt(block, 4);

  if (left === undefined || top === undefined || right === undefined || bottom === undefined) {
    return undefined;
  }

  return {
    x: Math.max(0, left),
    y: Math.max(0, top),
    width: Math.max(32, right - left),
    height: Math.max(24, bottom - top)
  };
}

function parseXmlBox(attrs: Record<string, string>): Box | undefined {
  const left = numericAttr(attrs, "left", "x");
  const top = numericAttr(attrs, "top", "y");
  const right = numericAttr(attrs, "right");
  const bottom = numericAttr(attrs, "bottom");
  const width = numericAttr(attrs, "width", "w");
  const height = numericAttr(attrs, "height", "h");

  if (left === undefined || top === undefined) {
    return undefined;
  }

  if (right !== undefined && bottom !== undefined) {
    return {
      x: Math.max(0, left),
      y: Math.max(0, top),
      width: Math.max(32, right - left),
      height: Math.max(24, bottom - top)
    };
  }

  if (width !== undefined && height !== undefined) {
    return {
      x: Math.max(0, left),
      y: Math.max(0, top),
      width: Math.max(32, width),
      height: Math.max(24, height)
    };
  }

  return undefined;
}

function writeXmlBounds(tag: string, attrs: Record<string, string>, bounds: WidgetBounds): string {
  if ("left" in attrs || "top" in attrs) {
    let updated = writeXmlAttr(writeXmlAttr(tag, "left", bounds.x), "top", bounds.y);
    if ("right" in attrs || "bottom" in attrs) {
      updated = writeXmlAttr(writeXmlAttr(updated, "right", bounds.x + bounds.width), "bottom", bounds.y + bounds.height);
    } else {
      updated = writeXmlAttr(writeXmlAttr(updated, "width", bounds.width), "height", bounds.height);
    }
    return updated;
  }

  if ("width" in attrs || "height" in attrs) {
    return writeXmlAttr(writeXmlAttr(writeXmlAttr(writeXmlAttr(tag,
      "x", bounds.x),
      "y", bounds.y),
      "width", bounds.width),
      "height", bounds.height);
  }

  return writeXmlAttr(writeXmlAttr(writeXmlAttr(writeXmlAttr(tag,
    "x", bounds.x),
    "y", bounds.y),
    "width", bounds.width),
      "height", bounds.height);
}

function replaceXmlOpeningTag(source: string, element: XmlWidgetElement, updatedTag: string): string {
  return source.slice(0, element.start) + updatedTag + source.slice(element.openingEnd);
}

function updateXmlElementProperties(element: XmlWidgetElement, updates: WidgetPropertyUpdates): string {
  let openingTag = element.openingTag;
  let inner = element.inner;
  let needsChildren = false;

  for (const [property, value] of Object.entries(updates)) {
    if (element.tagName === "chooser" && property === "choices" && chooserCodec.isChoices(value)) {
      if ("choices" in element.attrs) openingTag = writeXmlAttr(openingTag, "choices", chooserCodec.format(value));
      else {
        inner = writeXmlChooserChoices(inner, value, xmlChildIndent(element));
        needsChildren = true;
      }
      continue;
    }
    if (element.tagName === "plot" && property === "autoplot" && typeof value === "boolean") {
      openingTag = writeXmlAttr(openingTag, xmlExistingAttrName(element.attrs, ["autoPlotX", "auto-plot-x"]) ?? "autoPlotX", String(value));
      openingTag = writeXmlAttr(openingTag, xmlExistingAttrName(element.attrs, ["autoPlotY", "auto-plot-y"]) ?? "autoPlotY", String(value));
      continue;
    }

    if (element.tagName === "plot" && (property === "setupCode" || property === "updateCode") && typeof value === "string") {
      const officialName = property === "setupCode" ? "setup" : "update";
      const childName = hasXmlPlotChild(inner, officialName)
        ? officialName
        : hasXmlPlotChild(inner, property) ? property : officialName;
      inner = writeXmlChildText(inner, childName, value, xmlChildIndent(element));
      needsChildren = true;
      continue;
    }

    if (element.tagName === "plot" && property === "pens" && isPlotPenArray(value)) {
      inner = writeXmlPlotPens(inner, value, xmlChildIndent(element));
      needsChildren = true;
      continue;
    }

    if (element.tagName === "monitor" && property === "source" && typeof value === "string") {
      const childName = hasXmlChild(inner, "source") ? "source" : hasXmlChild(inner, "reporter") ? "reporter" : undefined;
      if (childName) {
        inner = writeXmlChildText(inner, childName, value, xmlChildIndent(element));
        needsChildren = true;
        continue;
      }
      if (!element.selfClosing && readXmlElementText(element) !== undefined) {
        inner = writeXmlDirectText(inner, value);
        needsChildren = true;
        continue;
      }
    }

    const attrName = xmlPropertyAttributeName(element.attrs, element.tagName, property);
    if (attrName && !Array.isArray(value)) {
      openingTag = writeXmlAttr(openingTag, attrName, serializeXmlProperty(value));
    }
  }

  if (element.selfClosing && needsChildren) {
    const expandedOpening = openingTag.replace(/\/\s*>$/, ">");
    return `${expandedOpening}${inner}</${element.tagName}>`;
  }

  return `${openingTag}${inner}${element.closingTag}`;
}

function xmlExistingAttrName(attrs: Record<string, string>, candidates: readonly string[]): string | undefined {
  return candidates.find(name => name in attrs);
}

function xmlChildIndent(element: XmlWidgetElement): string {
  const lineStart = element.source.lastIndexOf("\n", Math.max(0, element.openingTag.length - 1));
  const outerIndent = lineStart >= 0
    ? element.source.slice(lineStart + 1).match(/^\s*/)?.[0] ?? ""
    : "";
  const existingIndent = element.inner.match(/\n([ \t]+)<(?:setup|update|setupCode|updateCode|pen)\b/i)?.[1];
  return existingIndent ?? `${outerIndent}  `;
}

function hasXmlChild(inner: string, childName: string): boolean {
  return new RegExp(`<${escapeRegExp(childName)}\\b`, "i").test(inner);
}

function hasXmlPlotChild(inner: string, childName: string): boolean {
  return hasXmlChild(withoutXmlPlotPens(inner), childName);
}

function writeXmlChildText(inner: string, childName: string, value: string, indent: string): string {
  const expression = new RegExp(`(<${escapeRegExp(childName)}\\b[^>]*>)([\\s\\S]*?)(</${escapeRegExp(childName)}\\s*>)`, "i");
  const match = expression.exec(inner);
  if (match && match.index !== undefined) {
    const content = /^\s*<!\[CDATA\[/.test(match[2]) && !value.includes("]]>")
      ? `<![CDATA[${value}]]>`
      : encodeXmlText(value);
    return inner.slice(0, match.index) + match[1] + content + match[3] + inner.slice(match.index + match[0].length);
  }

  return appendXmlChild(inner, `<${childName}>${encodeXmlText(value)}</${childName}>`, indent);
}

function writeXmlDirectText(inner: string, value: string): string {
  const content = /^\s*<!\[CDATA\[/.test(inner) && !value.includes("]]>")
    ? `<![CDATA[${value}]]>`
    : encodeXmlText(value);
  const leading = inner.match(/^\s*/)?.[0] ?? "";
  const trailing = inner.match(/\s*$/)?.[0] ?? "";
  return `${leading}${content}${trailing}`;
}

function writeXmlPlotPens(inner: string, pens: readonly PlotPen[], indent: string): string {
  if (samePlotPens(parseXmlPlotPens(inner), pens)) {
    return inner;
  }

  const expression = /<pen\b[^>]*?(?:\/\s*>|>[\s\S]*?<\/pen\s*>)/gi;
  const matches = Array.from(inner.matchAll(expression));
  const serialized = pens.map(pen => serializeXmlPlotPen(pen, indent)).join(`\n${indent}`);
  if (matches.length > 0) {
    const first = matches[0];
    const last = matches[matches.length - 1];
    const start = first.index ?? 0;
    const end = (last.index ?? 0) + last[0].length;
    return inner.slice(0, start) + serialized + inner.slice(end);
  }

  return serialized ? appendXmlChild(inner, serialized, indent) : inner;
}

function serializeXmlPlotPen(pen: PlotPen, indent: string): string {
  const attrs = [
    `display="${encodeXmlAttribute(pen.name)}"`,
    `interval="${encodeXmlAttribute(String(pen.interval))}"`,
    `mode="${pen.mode}"`,
    `color="${pen.color}"`,
    `legend="${pen.inLegend}"`
  ].join(" ");
  const childIndent = `${indent}  `;
  return [
    `<pen ${attrs}>`,
    `${childIndent}<setup>${encodeXmlText(pen.setupCode)}</setup>`,
    `${childIndent}<update>${encodeXmlText(pen.updateCode)}</update>`,
    `${indent}</pen>`
  ].join("\n");
}

function appendXmlChild(inner: string, child: string, indent: string): string {
  const lineEnding = inner.includes("\r\n") ? "\r\n" : "\n";
  const trailingWhitespace = inner.match(/\s*$/)?.[0] ?? "";
  const body = inner.slice(0, inner.length - trailingWhitespace.length);
  const separator = body.length === 0 ? `${lineEnding}${indent}` : `${lineEnding}${indent}`;
  const closingIndent = trailingWhitespace.includes("\n") ? trailingWhitespace : lineEnding;
  return `${body}${separator}${child}${closingIndent}`;
}

function samePlotPens(left: readonly PlotPen[], right: readonly PlotPen[]): boolean {
  return left.length === right.length && left.every((pen, index) => {
    const other = right[index];
    return other !== undefined
      && pen.name === other.name
      && pen.interval === other.interval
      && pen.mode === other.mode
      && pen.color === other.color
      && pen.inLegend === other.inLegend
      && pen.setupCode === other.setupCode
      && pen.updateCode === other.updateCode;
  });
}

function writeXmlAttr(tag: string, name: string, value: string | number): string {
  const escapedValue = encodeXmlAttribute(String(value));
  const expression = new RegExp(`(\\s${escapeRegExp(name)}\\s*=\\s*)(["'])(.*?)\\2`, "i");
  if (expression.test(tag)) {
    return tag.replace(expression, (_match, prefix: string, quote: string) => `${prefix}${quote}${escapedValue}${quote}`);
  }

  const insertAt = tag.endsWith("/>") ? tag.length - 2 : tag.length - 1;
  return `${tag.slice(0, insertAt)} ${name}="${escapedValue}"${tag.slice(insertAt)}`;
}

function encodeXmlText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function getBounds(widgets: readonly InterfaceWidget[]): InterfaceBounds {
  const width = Math.max(820, ...widgets.map(widget => widget.x + widget.width + 24));
  const height = Math.max(560, ...widgets.map(widget => widget.y + widget.height + 24));
  return { width, height };
}

function parseAttributes(source: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const expression = /([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>/]+))/g;
  let match: RegExpExecArray | null;

  while ((match = expression.exec(source)) !== null) {
    attrs[match[1]] = decodeXml(match[2] ?? match[3] ?? match[4] ?? "");
  }

  return attrs;
}

function readXmlElementText(element: XmlWidgetElement): string | undefined {
  if (element.selfClosing) {
    return undefined;
  }

  const text = element.inner.trim();
  return text && !/<[a-zA-Z][\w:-]*(?:\s|>)/.test(text) ? decodeXmlText(text) : undefined;
}

function xmlRunCommand(tagName: string, attrs: Record<string, string>, elementText?: string): string | undefined {
  if (attrs.code) {
    return attrs.code;
  }

  return xmlKind(tagName) === "button" ? elementText : undefined;
}

function normalizeXmlDetails(element: XmlWidgetElement, elementText?: string): Record<string, WidgetPropertyValue> {
  const { tagName, attrs } = element;
  const details: Record<string, WidgetPropertyValue> = { ...attrs };
  const kind = xmlKind(tagName);

  if (kind === "button") {
    details.code = attrs.code ?? elementText ?? "";
    details.forever = parseXmlBoolean(attrs.forever);
  }

  if (kind === "slider") {
    details.value = parseMaybeNumber(attrs.value ?? attrs.default);
  }

  if (kind === "switch") {
    details.on = parseXmlBoolean(attrs.on ?? attrs.value);
  }

  if (kind === "chooser") {
    Object.assign(details, readChooserDetails(() => "choices" in attrs
      ? chooserCodec.parse(attrs.choices)
      : parseXmlChooserChoices(element.inner), attrs.choices ?? ""));
    details.selectedIndex = parseMaybeNumber(attrs.current ?? attrs.selectedIndex ?? attrs["selected-index"] ?? attrs.selected);
  }

  if (kind === "monitor") {
    details.source = xmlMonitorSource(element, elementText);
    details.precision = parseMaybeNumber(attrs.precision);
    details.fontSize = parseMaybeNumber(attrs.fontSize ?? attrs["font-size"]);
  }

  if (kind === "textbox") {
    details.text = attrs.text ?? elementText ?? attrs.display ?? "";
    details.fontSize = parseMaybeNumber(attrs.fontSize ?? attrs["font-size"]);
  }

  if (kind === "plot") {
    const autoPlotX = parseXmlBoolean(attrs.autoPlotX ?? attrs["auto-plot-x"] ?? attrs.autoplot);
    const autoPlotY = parseXmlBoolean(attrs.autoPlotY ?? attrs["auto-plot-y"] ?? attrs.autoplot);
    Object.assign(details, compactDetails({
      xAxis: attrs.xAxis ?? attrs["x-axis"] ?? attrs.xLabel,
      yAxis: attrs.yAxis ?? attrs["y-axis"] ?? attrs.yLabel,
      xMin: parseMaybeNumber(attrs.xMin ?? attrs["x-min"]),
      xMax: parseMaybeNumber(attrs.xMax ?? attrs["x-max"]),
      yMin: parseMaybeNumber(attrs.yMin ?? attrs["y-min"]),
      yMax: parseMaybeNumber(attrs.yMax ?? attrs["y-max"]),
      autoplot: autoPlotX && autoPlotY,
      legend: parseXmlBoolean(attrs.legend)
    }));
    details.setupCode = readXmlPlotChildText(element.inner, "setup") ?? readXmlPlotChildText(element.inner, "setupCode") ?? "";
    details.updateCode = readXmlPlotChildText(element.inner, "update") ?? readXmlPlotChildText(element.inner, "updateCode") ?? "";
    details.pens = parseXmlPlotPens(element.inner);
  }

  return details;
}

function xmlMonitorSource(element: XmlWidgetElement, elementText?: string): string {
  return element.attrs.source
    ?? element.attrs.reporter
    ?? readXmlChildText(element.inner, "source")
    ?? readXmlChildText(element.inner, "reporter")
    ?? elementText
    ?? "";
}

function readXmlChildText(inner: string, childName: string): string | undefined {
  const expression = new RegExp(`<${escapeRegExp(childName)}\\b[^>]*>([\\s\\S]*?)</${escapeRegExp(childName)}\\s*>`, "i");
  const match = expression.exec(inner);
  return match ? decodeXmlText(match[1]) : undefined;
}

function readXmlPlotChildText(inner: string, childName: string): string | undefined {
  return readXmlChildText(withoutXmlPlotPens(inner), childName);
}

function withoutXmlPlotPens(inner: string): string {
  return inner.replace(/<pen\b[^>]*?(?:\/\s*>|>[\s\S]*?<\/pen\s*>)/gi, "");
}

function decodeXmlText(value: string): string {
  const trimmed = value.trim();
  const cdata = /^<!\[CDATA\[([\s\S]*)\]\]>$/.exec(trimmed);
  return cdata ? cdata[1] : decodeXml(trimmed);
}

function parseXmlPlotPens(inner: string): readonly PlotPen[] {
  const pens: PlotPen[] = [];
  const expression = /<pen\b([^>]*?)(?:\/\s*>|>([\s\S]*?)<\/pen\s*>)/gi;
  let match: RegExpExecArray | null;
  while ((match = expression.exec(inner)) !== null) {
    const attrs = parseAttributes(match[1]);
    const interval = Number(attrs.interval);
    const mode = Number(attrs.mode);
    const color = Number(attrs.color);
    if (!Number.isFinite(interval) || !Number.isInteger(mode) || !Number.isInteger(color)) {
      continue;
    }
    const penInner = match[2] ?? "";
    pens.push({
      name: attrs.display ?? attrs.name ?? "",
      interval,
      mode,
      color,
      inLegend: parseXmlBoolean(attrs.legend),
      setupCode: readXmlChildText(penInner, "setup") ?? readXmlChildText(penInner, "setupCode") ?? "",
      updateCode: readXmlChildText(penInner, "update") ?? readXmlChildText(penInner, "updateCode") ?? ""
    });
  }
  return pens;
}

function parseMaybeNumber(value: string | undefined): string | number {
  const numeric = Number(value);
  return value !== undefined && Number.isFinite(numeric) ? numeric : value ?? "";
}

function parseXmlBoolean(value: string | undefined): boolean {
  return /^(true|t|1)$/i.test(value ?? "");
}

function getClassicWidgetStarts(lines: readonly string[]): number[] {
  const starts: number[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (KnownClassicWidgetTypes.has(lines[index].trim())) {
      starts.push(index);
    }
  }
  return starts;
}

function classicPropertyOffsets(type: string): Record<string, number> {
  switch (type) {
    case "BUTTON":
      return { label: 5, code: 6, forever: 7 };
    case "SLIDER":
      return { label: 5, variable: 6, min: 7, max: 8, value: 9, step: 10, units: 12 };
    case "SWITCH":
      return { label: 5, variable: 6, on: 7 };
    case "CHOOSER":
      return { label: 5, variable: 6, choices: 7, selectedIndex: 8 };
    case "MONITOR":
      return { label: 5, source: 6, precision: 7 };
    case "PLOT":
      return {
        label: 5,
        xAxis: 6,
        yAxis: 7,
        xMin: 8,
        xMax: 9,
        yMin: 10,
        yMax: 11,
        autoplot: 12,
        legend: 13
      };
    case "INPUTBOX":
      return { label: 5, variable: 5, value: 6, multiline: 7 };
    case "TEXTBOX":
      return { label: 5, text: 5, fontSize: 6 };
    case "OUTPUT":
      return { fontSize: 5 };
    case "GRAPHICS-WINDOW":
    case "VIEW":
      return { patchSize: 7, tickCounter: 23 };
    default:
      return { label: 5 };
  }
}

function classicWidgetTemplate(kind: AddableWidgetKind, bounds: WidgetBounds): string[] {
  const right = bounds.x + bounds.width;
  const bottom = bounds.y + bounds.height;
  const base = (type: string): string[] => [type, String(bounds.x), String(bounds.y), String(right), String(bottom)];

  switch (kind) {
    case "view":
      return [
        ...base("GRAPHICS-WINDOW"),
        "-1",
        "-1",
        "13.0",
        "1",
        "10",
        "1",
        "1",
        "1",
        "0",
        "1",
        "1",
        "-16",
        "16",
        "-16",
        "16",
        "1",
        "1",
        "1",
        "ticks",
        "30.0"
      ];
    case "button":
      return [
        ...base("BUTTON"),
        "button",
        "setup",
        "NIL",
        "1",
        "T",
        "OBSERVER",
        "NIL",
        "NIL",
        "NIL",
        "1"
      ];
    case "slider":
      return [
        ...base("SLIDER"),
        "slider",
        "slider",
        "0",
        "100",
        "50",
        "1",
        "1",
        "",
        "HORIZONTAL"
      ];
    case "switch":
      return [
        ...base("SWITCH"),
        "switch?",
        "switch?",
        "1",
        "1",
        "-1000"
      ];
    case "chooser":
      return [
        ...base("CHOOSER"),
        "chooser",
        "chooser",
        '"one" "two"',
        "0"
      ];
    case "monitor":
      return [
        ...base("MONITOR"),
        "monitor",
        "ticks",
        "0",
        "1",
        "11"
      ];
    case "plot":
      return [
        ...base("PLOT"),
        "Plot",
        "x",
        "y",
        "0.0",
        "10.0",
        "0.0",
        "10.0",
        "true",
        "true",
        "\"\" \"\"",
        "PENS"
      ];
    case "input":
      return [
        ...base("INPUTBOX"),
        "input",
        "0",
        "NIL",
        "1",
        "0",
        "Number"
      ];
    case "textbox":
      return [
        ...base("TEXTBOX"),
        "Text",
        "11",
        "0",
        "true"
      ];
    case "output":
      return [
        ...base("OUTPUT"),
        "11"
      ];
  }
}

function xmlWidgetTemplate(kind: AddableWidgetKind, bounds: WidgetBounds): string {
  const tagName = kind === "input" ? "inputbox" : kind === "textbox" ? "textbox" : kind === "view" ? "view" : kind;
  const attrs: Record<string, string | number> = {
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height
  };

  switch (kind) {
    case "view":
      attrs.display = "View";
      attrs.patchSize = "13.0";
      break;
    case "button":
      attrs.display = "button";
      attrs.code = "setup";
      break;
    case "slider":
      attrs.display = "slider";
      attrs.variable = "slider";
      attrs.min = "0";
      attrs.max = "100";
      attrs.value = "50";
      attrs.step = "1";
      break;
    case "switch":
      attrs.display = "switch?";
      attrs.variable = "switch?";
      attrs.on = "false";
      break;
    case "chooser":
      attrs.display = "chooser";
      attrs.variable = "chooser";
      attrs.current = "0";
      break;
    case "monitor":
      attrs.display = "monitor";
      attrs.precision = "0";
      attrs.fontSize = "11";
      break;
    case "plot":
      attrs.display = "Plot";
      attrs.xAxis = "x";
      attrs.yAxis = "y";
      attrs.xMin = "0";
      attrs.xMax = "10";
      attrs.yMin = "0";
      attrs.yMax = "10";
      attrs.autoPlotX = "true";
      attrs.autoPlotY = "true";
      attrs.legend = "true";
      break;
    case "input":
      attrs.variable = "input";
      attrs.value = "0";
      break;
    case "textbox":
      attrs.text = "Text";
      attrs.fontSize = "11";
      break;
    case "output":
      attrs.fontSize = "11";
      break;
  }

  const serializedAttrs = Object.entries(attrs)
    .map(([name, value]) => `${name}="${encodeXmlAttribute(String(value))}"`)
    .join(" ");
  if (kind === "monitor") {
    return `<${tagName} ${serializedAttrs}>ticks</${tagName}>`;
  }
  if (kind === "plot") {
    return `<${tagName} ${serializedAttrs}><setup></setup><update></update></${tagName}>`;
  }
  if (kind === "chooser") {
    return `<${tagName} ${serializedAttrs}>${writeXmlChooserChoices("", ["one", "two"], "")}</${tagName}>`;
  }
  return `<${tagName} ${serializedAttrs} />`;
}

function widgetRuntimeCommand(widget: InterfaceWidget): string | undefined {
  const details = widget.details ?? {};

  switch (widget.kind) {
    case "slider":
      return setCommand(details.variable, details.value);
    case "switch":
      return setCommand(details.variable, Boolean(details.on));
    case "chooser": {
      if (details.choicesError) throw new Error(`Invalid choices for ${details.variable ?? widget.label}: ${details.choicesError}`);
      const choices = details.choices;
      const selectedIndex = typeof details.selectedIndex === "number" ? details.selectedIndex : Number(details.selectedIndex);
      const selected = chooserCodec.isChoices(choices) && Number.isInteger(selectedIndex)
        ? choices[selectedIndex]
        : undefined;
      return typeof details.variable === "string" && isNetLogoIdentifier(details.variable) && selected !== undefined
        ? `set ${details.variable} ${chooserCodec.serialize(selected)}`
        : undefined;
    }
    case "input":
      return setCommand(details.variable ?? widget.label, details.value);
    default:
      return undefined;
  }
}

function setCommand(variable: WidgetPropertyValue | undefined, value: WidgetPropertyValue | undefined): string | undefined {
  if (typeof variable !== "string" || !isNetLogoIdentifier(variable) || value === undefined || !isRuntimePropertyValue(value)) {
    return undefined;
  }

  return `set ${variable} ${toNetLogoLiteral(value)}`;
}

function isNetLogoIdentifier(value: string): boolean {
  return /^[A-Za-z_?*=!<>:#%$^&+\-/~.][A-Za-z0-9_?*=!<>:#%$^&+\-/~.]*$/.test(value);
}

function toNetLogoLiteral(value: RuntimePropertyValue): string {
  if (typeof value === "number") {
    return String(value);
  }

  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }

  if (typeof value !== "string") {
    return `[${value.map(item => toNetLogoLiteral(item)).join(" ")}]`;
  }

  const trimmed = value.trim();
  if (/^[-+]?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?$/.test(trimmed)) {
    return trimmed;
  }

  if (/^(true|false)$/i.test(trimmed)) {
    return trimmed.toLowerCase();
  }

  return `"${trimmed.replace(/\\/g, "\\\\").replace(/"/g, "\\\"")}"`;
}

type RuntimePropertyValue = string | number | boolean | readonly string[];

function isRuntimePropertyValue(value: WidgetPropertyValue): value is RuntimePropertyValue {
  return typeof value === "string"
    || typeof value === "number"
    || typeof value === "boolean"
    || isStringArray(value);
}

function serializeClassicProperty(type: string, property: string, value: WidgetPropertyValue): string {
  if (type === "SWITCH" && property === "on") {
    return value ? "0" : "1";
  }

  if (property === "forever" || property === "multiline") {
    return value ? "T" : "NIL";
  }

  if (property === "choices" && chooserCodec.isChoices(value)) {
    return chooserCodec.format(value);
  }

  return String(value);
}

function serializeClassicPlotPen(pen: PlotPen): string {
  return [
    serializeClassicQuoted(pen.name),
    serializeClassicDouble(pen.interval),
    String(pen.mode),
    String(pen.color),
    String(pen.inLegend),
    serializeClassicQuoted(pen.setupCode),
    serializeClassicQuoted(pen.updateCode)
  ].join(" ");
}

function serializeClassicDouble(value: number): string {
  return Number.isInteger(value) ? `${value}.0` : String(value);
}

function serializeClassicQuoted(value: string): string {
  const escaped = value
    .replace(/\\/g, "\\\\")
    .replace(/\r\n?/g, "\n")
    .replace(/\n/g, "\\n")
    .replace(/"/g, "\\\"");
  return `"${escaped}"`;
}

function isStringArray(value: WidgetPropertyValue): value is readonly string[] {
  return Array.isArray(value) && value.every(item => typeof item === "string");
}

function isPlotPenArray(value: WidgetPropertyValue): value is readonly PlotPen[] {
  return Array.isArray(value) && value.every(item => isPlotPen(item));
}

function isPlotPen(value: unknown): value is PlotPen {
  if (!value || typeof value !== "object") {
    return false;
  }

  const pen = value as Partial<PlotPen>;
  return typeof pen.name === "string"
    && typeof pen.interval === "number" && Number.isFinite(pen.interval)
    && typeof pen.mode === "number" && Number.isInteger(pen.mode)
    && typeof pen.color === "number" && Number.isInteger(pen.color)
    && typeof pen.inLegend === "boolean"
    && typeof pen.setupCode === "string"
    && typeof pen.updateCode === "string";
}

function xmlPropertyAttributeName(attrs: Record<string, string>, tagName: string, property: string): string | undefined {
  if (property === "label") {
    if ("display" in attrs) {
      return "display";
    }
    if ("label" in attrs) {
      return "label";
    }
    if ("name" in attrs) {
      return "name";
    }
    return "display";
  }

  const candidates: Record<string, readonly string[]> = {
    code: ["code"],
    variable: ["variable", "var"],
    min: ["min"],
    max: ["max"],
    value: ["value"],
    step: ["step"],
    units: ["units"],
    choices: ["choices"],
    selectedIndex: ["current", "selectedIndex", "selected-index", "selected"],
    source: ["source", "reporter"],
    precision: ["precision"],
    xAxis: ["xAxis", "x-axis", "xLabel"],
    yAxis: ["yAxis", "y-axis", "yLabel"],
    xMin: ["xMin", "x-min"],
    xMax: ["xMax", "x-max"],
    yMin: ["yMin", "y-min"],
    yMax: ["yMax", "y-max"],
    legend: ["legend"],
    text: ["text", "display"],
    fontSize: ["fontSize", "font-size"],
    patchSize: ["patchSize", "patch-size"],
    tickCounter: ["tickCounter", "tick-counter"],
    forever: ["forever"],
    on: ["on"],
    multiline: ["multiline"]
  };

  const names = candidates[property];
  if (!names) {
    return undefined;
  }

  return names.find(name => name in attrs) ?? names[0];
}

function serializeXmlProperty(value: WidgetPropertyValue): string {
  return Array.isArray(value) ? value.join(" ") : String(value);
}

function xmlKind(tagName: string): WidgetKind {
  switch (tagName.toLowerCase()) {
    case "view":
    case "view3d":
    case "graphics-window":
    case "graphicswindow":
      return "view";
    case "button":
      return "button";
    case "slider":
      return "slider";
    case "switch":
      return "switch";
    case "chooser":
      return "chooser";
    case "monitor":
      return "monitor";
    case "plot":
      return "plot";
    case "inputbox":
    case "input":
      return "input";
    case "textbox":
    case "text":
    case "note":
      return "textbox";
    case "output":
      return "output";
    default:
      return "generic";
  }
}

function parsePlotCommands(source: string | undefined): { readonly setupCode: string; readonly updateCode: string } {
  const tokens = tokenizeRespectingQuotes(source ?? "");
  return {
    setupCode: tokens[0] ?? "",
    updateCode: tokens[1] ?? ""
  };
}

function parsePlotPens(block: readonly string[]): readonly PlotPen[] {
  const pensIndex = block.findIndex(line => line.trim() === "PENS");
  if (pensIndex < 0) {
    return [];
  }

  return block
    .slice(pensIndex + 1)
    .map(parsePlotPen)
    .filter((pen): pen is PlotPen => pen !== undefined);
}

function parsePlotPen(source: string): PlotPen | undefined {
  const tokens = tokenizeRespectingQuotes(source);
  const interval = Number(tokens[1]);
  const mode = Number(tokens[2]);
  const color = Number(tokens[3]);
  const inLegend = parseBooleanToken(tokens[4]);
  if (tokens[0] === undefined || !Number.isFinite(interval) || !Number.isInteger(mode) || !Number.isInteger(color) || inLegend === undefined) {
    return undefined;
  }

  return {
    name: tokens[0],
    interval,
    mode,
    color,
    inLegend,
    setupCode: tokens[5] ?? "",
    updateCode: tokens[6] ?? ""
  };
}

function tokenizeRespectingQuotes(source: string): readonly string[] {
  const tokens: string[] = [];
  let index = 0;
  while (index < source.length) {
    while (/\s/.test(source[index] ?? "")) {
      index += 1;
    }
    if (index >= source.length) {
      break;
    }

    if (source[index] !== "\"") {
      const start = index;
      while (index < source.length && !/\s/.test(source[index])) {
        index += 1;
      }
      tokens.push(cleanDisplayValue(source.slice(start, index)));
      continue;
    }

    index += 1;
    let value = "";
    while (index < source.length) {
      const character = source[index];
      if (character === "\"") {
        index += 1;
        break;
      }
      if (character !== "\\" || index + 1 >= source.length) {
        value += character;
        index += 1;
        continue;
      }

      const escaped = source[index + 1];
      if (escaped === "n") {
        value += "\n";
      } else if (escaped === "\"") {
        value += "\"";
      } else if (escaped === "\\") {
        value += "\\";
      } else {
        value += `\\${escaped}`;
      }
      index += 2;
    }
    tokens.push(value);
  }

  return tokens;
}

function readChooserDetails(read: () => readonly ChooserValue[], source: string): Record<string, WidgetPropertyValue> {
  try {
    return { choices: read() };
  } catch (error) {
    // Keep malformed models editable, but never silently coerce their choices or
    // synchronize a value that NetLogo would reject.
    return { choices: [], choicesSource: source, choicesError: error instanceof Error ? error.message : String(error) };
  }
}

function parseXmlChooserChoices(inner: string): readonly ChooserValue[] {
  const choices: ChooserValue[] = [];
  const expression = /<choice\b([^>]*?)(?:\/\s*>|>([\s\S]*?)<\/choice\s*>)/gi;
  for (const match of inner.matchAll(expression)) {
    const attrs = parseAttributes(match[1]);
    if (attrs.type === "string" && attrs.value !== undefined) choices.push(attrs.value);
    else {
      const values = chooserCodec.parse(attrs.type === "list" ? decodeXmlText(match[2] ?? "") : attrs.value ?? "");
      const value = values[0];
      if (values.length !== 1 || !(attrs.type === "double" && typeof value === "number"
        || attrs.type === "boolean" && typeof value === "boolean"
        || attrs.type === "list" && Array.isArray(value))) throw new Error("Invalid XML chooser choice");
      choices.push(value);
    }
  }
  return choices;
}

function writeXmlChooserChoices(inner: string, choices: readonly ChooserValue[], indent: string): string {
  const serialized = choices.map(value => {
    if (Array.isArray(value)) return `<choice type="list">${encodeXmlText(chooserCodec.serialize(value))}</choice>`;
    const type = typeof value === "number" ? "double" : typeof value;
    return `<choice type="${type}" value="${encodeXmlAttribute(String(value))}" />`;
  }).join(`\n${indent}`);
  const expression = /<choice\b[^>]*?(?:\/\s*>|>[\s\S]*?<\/choice\s*>)/gi;
  let inserted = false;
  const updated = inner.replace(expression, () => {
    if (inserted) return "";
    inserted = true;
    return serialized;
  });
  return inserted ? updated : appendXmlChild(inner, serialized, indent);
}

function compactDetails(
  details: Record<string, WidgetPropertyValue | undefined>
): Record<string, WidgetPropertyValue> {
  const compacted: Record<string, WidgetPropertyValue> = {};
  for (const [key, value] of Object.entries(details)) {
    if (value !== undefined && value !== "" && (!Array.isArray(value) || value.length > 0)) {
      compacted[key] = value;
    }
  }
  return compacted;
}

function numberAt(block: readonly string[], index: number): number | undefined {
  const value = Number(block[index]?.trim());
  return Number.isFinite(value) ? value : undefined;
}

function stringAt(block: readonly string[], index: number): string | undefined {
  const value = block[index];
  if (value === undefined) {
    return undefined;
  }

  return cleanDisplayValue(value);
}

function cleanDisplayValue(value: string): string {
  const trimmed = value.trim();
  if (trimmed === "NIL") {
    return "";
  }

  const unquoted = trimmed.length >= 2 && trimmed.startsWith("\"") && trimmed.endsWith("\"")
    ? trimmed.slice(1, -1)
    : trimmed;

  return unquoted
    .replace(/\\n/g, "\n")
    .replace(/\\"/g, "\"");
}

function booleanAt(block: readonly string[], index: number): boolean | undefined {
  return parseBooleanToken(block[index]);
}

function parseBooleanToken(value: string | undefined): boolean | undefined {
  const raw = value?.trim().toLowerCase();
  if (raw === undefined) {
    return undefined;
  }

  if (raw === "t" || raw === "true" || raw === "1") {
    return true;
  }

  if (raw === "nil" || raw === "false" || raw === "0") {
    return false;
  }

  return undefined;
}

function inverseBooleanAt(block: readonly string[], index: number): boolean | undefined {
  const value = booleanAt(block, index);
  return value === undefined ? undefined : !value;
}

function numericAttr(attrs: Record<string, string>, ...names: readonly string[]): number | undefined {
  for (const name of names) {
    const value = Number(attrs[name]);
    if (Number.isFinite(value)) {
      return value;
    }
  }

  return undefined;
}

function parseWidgetId(widgetId: string, prefix: "classic" | "xml"): number | undefined {
  const match = widgetId.match(new RegExp(`^${prefix}-(\\d+)$`));
  if (!match) {
    return undefined;
  }

  const index = Number(match[1]);
  return Number.isInteger(index) && index >= 0 ? index : undefined;
}

function normalizeBounds(bounds: WidgetBounds): WidgetBounds {
  return {
    x: Math.max(0, Math.round(bounds.x)),
    y: Math.max(0, Math.round(bounds.y)),
    width: Math.max(32, Math.round(bounds.width)),
    height: Math.max(24, Math.round(bounds.height))
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function decodeXml(value: string): string {
  const named: Record<string, string> = { lt: "<", gt: ">", quot: '"', apos: "'", amp: "&" };
  return value.replace(/&(lt|gt|quot|apos|amp|#\d+|#x[\da-f]+);/gi, (entity, name: string) => {
    if (name in named) return named[name];
    const point = name.startsWith("#x") || name.startsWith("#X") ? parseInt(name.slice(2), 16) : Number(name.slice(1));
    return Number.isInteger(point) && point >= 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff)
      ? String.fromCodePoint(point) : entity;
  });
}

function encodeXmlAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "&#10;")
    .replace(/\r/g, "&#13;")
    .replace(/\t/g, "&#9;");
}

function trimTrailingBlankLines(lines: readonly string[]): string[] {
  const next = [...lines];
  while (next.length > 0 && next[next.length - 1].trim() === "") {
    next.pop();
  }
  return next;
}

interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}
