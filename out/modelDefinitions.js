"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.findNetLogoDefinition = findNetLogoDefinition;
exports.findNetLogoReferences = findNetLogoReferences;
exports.isValidNetLogoProcedureName = isValidNetLogoProcedureName;
const modelSymbols_1 = require("./modelSymbols");
function findNetLogoDefinition(code, offset) {
    if (offset < 0 || offset > code.length || isInsideCommentOrString(code, offset)) {
        return undefined;
    }
    const token = tokenAt(code, offset);
    if (!token) {
        return undefined;
    }
    const name = token.text.toLowerCase();
    const symbol = (0, modelSymbols_1.analyzeNetLogoCodeSymbols)(code).find(candidate => candidate.kind !== "declaration" && candidate.name.toLowerCase() === name);
    if (!symbol) {
        return undefined;
    }
    return {
        name: symbol.name,
        kind: symbol.kind === "reporter" ? "reporter" : "procedure",
        signature: signatureLineAt(code, symbol.selectionStart),
        sourceStart: token.start,
        sourceEnd: token.end,
        targetStart: symbol.selectionStart,
        targetEnd: symbol.selectionEnd
    };
}
function findNetLogoReferences(code, offset, includeDeclaration = true) {
    const definition = findNetLogoDefinition(code, offset);
    if (!definition) {
        return [];
    }
    return scanTokens(code)
        .filter(token => token.text.toLowerCase() === definition.name.toLowerCase())
        .filter(token => includeDeclaration || token.start !== definition.targetStart || token.end !== definition.targetEnd)
        .map(token => ({ start: token.start, end: token.end }));
}
function isValidNetLogoProcedureName(name) {
    return name.length > 0 && name.trim() === name && !Array.from(name).some(isDelimiter);
}
function tokenAt(source, offset) {
    let position = Math.min(offset, source.length - 1);
    if (position < 0) {
        return undefined;
    }
    if (isDelimiter(source[position]) && position > 0 && !isDelimiter(source[position - 1])) {
        position -= 1;
    }
    if (isDelimiter(source[position])) {
        return undefined;
    }
    let start = position;
    while (start > 0 && !isDelimiter(source[start - 1])) {
        start -= 1;
    }
    let end = position + 1;
    while (end < source.length && !isDelimiter(source[end])) {
        end += 1;
    }
    const text = source.slice(start, end);
    return text ? { text, start, end } : undefined;
}
function scanTokens(source) {
    const tokens = [];
    let index = 0;
    while (index < source.length) {
        const character = source[index];
        if (character === ";") {
            index = skipComment(source, index);
            continue;
        }
        if (character === "\"") {
            index = skipString(source, index);
            continue;
        }
        if (isDelimiter(character)) {
            index += 1;
            continue;
        }
        const start = index;
        while (index < source.length && !isDelimiter(source[index])) {
            index += 1;
        }
        tokens.push({ text: source.slice(start, index), start, end: index });
    }
    return tokens;
}
function isDelimiter(character) {
    return /\s/.test(character) || "[](){}\";,".includes(character);
}
function skipComment(source, start) {
    const newline = source.indexOf("\n", start);
    return newline < 0 ? source.length : newline + 1;
}
function skipString(source, start) {
    let index = start + 1;
    while (index < source.length) {
        if (source[index] === "\\" && index + 1 < source.length) {
            index += 2;
            continue;
        }
        if (source[index] === "\"") {
            return index + 1;
        }
        index += 1;
    }
    return source.length;
}
function signatureLineAt(source, offset) {
    const lineStart = source.lastIndexOf("\n", Math.max(0, offset - 1)) + 1;
    const nextLine = source.indexOf("\n", offset);
    const lineEnd = nextLine < 0 ? source.length : nextLine;
    return source.slice(lineStart, lineEnd).trim();
}
function isInsideCommentOrString(source, offset) {
    const lineStart = source.lastIndexOf("\n", Math.max(0, offset - 1)) + 1;
    let inString = false;
    for (let index = lineStart; index < Math.min(offset, source.length); index += 1) {
        const current = source[index];
        if (current === "\\" && inString) {
            index += 1;
            continue;
        }
        if (current === "\"") {
            inString = !inString;
            continue;
        }
        if (current === ";" && !inString) {
            return true;
        }
    }
    return inString;
}
//# sourceMappingURL=modelDefinitions.js.map