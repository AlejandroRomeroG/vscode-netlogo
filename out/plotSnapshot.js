"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parsePlotBinary = parsePlotBinary;
/** Decode a complete native plot without a CSV conversion or loss of RGB colors. */
function parsePlotBinary(data) {
    let offset = 0;
    function take(length) {
        if (!Number.isSafeInteger(length) || length < 0 || length > data.length - offset) {
            throw new Error("Truncated or invalid NetLogo plot snapshot.");
        }
        const start = offset;
        offset += length;
        return start;
    }
    const integer = () => data.readInt32BE(take(4));
    const number = () => {
        const value = data.readDoubleBE(take(8));
        if (!Number.isFinite(value)) {
            throw new Error("Non-finite value in NetLogo plot snapshot.");
        }
        return value;
    };
    const boolean = () => {
        const value = data.readUInt8(take(1));
        if (value > 1) {
            throw new Error("Invalid flag in NetLogo plot snapshot.");
        }
        return value === 1;
    };
    const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
    const string = () => {
        const length = integer();
        const start = take(length);
        return decoder.decode(data.subarray(start, start + length));
    };
    const count = (minimumRecordBytes) => {
        const value = integer();
        if (value < 0 || value * minimumRecordBytes > data.length - offset) {
            throw new Error("Invalid record count in NetLogo plot snapshot.");
        }
        return value;
    };
    if (integer() !== 0x4e4c5031 || integer() !== 1) {
        throw new Error("Unsupported NetLogo plot snapshot format.");
    }
    const name = string();
    const xMin = number(), xMax = number(), yMin = number(), yMax = number();
    if (xMin >= xMax || yMin >= yMax) {
        throw new Error("Invalid ranges in NetLogo plot snapshot.");
    }
    const autoplot = boolean(), legend = boolean(), currentPen = string();
    const numberOfPens = count(35);
    const pens = [];
    for (let index = 0; index < numberOfPens; index += 1) {
        const name = string(), penDown = boolean(), mode = integer(), interval = number();
        if (mode < 0 || mode > 2) {
            throw new Error("Invalid pen mode in NetLogo plot snapshot.");
        }
        const color = integer(), x = number(), hidden = boolean(), inLegend = boolean();
        const pointCount = count(21);
        const points = [];
        for (let point = 0; point < pointCount; point += 1) {
            points.push({ x: number(), y: number(), color: integer(), penDown: boolean() });
        }
        pens.push({ name, penDown, mode, interval, color, colorFormat: "argb", x, hidden, inLegend, points });
    }
    if (offset !== data.length) {
        throw new Error("Unexpected data after NetLogo plot snapshot.");
    }
    return { name, xMin, xMax, yMin, yMax, autoplot, legend, currentPen, numberOfPens, pens };
}
//# sourceMappingURL=plotSnapshot.js.map