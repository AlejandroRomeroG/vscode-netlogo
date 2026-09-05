"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.externalInfoUrl = externalInfoUrl;
exports.resolveInfoLocalFile = resolveInfoLocalFile;
exports.loadInfoLocalImage = loadInfoLocalImage;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
// Info is model-supplied content. Never hand command:, javascript:, absolute
// file URLs, or paths outside the model directory to VS Code or the OS.
function externalInfoUrl(href) {
    if (typeof href !== "string" || /[\u0000-\u0020\u007f]/.test(href))
        return undefined;
    try {
        const url = new URL(href);
        if (!["https:", "http:", "mailto:"].includes(url.protocol) || url.username || url.password)
            return undefined;
        if (url.protocol === "mailto:" && /%0[ad]/i.test(href))
            return undefined;
        return url.href;
    }
    catch {
        return undefined;
    }
}
async function resolveInfoLocalFile(modelPath, href) {
    if (typeof href !== "string" || /[\u0000-\u001f\u007f]/.test(href))
        throw new Error("Invalid documentation path.");
    const relative = decodeURIComponent(href.replace(/^file:/i, ""));
    if (!relative || /[\u0000-\u001f\u007f\\]/.test(relative) || /^[a-z][a-z\d+.-]*:/i.test(relative) || path.isAbsolute(relative)) {
        throw new Error("Documentation files must be relative to the model directory.");
    }
    const root = await fs.promises.realpath(path.dirname(modelPath));
    const candidate = path.resolve(root, relative);
    const inside = (value) => {
        const segment = path.relative(root, value);
        return segment !== ".." && !segment.startsWith(".." + path.sep) && !path.isAbsolute(segment);
    };
    if (!inside(candidate))
        throw new Error("Documentation files must stay inside the model directory.");
    const resolved = await fs.promises.realpath(candidate);
    if (!inside(resolved) || !(await fs.promises.stat(resolved)).isFile()) {
        throw new Error("Documentation files must stay inside the model directory.");
    }
    return resolved;
}
async function loadInfoLocalImage(modelPath, href) {
    const file = await resolveInfoLocalFile(modelPath, href);
    const sizeLimit = 8 * 1024 * 1024;
    if ((await fs.promises.stat(file)).size > sizeLimit)
        throw new Error("Documentation images must be smaller than 8 MB.");
    const bytes = await fs.promises.readFile(file);
    if (bytes.length > sizeLimit)
        throw new Error("Documentation images must be smaller than 8 MB.");
    const mime = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? "image/png"
        : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 ? "image/jpeg"
            : /^GIF8[79]a$/.test(bytes.subarray(0, 6).toString("ascii")) ? "image/gif"
                : bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP" ? "image/webp"
                    : undefined;
    if (!mime)
        throw new Error("Supported documentation images are PNG, JPEG, GIF, and WebP.");
    return `data:${mime};base64,${bytes.toString("base64")}`;
}
//# sourceMappingURL=infoResources.js.map