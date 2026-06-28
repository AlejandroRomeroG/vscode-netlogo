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
exports.createNetLogoCompletionProvider = createNetLogoCompletionProvider;
const vscode = __importStar(require("vscode"));
const modelCompletions_1 = require("./modelCompletions");
const modelFormat_1 = require("./modelFormat");
const snippetCompletions = [
    {
        label: "to procedure",
        insertText: "to ${1:name}\n  ${0}\nend",
        detail: "NetLogo procedure",
        documentation: "Create a command procedure.",
        kind: vscode.CompletionItemKind.Snippet
    },
    {
        label: "to-report reporter",
        insertText: "to-report ${1:name}\n  report ${0:value}\nend",
        detail: "NetLogo reporter",
        documentation: "Create a reporter procedure.",
        kind: vscode.CompletionItemKind.Snippet
    },
    {
        label: "ask",
        insertText: "ask ${1:agentset} [\n  ${0}\n]",
        detail: "NetLogo ask block",
        documentation: "Run commands in an agent context.",
        kind: vscode.CompletionItemKind.Snippet
    },
    {
        label: "if",
        insertText: "if ${1:condition} [\n  ${0}\n]",
        detail: "NetLogo conditional",
        documentation: "Run a block when a condition is true.",
        kind: vscode.CompletionItemKind.Snippet
    },
    {
        label: "ifelse",
        insertText: "ifelse ${1:condition} [\n  ${2}\n] [\n  ${0}\n]",
        detail: "NetLogo branching conditional",
        documentation: "Run one of two blocks based on a condition.",
        kind: vscode.CompletionItemKind.Snippet
    },
    {
        label: "repeat",
        insertText: "repeat ${1:count} [\n  ${0}\n]",
        detail: "NetLogo repeat loop",
        documentation: "Run a block a fixed number of times.",
        kind: vscode.CompletionItemKind.Snippet
    },
    {
        label: "globals",
        insertText: "globals [\n  ${0:variable}\n]",
        detail: "NetLogo globals declaration",
        documentation: "Declare global variables.",
        kind: vscode.CompletionItemKind.Snippet
    },
    {
        label: "turtles-own",
        insertText: "turtles-own [\n  ${0:variable}\n]",
        detail: "NetLogo turtle variables",
        documentation: "Declare turtle-owned variables.",
        kind: vscode.CompletionItemKind.Snippet
    },
    {
        label: "patches-own",
        insertText: "patches-own [\n  ${0:variable}\n]",
        detail: "NetLogo patch variables",
        documentation: "Declare patch-owned variables.",
        kind: vscode.CompletionItemKind.Snippet
    }
];
const keywordCompletions = [
    "ask",
    "breed",
    "carefully",
    "directed-link-breed",
    "else",
    "end",
    "extensions",
    "foreach",
    "globals",
    "if",
    "ifelse",
    "ifelse-value",
    "let",
    "links-own",
    "loop",
    "of",
    "patches-own",
    "report",
    "repeat",
    "set",
    "stop",
    "to",
    "to-report",
    "turtles-own",
    "undirected-link-breed",
    "while",
    "with"
];
const primitiveCompletions = [
    "all?",
    "any?",
    "clear-all",
    "clear-patches",
    "clear-plot",
    "clear-ticks",
    "clear-turtles",
    "count",
    "create-links-with",
    "create-turtles",
    "die",
    "distance",
    "export-plot",
    "export-view",
    "face",
    "facexy",
    "false",
    "fd",
    "hatch",
    "histogram",
    "link-neighbors",
    "max",
    "mean",
    "min",
    "n-of",
    "neighbors",
    "nobody",
    "one-of",
    "patch-here",
    "patches",
    "pen-down",
    "pen-up",
    "plot",
    "plotxy",
    "print",
    "random",
    "random-float",
    "reset-ticks",
    "rt",
    "set-current-plot",
    "set-current-plot-pen",
    "setxy",
    "show",
    "sort",
    "sprout",
    "sum",
    "tick",
    "tick-advance",
    "true",
    "turtles",
    "who"
];
function createNetLogoCompletionProvider() {
    const items = [
        ...snippetCompletions.map((spec, index) => completionItemFromSpec(spec, `0${index.toString().padStart(2, "0")}`)),
        ...keywordCompletions.map(keyword => simpleCompletion(keyword, vscode.CompletionItemKind.Keyword, "NetLogo keyword", "1")),
        ...primitiveCompletions.map(primitive => simpleCompletion(primitive, vscode.CompletionItemKind.Function, "NetLogo primitive", "2"))
    ];
    return {
        provideCompletionItems(document, position) {
            if (isInsideCommentOrString(document.lineAt(position.line).text, position.character)) {
                return [];
            }
            return [
                ...localCompletionItems(document),
                ...items
            ];
        }
    };
}
function completionItemFromSpec(spec, sortText) {
    const item = new vscode.CompletionItem(spec.label, spec.kind);
    item.insertText = new vscode.SnippetString(spec.insertText ?? spec.label);
    item.detail = spec.detail;
    item.documentation = new vscode.MarkdownString(spec.documentation);
    item.sortText = sortText;
    return item;
}
function simpleCompletion(label, kind, detail, sortPrefix) {
    const item = new vscode.CompletionItem(label, kind);
    item.detail = detail;
    item.sortText = `${sortPrefix}-${label}`;
    return item;
}
function localCompletionItems(document) {
    const model = (0, modelFormat_1.parseNetLogoModel)(document.getText(), document.fileName);
    return (0, modelCompletions_1.analyzeNetLogoLocalCompletions)(model.code).map((completion, index) => localCompletionItem(completion, index));
}
function localCompletionItem(completion, index) {
    const kind = completionItemKind(completion);
    const item = new vscode.CompletionItem(completion.name, kind);
    item.detail = `NetLogo ${completion.kind}`;
    item.documentation = new vscode.MarkdownString().appendCodeblock(completion.signature, "netlogo");
    item.sortText = `0-local-${index.toString().padStart(3, "0")}-${completion.name.toLowerCase()}`;
    return item;
}
function completionItemKind(completion) {
    switch (completion.kind) {
        case "reporter":
            return vscode.CompletionItemKind.Function;
        case "procedure":
            return vscode.CompletionItemKind.Method;
        case "breed":
            return vscode.CompletionItemKind.Class;
        default:
            return vscode.CompletionItemKind.Variable;
    }
}
function isInsideCommentOrString(line, character) {
    let inString = false;
    for (let index = 0; index < Math.min(character, line.length); index += 1) {
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
            return true;
        }
    }
    return inString;
}
//# sourceMappingURL=netlogoCompletions.js.map