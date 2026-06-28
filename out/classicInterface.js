"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseInterfacePreview = parseInterfacePreview;
exports.parseClassicWidgets = parseClassicWidgets;
exports.updateInterfaceWidgetBounds = updateInterfaceWidgetBounds;
exports.updateInterfaceWidgetProperties = updateInterfaceWidgetProperties;
exports.createInterfaceWidget = createInterfaceWidget;
exports.deleteInterfaceWidget = deleteInterfaceWidget;
exports.getWidgetRuntimeCommands = getWidgetRuntimeCommands;
exports.getMonitorReporters = getMonitorReporters;
exports.getPlotExporters = getPlotExporters;
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
function parseInterfacePreview(source, format) {
    const parsedWidgets = format === "xml" ? parseXmlWidgets(source) : parseClassicWidgets(source);
    const widgets = format === "xml" ? parsedWidgets : positionExternal3DViews(parsedWidgets);
    return {
        widgets,
        bounds: getBounds(widgets)
    };
}
function parseClassicWidgets(source) {
    return getClassicBlocks(source)
        .map((block, index) => parseClassicWidgetBlock(block, index))
        .filter((widget) => widget !== undefined);
}
function updateInterfaceWidgetBounds(source, format, widgetId, bounds) {
    return format === "xml"
        ? updateXmlWidgetBounds(source, widgetId, bounds)
        : updateClassicWidgetBounds(source, widgetId, bounds);
}
function updateInterfaceWidgetProperties(source, format, widgetId, updates) {
    return format === "xml"
        ? updateXmlWidgetProperties(source, widgetId, updates)
        : updateClassicWidgetProperties(source, widgetId, updates);
}
function createInterfaceWidget(source, format, kind, bounds) {
    return format === "xml"
        ? createXmlWidget(source, kind, bounds)
        : createClassicWidget(source, kind, bounds);
}
function deleteInterfaceWidget(source, format, widgetId) {
    return format === "xml"
        ? deleteXmlWidget(source, widgetId)
        : deleteClassicWidget(source, widgetId);
}
function getWidgetRuntimeCommands(widgets) {
    return widgets
        .map(widgetRuntimeCommand)
        .filter((command) => command !== undefined);
}
function getMonitorReporters(widgets) {
    return widgets
        .filter(widget => widget.kind === "monitor")
        .map(widget => ({
        widgetId: widget.id,
        label: widget.label,
        source: String(widget.details?.source ?? "")
    }))
        .filter(monitor => monitor.source.trim().length > 0);
}
function getPlotExporters(widgets) {
    return widgets
        .filter(widget => widget.kind === "plot")
        .map(widget => ({
        widgetId: widget.id,
        label: widget.label,
        plotName: widget.label
    }))
        .filter(plot => plot.plotName.trim().length > 0);
}
function getClassicBlocks(source) {
    const lines = source.replace(/\r\n/g, "\n").split("\n");
    const blocks = [];
    let current = [];
    for (const line of lines) {
        const trimmed = line.trim();
        if (KnownClassicWidgetTypes.has(trimmed)) {
            if (current.length > 0) {
                blocks.push(trimTrailingBlankLines(current));
            }
            current = [trimmed];
        }
        else if (current.length > 0) {
            current.push(line);
        }
    }
    if (current.length > 0) {
        blocks.push(trimTrailingBlankLines(current));
    }
    return blocks;
}
function updateClassicWidgetBounds(source, widgetId, bounds) {
    const targetIndex = parseWidgetId(widgetId, "classic");
    if (targetIndex === undefined) {
        return source;
    }
    const lineEnding = source.includes("\r\n") ? "\r\n" : "\n";
    const lines = source.replace(/\r\n/g, "\n").split("\n");
    const starts = [];
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
function updateClassicWidgetProperties(source, widgetId, updates) {
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
    return changed ? lines.join(lineEnding) : source;
}
function createClassicWidget(source, kind, bounds) {
    const lineEnding = source.includes("\r\n") ? "\r\n" : "\n";
    const block = classicWidgetTemplate(kind, normalizeBounds(bounds)).join(lineEnding);
    if (source.trim().length === 0) {
        return block;
    }
    return `${source}${source.endsWith("\n") ? "" : lineEnding}${block}`;
}
function deleteClassicWidget(source, widgetId) {
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
function parseClassicWidgetBlock(block, index) {
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
                    choices: parseLogoList(stringAt(block, 7)),
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
        case "PLOT":
            return {
                ...baseWidget(index, type, "plot", stringAt(block, 5) || "Plot", box, block),
                details: compactDetails({
                    xAxis: stringAt(block, 6),
                    yAxis: stringAt(block, 7),
                    xMin: numberAt(block, 8),
                    xMax: numberAt(block, 9),
                    yMin: numberAt(block, 10),
                    yMax: numberAt(block, 11),
                    autoplot: booleanAt(block, 12),
                    legend: booleanAt(block, 13),
                    pens: parsePlotPens(block)
                })
            };
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
function positionExternal3DViews(widgets) {
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
function isExternal3DView(widget) {
    return widget.kind === "view"
        && widget.x <= 20
        && widget.y <= 20
        && widget.details?.minPzcor !== undefined
        && widget.details?.maxPzcor !== undefined;
}
function parseClassicViewDetails(block) {
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
        tickCounter: tickCounterIndex !== undefined ? stringAt(block, tickCounterIndex) : undefined
    });
}
function findClassicViewTickCounterIndex(block) {
    for (let index = block.length - 2; index >= 16; index -= 1) {
        const label = block[index]?.trim();
        const nextNumeric = Number(block[index + 1]);
        if (label && !Number.isFinite(Number(label)) && Number.isFinite(nextNumeric)) {
            return index;
        }
    }
    return undefined;
}
function fallbackClassicViewBoundsStart(block) {
    if (hasNumericRun(block, 17, 4)) {
        return 17;
    }
    return 16;
}
function hasNumericRun(block, start, length) {
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
function parseXmlWidgets(source) {
    const widgets = [];
    const expression = /<([a-zA-Z][\w:-]*)([^>]*)\/?>/g;
    let match;
    while ((match = expression.exec(source)) !== null) {
        const tagName = match[1].toLowerCase();
        if (tagName === "widgets") {
            continue;
        }
        const attrs = parseAttributes(match[2]);
        const box = parseXmlBox(attrs);
        if (!box) {
            continue;
        }
        const type = tagName.toUpperCase();
        const elementText = readXmlElementText(source, tagName, match);
        const kind = xmlKind(tagName);
        const label = attrs.display ?? attrs.label ?? attrs.name ?? attrs.variable ?? (kind === "button" ? elementText : undefined) ?? type;
        const details = normalizeXmlDetails(tagName, attrs, elementText);
        widgets.push({
            id: `xml-${widgets.length}`,
            type,
            kind,
            label,
            x: box.x,
            y: box.y,
            width: box.width,
            height: box.height,
            raw: [match[0]],
            runCommand: xmlRunCommand(tagName, attrs, elementText),
            details
        });
    }
    return widgets;
}
function updateXmlWidgetBounds(source, widgetId, bounds) {
    const targetIndex = parseWidgetId(widgetId, "xml");
    if (targetIndex === undefined) {
        return source;
    }
    const normalized = normalizeBounds(bounds);
    const expression = /<([a-zA-Z][\w:-]*)([^>]*)\/?>/g;
    let match;
    let widgetIndex = 0;
    while ((match = expression.exec(source)) !== null) {
        const tagName = match[1].toLowerCase();
        if (tagName === "widgets") {
            continue;
        }
        const attrs = parseAttributes(match[2]);
        if (!parseXmlBox(attrs)) {
            continue;
        }
        if (widgetIndex === targetIndex) {
            const originalTag = match[0];
            const updatedTag = writeXmlBounds(originalTag, attrs, normalized);
            return source.slice(0, match.index) + updatedTag + source.slice(match.index + originalTag.length);
        }
        widgetIndex += 1;
    }
    return source;
}
function updateXmlWidgetProperties(source, widgetId, updates) {
    const targetIndex = parseWidgetId(widgetId, "xml");
    if (targetIndex === undefined) {
        return source;
    }
    const expression = /<([a-zA-Z][\w:-]*)([^>]*)\/?>/g;
    let match;
    let widgetIndex = 0;
    while ((match = expression.exec(source)) !== null) {
        const tagName = match[1].toLowerCase();
        if (tagName === "widgets") {
            continue;
        }
        const attrs = parseAttributes(match[2]);
        if (!parseXmlBox(attrs)) {
            continue;
        }
        if (widgetIndex === targetIndex) {
            let updatedTag = match[0];
            for (const [property, value] of Object.entries(updates)) {
                const attrName = xmlPropertyAttributeName(attrs, tagName, property);
                if (attrName) {
                    updatedTag = writeXmlAttr(updatedTag, attrName, serializeXmlProperty(value));
                }
            }
            return source.slice(0, match.index) + updatedTag + source.slice(match.index + match[0].length);
        }
        widgetIndex += 1;
    }
    return source;
}
function createXmlWidget(source, kind, bounds) {
    const tag = xmlWidgetTemplate(kind, normalizeBounds(bounds));
    const lineEnding = source.includes("\r\n") ? "\r\n" : "\n";
    if (/<\/widgets>\s*$/i.test(source)) {
        return source.replace(/<\/widgets>\s*$/i, `${lineEnding}  ${tag}${lineEnding}</widgets>`);
    }
    if (source.trim().length === 0) {
        return tag;
    }
    return `${source}${source.endsWith("\n") ? "" : lineEnding}${tag}`;
}
function deleteXmlWidget(source, widgetId) {
    const targetIndex = parseWidgetId(widgetId, "xml");
    if (targetIndex === undefined) {
        return source;
    }
    const expression = /<([a-zA-Z][\w:-]*)([^>]*)\/?>/g;
    let match;
    let widgetIndex = 0;
    while ((match = expression.exec(source)) !== null) {
        const tagName = match[1].toLowerCase();
        if (tagName === "widgets") {
            continue;
        }
        const attrs = parseAttributes(match[2]);
        if (!parseXmlBox(attrs)) {
            continue;
        }
        if (widgetIndex === targetIndex) {
            const start = match.index;
            const end = source[match.index + match[0].length] === "\n" ? match.index + match[0].length + 1 : match.index + match[0].length;
            return source.slice(0, start) + source.slice(end);
        }
        widgetIndex += 1;
    }
    return source;
}
function baseWidget(index, type, kind, label, box, raw) {
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
function parseClassicBox(block) {
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
function parseXmlBox(attrs) {
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
function writeXmlBounds(tag, attrs, bounds) {
    if ("left" in attrs || "top" in attrs) {
        let updated = writeXmlAttr(writeXmlAttr(tag, "left", bounds.x), "top", bounds.y);
        if ("right" in attrs || "bottom" in attrs) {
            updated = writeXmlAttr(writeXmlAttr(updated, "right", bounds.x + bounds.width), "bottom", bounds.y + bounds.height);
        }
        else {
            updated = writeXmlAttr(writeXmlAttr(updated, "width", bounds.width), "height", bounds.height);
        }
        return updated;
    }
    if ("width" in attrs || "height" in attrs) {
        return writeXmlAttr(writeXmlAttr(writeXmlAttr(writeXmlAttr(tag, "x", bounds.x), "y", bounds.y), "width", bounds.width), "height", bounds.height);
    }
    return writeXmlAttr(writeXmlAttr(writeXmlAttr(writeXmlAttr(tag, "x", bounds.x), "y", bounds.y), "width", bounds.width), "height", bounds.height);
}
function writeXmlAttr(tag, name, value) {
    const escapedValue = encodeXmlAttribute(String(value));
    const expression = new RegExp(`(\\s${escapeRegExp(name)}\\s*=\\s*)(["'])(.*?)\\2`, "i");
    if (expression.test(tag)) {
        return tag.replace(expression, `$1$2${escapedValue}$2`);
    }
    const insertAt = tag.endsWith("/>") ? tag.length - 2 : tag.length - 1;
    return `${tag.slice(0, insertAt)} ${name}="${escapedValue}"${tag.slice(insertAt)}`;
}
function getBounds(widgets) {
    const width = Math.max(820, ...widgets.map(widget => widget.x + widget.width + 24));
    const height = Math.max(560, ...widgets.map(widget => widget.y + widget.height + 24));
    return { width, height };
}
function parseAttributes(source) {
    const attrs = {};
    const expression = /([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>/]+))/g;
    let match;
    while ((match = expression.exec(source)) !== null) {
        attrs[match[1]] = decodeXml(match[2] ?? match[3] ?? match[4] ?? "");
    }
    return attrs;
}
function readXmlElementText(source, tagName, match) {
    if (/\/\s*>$/.test(match[0])) {
        return undefined;
    }
    const start = match.index + match[0].length;
    const closeExpression = new RegExp(`</${escapeRegExp(tagName)}>`, "i");
    const closeMatch = source.slice(start).match(closeExpression);
    if (!closeMatch || closeMatch.index === undefined) {
        return undefined;
    }
    const text = source.slice(start, start + closeMatch.index).trim();
    return text ? decodeXml(text) : undefined;
}
function xmlRunCommand(tagName, attrs, elementText) {
    if (attrs.code) {
        return attrs.code;
    }
    return xmlKind(tagName) === "button" ? elementText : undefined;
}
function normalizeXmlDetails(tagName, attrs, elementText) {
    const details = { ...attrs };
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
        const choices = parseLogoList(attrs.choices);
        if (choices) {
            details.choices = choices;
        }
        details.selectedIndex = parseMaybeNumber(attrs.selectedIndex ?? attrs["selected-index"] ?? attrs.selected);
    }
    if (kind === "monitor") {
        details.precision = parseMaybeNumber(attrs.precision);
    }
    return details;
}
function parseMaybeNumber(value) {
    const numeric = Number(value);
    return value !== undefined && Number.isFinite(numeric) ? numeric : value ?? "";
}
function parseXmlBoolean(value) {
    return /^(true|t|1)$/i.test(value ?? "");
}
function getClassicWidgetStarts(lines) {
    const starts = [];
    for (let index = 0; index < lines.length; index += 1) {
        if (KnownClassicWidgetTypes.has(lines[index].trim())) {
            starts.push(index);
        }
    }
    return starts;
}
function classicPropertyOffsets(type) {
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
            return { label: 5, xAxis: 6, yAxis: 7, xMin: 8, xMax: 9, yMin: 10, yMax: 11 };
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
function classicWidgetTemplate(kind, bounds) {
    const right = bounds.x + bounds.width;
    const bottom = bounds.y + bounds.height;
    const base = (type) => [type, String(bounds.x), String(bounds.y), String(right), String(bottom)];
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
                "[one two]",
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
function xmlWidgetTemplate(kind, bounds) {
    const tagName = kind === "input" ? "inputbox" : kind === "textbox" ? "textbox" : kind === "view" ? "view" : kind;
    const attrs = {
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
            attrs.choices = "one two";
            attrs.selectedIndex = "0";
            break;
        case "monitor":
            attrs.display = "monitor";
            attrs.source = "ticks";
            attrs.precision = "0";
            break;
        case "plot":
            attrs.name = "Plot";
            attrs.xAxis = "x";
            attrs.yAxis = "y";
            attrs.xMin = "0";
            attrs.xMax = "10";
            attrs.yMin = "0";
            attrs.yMax = "10";
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
    return `<${tagName} ${serializedAttrs} />`;
}
function widgetRuntimeCommand(widget) {
    const details = widget.details ?? {};
    switch (widget.kind) {
        case "slider":
            return setCommand(details.variable, details.value);
        case "switch":
            return setCommand(details.variable, Boolean(details.on));
        case "chooser": {
            const choices = details.choices;
            const selectedIndex = typeof details.selectedIndex === "number" ? details.selectedIndex : Number(details.selectedIndex);
            const selected = Array.isArray(choices) && Number.isInteger(selectedIndex) ? choices[selectedIndex] : undefined;
            return setCommand(details.variable, selected);
        }
        case "input":
            return setCommand(details.variable ?? widget.label, details.value);
        default:
            return undefined;
    }
}
function setCommand(variable, value) {
    if (typeof variable !== "string" || !isNetLogoIdentifier(variable) || value === undefined) {
        return undefined;
    }
    return `set ${variable} ${toNetLogoLiteral(value)}`;
}
function isNetLogoIdentifier(value) {
    return /^[A-Za-z_?*=!<>:#%$^&+\-/~.][A-Za-z0-9_?*=!<>:#%$^&+\-/~.]*$/.test(value);
}
function toNetLogoLiteral(value) {
    if (typeof value === "number") {
        return String(value);
    }
    if (typeof value === "boolean") {
        return value ? "true" : "false";
    }
    if (typeof value !== "string") {
        return `[${value.map(toNetLogoLiteral).join(" ")}]`;
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
function serializeClassicProperty(type, property, value) {
    if (type === "SWITCH" && property === "on") {
        return value ? "0" : "1";
    }
    if (property === "forever" || property === "multiline") {
        return value ? "T" : "NIL";
    }
    if (property === "choices" && Array.isArray(value)) {
        return `[${value.map(serializeLogoListItem).join(" ")}]`;
    }
    return String(value);
}
function serializeLogoListItem(value) {
    return /\s|"/.test(value)
        ? `"${value.replace(/\\/g, "\\\\").replace(/"/g, "\\\"")}"`
        : value;
}
function xmlPropertyAttributeName(attrs, tagName, property) {
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
        return tagName === "plot" ? "name" : "display";
    }
    const candidates = {
        code: ["code"],
        variable: ["variable", "var"],
        min: ["min"],
        max: ["max"],
        value: ["value"],
        step: ["step"],
        units: ["units"],
        choices: ["choices"],
        selectedIndex: ["selectedIndex", "selected-index", "selected"],
        source: ["source", "reporter"],
        precision: ["precision"],
        xAxis: ["xAxis", "x-axis", "xLabel"],
        yAxis: ["yAxis", "y-axis", "yLabel"],
        xMin: ["xMin", "x-min"],
        xMax: ["xMax", "x-max"],
        yMin: ["yMin", "y-min"],
        yMax: ["yMax", "y-max"],
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
function serializeXmlProperty(value) {
    return Array.isArray(value) ? value.join(" ") : String(value);
}
function xmlKind(tagName) {
    switch (tagName.toLowerCase()) {
        case "view":
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
            return "textbox";
        case "output":
            return "output";
        default:
            return "generic";
    }
}
function parsePlotPens(block) {
    const pensIndex = block.findIndex(line => line.trim() === "PENS");
    if (pensIndex < 0) {
        return undefined;
    }
    return block
        .slice(pensIndex + 1)
        .map(line => tokenizeRespectingQuotes(line)[0])
        .filter((name) => Boolean(name));
}
function tokenizeRespectingQuotes(source) {
    const tokens = [];
    const expression = /"((?:\\"|[^"])*)"|(\S+)/g;
    let match;
    while ((match = expression.exec(source)) !== null) {
        tokens.push(cleanDisplayValue(match[1] ?? match[2] ?? ""));
    }
    return tokens;
}
function parseLogoList(value) {
    if (!value) {
        return undefined;
    }
    const trimmed = value.trim();
    const inner = trimmed.startsWith("[") && trimmed.endsWith("]") ? trimmed.slice(1, -1) : trimmed;
    return tokenizeRespectingQuotes(inner);
}
function compactDetails(details) {
    const compacted = {};
    for (const [key, value] of Object.entries(details)) {
        if (value !== undefined && value !== "" && (!Array.isArray(value) || value.length > 0)) {
            compacted[key] = value;
        }
    }
    return compacted;
}
function numberAt(block, index) {
    const value = Number(block[index]?.trim());
    return Number.isFinite(value) ? value : undefined;
}
function stringAt(block, index) {
    const value = block[index];
    if (value === undefined) {
        return undefined;
    }
    return cleanDisplayValue(value);
}
function cleanDisplayValue(value) {
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
function booleanAt(block, index) {
    const raw = block[index]?.trim().toLowerCase();
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
function inverseBooleanAt(block, index) {
    const value = booleanAt(block, index);
    return value === undefined ? undefined : !value;
}
function numericAttr(attrs, ...names) {
    for (const name of names) {
        const value = Number(attrs[name]);
        if (Number.isFinite(value)) {
            return value;
        }
    }
    return undefined;
}
function parseWidgetId(widgetId, prefix) {
    const match = widgetId.match(new RegExp(`^${prefix}-(\\d+)$`));
    if (!match) {
        return undefined;
    }
    const index = Number(match[1]);
    return Number.isInteger(index) && index >= 0 ? index : undefined;
}
function normalizeBounds(bounds) {
    return {
        x: Math.max(0, Math.round(bounds.x)),
        y: Math.max(0, Math.round(bounds.y)),
        width: Math.max(32, Math.round(bounds.width)),
        height: Math.max(24, Math.round(bounds.height))
    };
}
function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function decodeXml(value) {
    return value
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, "\"")
        .replace(/&apos;/g, "'")
        .replace(/&amp;/g, "&");
}
function encodeXmlAttribute(value) {
    return value
        .replace(/&/g, "&amp;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}
function trimTrailingBlankLines(lines) {
    const next = [...lines];
    while (next.length > 0 && next[next.length - 1].trim() === "") {
        next.pop();
    }
    return next;
}
//# sourceMappingURL=classicInterface.js.map