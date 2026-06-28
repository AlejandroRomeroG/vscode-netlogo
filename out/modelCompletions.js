"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.analyzeNetLogoLocalCompletions = analyzeNetLogoLocalCompletions;
const modelSymbols_1 = require("./modelSymbols");
const declarationSpecs = [
    { pattern: /^\s*globals\b/i, kind: "global", mode: "variables" },
    { pattern: /^\s*turtles-own\b/i, kind: "turtle variable", mode: "variables" },
    { pattern: /^\s*patches-own\b/i, kind: "patch variable", mode: "variables" },
    { pattern: /^\s*links-own\b/i, kind: "link variable", mode: "variables" },
    { pattern: /^\s*breed\b/i, kind: "breed", mode: "breed" },
    { pattern: /^\s*directed-link-breed\b/i, kind: "breed", mode: "breed" },
    { pattern: /^\s*undirected-link-breed\b/i, kind: "breed", mode: "breed" }
];
function analyzeNetLogoLocalCompletions(code) {
    const seen = new Set();
    const completions = [];
    for (const symbol of (0, modelSymbols_1.analyzeNetLogoCodeSymbols)(code)) {
        if (symbol.kind === "declaration") {
            continue;
        }
        const key = symbol.name.toLowerCase();
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        completions.push({
            name: symbol.name,
            kind: symbol.kind === "reporter" ? "reporter" : "procedure",
            signature: signatureLineAt(code, symbol.selectionStart)
        });
    }
    for (const completion of declarationCompletions(code)) {
        const key = completion.name.toLowerCase();
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        completions.push(completion);
    }
    return completions;
}
function declarationCompletions(code) {
    const completions = [];
    const lines = splitLines(code);
    for (let index = 0; index < lines.length; index += 1) {
        const source = stripInlineComment(lines[index]);
        const spec = declarationSpecs.find(candidate => candidate.pattern.test(source));
        if (!spec) {
            continue;
        }
        const block = readBracketBlock(lines, index);
        if (!block) {
            continue;
        }
        const names = spec.mode === "breed" ? breedNames(block.content) : variableNames(block.content);
        for (const name of names) {
            completions.push({
                name,
                kind: spec.kind,
                signature: block.signature
            });
        }
    }
    return completions;
}
function readBracketBlock(lines, startIndex) {
    let depth = 0;
    let seenOpen = false;
    let content = "";
    const signatureLines = [];
    for (let index = startIndex; index < lines.length; index += 1) {
        const source = stripInlineComment(lines[index]);
        signatureLines.push(source.trimEnd());
        for (let column = 0; column < source.length; column += 1) {
            const character = source[column];
            if (character === "[") {
                if (seenOpen) {
                    content += character;
                }
                depth += 1;
                seenOpen = true;
                continue;
            }
            if (character === "]" && seenOpen) {
                depth -= 1;
                if (depth === 0) {
                    return {
                        content,
                        signature: compactSignature(signatureLines)
                    };
                }
                content += character;
                continue;
            }
            if (seenOpen) {
                content += character;
            }
        }
        if (seenOpen) {
            content += "\n";
        }
    }
    return undefined;
}
function variableNames(content) {
    return content.split(/\s+/).map(token => token.trim()).filter(isNameToken);
}
function breedNames(content) {
    return variableNames(content).slice(0, 2);
}
function isNameToken(token) {
    return token.length > 0 && !/[\[\]";,]/.test(token);
}
function compactSignature(lines) {
    return lines.map(line => line.trim()).filter(Boolean).join(" ");
}
function signatureLineAt(source, offset) {
    const lineStart = source.lastIndexOf("\n", Math.max(0, offset - 1)) + 1;
    const nextLine = source.indexOf("\n", offset);
    const lineEnd = nextLine < 0 ? source.length : nextLine;
    return source.slice(lineStart, lineEnd).trim();
}
function stripInlineComment(line) {
    let inString = false;
    for (let index = 0; index < line.length; index += 1) {
        const current = line[index];
        if (current === "\\" && inString) {
            index += 1;
            continue;
        }
        if (current === "\"") {
            inString = !inString;
            continue;
        }
        if (current === ";" && !inString) {
            return line.slice(0, index);
        }
    }
    return line;
}
function splitLines(source) {
    return source.length === 0 ? [] : source.split(/\r?\n/);
}
//# sourceMappingURL=modelCompletions.js.map