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
exports.COMMON_NETLOGO_COMMANDS = void 0;
exports.promptForNetLogoCommand = promptForNetLogoCommand;
exports.rememberNetLogoCommand = rememberNetLogoCommand;
exports.clearNetLogoCommandHistory = clearNetLogoCommandHistory;
exports.buildNetLogoCommandPicks = buildNetLogoCommandPicks;
exports.normalizeNetLogoCommandHistory = normalizeNetLogoCommandHistory;
const vscode = __importStar(require("vscode"));
const COMMAND_HISTORY_KEY = "netlogo.commandHistory";
const LEGACY_LAST_COMMAND_KEY = "netlogo.lastCommand";
const MAX_COMMAND_HISTORY = 8;
exports.COMMON_NETLOGO_COMMANDS = [
    "setup",
    "go",
    "reset-ticks",
    "clear-all",
    "display",
    "reset-perspective"
];
async function promptForNetLogoCommand(context, options) {
    const history = getNetLogoCommandHistory(context);
    const selected = await vscode.window.showQuickPick(buildNetLogoCommandPicks(history), {
        title: "NetLogo command",
        placeHolder: "Select a command or type a new one",
        matchOnDescription: true
    });
    if (!selected) {
        return undefined;
    }
    if (selected.action !== "new" && selected.command) {
        await rememberNetLogoCommand(context, selected.command);
        return selected.command;
    }
    const lastCommand = history[0] ?? "";
    const command = await vscode.window.showInputBox({
        title: "NetLogo command",
        prompt: options.prompt,
        placeHolder: "setup, go, reset-perspective",
        value: lastCommand,
        valueSelection: lastCommand ? [0, lastCommand.length] : undefined
    });
    const normalizedCommand = command?.trim();
    if (!normalizedCommand) {
        return undefined;
    }
    await rememberNetLogoCommand(context, normalizedCommand);
    return normalizedCommand;
}
async function rememberNetLogoCommand(context, command) {
    const normalizedCommand = command.trim();
    if (normalizedCommand) {
        const history = getNetLogoCommandHistory(context);
        const nextHistory = [
            normalizedCommand,
            ...history.filter(entry => entry !== normalizedCommand)
        ].slice(0, MAX_COMMAND_HISTORY);
        await context.globalState.update(COMMAND_HISTORY_KEY, nextHistory);
        await context.globalState.update(LEGACY_LAST_COMMAND_KEY, normalizedCommand);
    }
}
async function clearNetLogoCommandHistory(context) {
    await context.globalState.update(COMMAND_HISTORY_KEY, undefined);
    await context.globalState.update(LEGACY_LAST_COMMAND_KEY, undefined);
}
function getNetLogoCommandHistory(context) {
    const storedHistory = context.globalState.get(COMMAND_HISTORY_KEY);
    if (Array.isArray(storedHistory)) {
        return normalizeNetLogoCommandHistory(storedHistory);
    }
    const legacyCommand = context.globalState.get(LEGACY_LAST_COMMAND_KEY, "").trim();
    return legacyCommand ? [legacyCommand] : [];
}
function buildNetLogoCommandPicks(history) {
    const normalizedHistory = normalizeNetLogoCommandHistory(history);
    const historySet = new Set(normalizedHistory);
    const commonCommands = exports.COMMON_NETLOGO_COMMANDS.filter(command => !historySet.has(command));
    const picks = [
        {
            label: "$(edit) Type command...",
            description: "Enter a NetLogo command",
            action: "new"
        }
    ];
    if (normalizedHistory.length > 0) {
        picks.push({
            label: "Recent",
            kind: vscode.QuickPickItemKind.Separator
        });
    }
    picks.push(...normalizedHistory.map((command, index) => ({
        label: command,
        description: index === 0 ? "Most recent" : "Recent",
        action: "recent",
        command
    })));
    if (commonCommands.length > 0) {
        picks.push({
            label: "Common",
            kind: vscode.QuickPickItemKind.Separator
        });
    }
    picks.push(...commonCommands.map(command => ({
        label: command,
        description: "Common",
        action: "common",
        command
    })));
    return picks;
}
function normalizeNetLogoCommandHistory(values) {
    const seen = new Set();
    const history = [];
    for (const value of values) {
        if (typeof value !== "string") {
            continue;
        }
        const command = value.trim();
        if (!command || seen.has(command)) {
            continue;
        }
        seen.add(command);
        history.push(command);
        if (history.length >= MAX_COMMAND_HISTORY) {
            break;
        }
    }
    return history;
}
//# sourceMappingURL=commandPrompt.js.map