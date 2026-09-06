"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createChooserCodec = createChooserCodec;
// Keep this factory self-contained: the same compiled code runs in the host and
// in the webview, so editing, saving and execution cannot disagree on types.
function createChooserCodec() {
    function parse(source) {
        let index = 0;
        function fail(message) {
            throw new Error(`${message} (character ${index + 1}).`);
        }
        function whitespace() {
            while (index < source.length) {
                if (/\s/.test(source[index]))
                    index += 1;
                else if (source[index] === ";") {
                    while (index < source.length && !/[\r\n]/.test(source[index]))
                        index += 1;
                }
                else
                    break;
            }
        }
        function readString() {
            index += 1;
            let value = "";
            const escapes = { n: "\n", r: "\r", t: "\t", "\\": "\\", '"': '"' };
            while (index < source.length) {
                const character = source[index++];
                if (character === '"')
                    return value;
                if (character === "\\") {
                    const escaped = source[index++];
                    if (!Object.prototype.hasOwnProperty.call(escapes, escaped))
                        fail("Invalid string escape");
                    value += escapes[escaped];
                }
                else
                    value += character;
            }
            return fail("Unterminated string");
        }
        function readValues(inList) {
            const values = [];
            while (true) {
                whitespace();
                if (index >= source.length) {
                    if (inList)
                        fail("Unterminated list");
                    return values;
                }
                const character = source[index];
                if (character === "]") {
                    if (!inList)
                        fail("Unexpected closing bracket");
                    index += 1;
                    return values;
                }
                if (character === "[") {
                    index += 1;
                    values.push(readValues(true));
                }
                else if (character === '"')
                    values.push(readString());
                else {
                    const start = index;
                    while (index < source.length && !/[\s\[\]";]/.test(source[index]))
                        index += 1;
                    const token = source.slice(start, index);
                    if (/^(true|false)$/i.test(token))
                        values.push(token.toLowerCase() === "true");
                    else if (/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(token) && Number.isFinite(Number(token))) {
                        values.push(Number(token));
                    }
                    else
                        fail(`Invalid choice ${JSON.stringify(token)}; put text in double quotes`);
                }
            }
        }
        return readValues(false);
    }
    function isValue(value) {
        return typeof value === "string" || typeof value === "boolean"
            || (typeof value === "number" && Number.isFinite(value))
            || (Array.isArray(value) && value.every(isValue));
    }
    function isChoices(value) {
        return Array.isArray(value) && value.every(isValue);
    }
    function serialize(value) {
        if (typeof value === "string") {
            return '"' + value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')
                .replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\t/g, "\\t") + '"';
        }
        if (Array.isArray(value))
            return "[" + value.map(serialize).join(" ") + "]";
        if (!isValue(value))
            throw new Error("Invalid chooser value");
        return Object.is(value, -0) ? "-0" : String(value);
    }
    function format(choices, separator = " ") {
        return choices.map(serialize).join(separator);
    }
    function display(value) {
        return typeof value === "string" ? value : serialize(value);
    }
    function selectionAfterEdit(previous, index, next) {
        const selected = previous[index];
        const match = selected === undefined ? -1 : next.findIndex(value => serialize(value) === serialize(selected));
        return Math.max(0, match);
    }
    return { parse, serialize, format, display, isValue, isChoices, selectionAfterEdit };
}
//# sourceMappingURL=chooserValues.js.map