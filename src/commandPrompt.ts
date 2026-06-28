import * as vscode from "vscode";

const COMMAND_HISTORY_KEY = "netlogo.commandHistory";
const LEGACY_LAST_COMMAND_KEY = "netlogo.lastCommand";
const MAX_COMMAND_HISTORY = 8;
export const COMMON_NETLOGO_COMMANDS = [
  "setup",
  "go",
  "reset-ticks",
  "clear-all",
  "display",
  "reset-perspective"
] as const;

export interface NetLogoCommandPromptOptions {
  readonly prompt: string;
}

interface NetLogoCommandPick extends vscode.QuickPickItem {
  readonly action?: "new" | "recent" | "common";
  readonly command?: string;
}

export async function promptForNetLogoCommand(
  context: vscode.ExtensionContext,
  options: NetLogoCommandPromptOptions
): Promise<string | undefined> {
  const history = getNetLogoCommandHistory(context);
  const selected = await vscode.window.showQuickPick<NetLogoCommandPick>(
    buildNetLogoCommandPicks(history),
    {
      title: "NetLogo command",
      placeHolder: "Select a command or type a new one",
      matchOnDescription: true
    }
  );
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

export async function rememberNetLogoCommand(
  context: vscode.ExtensionContext,
  command: string
): Promise<void> {
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

export async function clearNetLogoCommandHistory(context: vscode.ExtensionContext): Promise<void> {
  await context.globalState.update(COMMAND_HISTORY_KEY, undefined);
  await context.globalState.update(LEGACY_LAST_COMMAND_KEY, undefined);
}

function getNetLogoCommandHistory(context: vscode.ExtensionContext): readonly string[] {
  const storedHistory = context.globalState.get<unknown>(COMMAND_HISTORY_KEY);
  if (Array.isArray(storedHistory)) {
    return normalizeNetLogoCommandHistory(storedHistory);
  }

  const legacyCommand = context.globalState.get<string>(LEGACY_LAST_COMMAND_KEY, "").trim();
  return legacyCommand ? [legacyCommand] : [];
}

export function buildNetLogoCommandPicks(history: readonly string[]): readonly NetLogoCommandPick[] {
  const normalizedHistory = normalizeNetLogoCommandHistory(history);
  const historySet = new Set(normalizedHistory);
  const commonCommands = COMMON_NETLOGO_COMMANDS.filter(command => !historySet.has(command));
  const picks: NetLogoCommandPick[] = [
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
      action: "recent" as const,
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
        action: "common" as const,
        command
      })));

  return picks;
}

export function normalizeNetLogoCommandHistory(values: readonly unknown[]): readonly string[] {
  const seen = new Set<string>();
  const history: string[] = [];
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
