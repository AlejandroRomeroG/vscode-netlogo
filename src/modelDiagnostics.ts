import { analyzeNetLogoCodeSymbols } from "./modelSymbols";

export interface CodeDiagnostic {
  readonly start: number;
  readonly end: number;
  readonly message: string;
  readonly code: NetLogoDiagnosticCode;
}

export type NetLogoDiagnosticCode =
  | "netlogo.unterminatedString"
  | "netlogo.unexpectedClosingDelimiter"
  | "netlogo.mismatchedClosingDelimiter"
  | "netlogo.unclosedDelimiter"
  | "netlogo.duplicateCallable"
  | "netlogo.missingEnd"
  | "netlogo.unexpectedEnd";

interface StackEntry {
  readonly character: string;
  readonly offset: number;
}

interface CodeLine {
  readonly text: string;
  readonly start: number;
  readonly end: number;
}

interface OpenCallable {
  readonly kind: "procedure" | "reporter";
  readonly name: string;
  readonly start: number;
  readonly end: number;
}

const matchingClosers: Record<string, string> = {
  "(": ")",
  "[": "]",
  "{": "}"
};

const matchingOpeners: Record<string, string> = {
  ")": "(",
  "]": "[",
  "}": "{"
};

const callablePattern = /^(\s*)(to-report|to)\s+([^\s\[\];]+)/i;
const endPattern = /^\s*end\s*$/i;

export function analyzeNetLogoCode(code: string): CodeDiagnostic[] {
  const diagnostics: CodeDiagnostic[] = [];
  const stack: StackEntry[] = [];
  let index = 0;

  while (index < code.length) {
    const character = code[index];

    if (character === ";") {
      index = skipComment(code, index);
      continue;
    }

    if (character === "\"") {
      const end = readStringEnd(code, index);
      if (end === undefined) {
        diagnostics.push({
          start: index,
          end: Math.min(code.length, index + 1),
          message: "Unterminated string literal.",
          code: "netlogo.unterminatedString"
        });
        break;
      }
      index = end;
      continue;
    }

    if (matchingClosers[character]) {
      stack.push({ character, offset: index });
      index += 1;
      continue;
    }

    if (matchingOpeners[character]) {
      const expected = matchingOpeners[character];
      const previous = stack.pop();
      if (!previous) {
        diagnostics.push({
          start: index,
          end: index + 1,
          message: `Unexpected closing '${character}'.`,
          code: "netlogo.unexpectedClosingDelimiter"
        });
      } else if (previous.character !== expected) {
        diagnostics.push({
          start: index,
          end: index + 1,
          message: `Mismatched closing '${character}'. Expected '${matchingClosers[previous.character]}'.`,
          code: "netlogo.mismatchedClosingDelimiter"
        });
      }
      index += 1;
      continue;
    }

    index += 1;
  }

  for (const entry of stack.reverse()) {
    diagnostics.push({
      start: entry.offset,
      end: entry.offset + 1,
      message: `Unclosed '${entry.character}'. Expected '${matchingClosers[entry.character]}'.`,
      code: "netlogo.unclosedDelimiter"
    });
  }

  diagnostics.push(...duplicateCallableDiagnostics(code));
  diagnostics.push(...callableBoundaryDiagnostics(code));

  return diagnostics;
}

function duplicateCallableDiagnostics(code: string): CodeDiagnostic[] {
  const seen = new Map<string, string>();
  const diagnostics: CodeDiagnostic[] = [];

  for (const symbol of analyzeNetLogoCodeSymbols(code)) {
    if (symbol.kind === "declaration") {
      continue;
    }

    const key = symbol.name.toLowerCase();
    const firstKind = seen.get(key);
    if (firstKind) {
      diagnostics.push({
        start: symbol.selectionStart,
        end: symbol.selectionEnd,
        message: `Duplicate NetLogo ${symbol.kind} '${symbol.name}'. First defined as a ${firstKind}.`,
        code: "netlogo.duplicateCallable"
      });
      continue;
    }

    seen.set(key, symbol.kind);
  }

  return diagnostics;
}

function callableBoundaryDiagnostics(code: string): CodeDiagnostic[] {
  const diagnostics: CodeDiagnostic[] = [];
  let open: OpenCallable | undefined;

  for (const line of splitLines(code)) {
    const source = stripInlineComment(line.text);
    const callable = source.match(callablePattern);
    if (callable) {
      if (open) {
        diagnostics.push({
          start: open.start,
          end: open.end,
          message: `Missing 'end' for NetLogo ${open.kind} '${open.name}' before the next procedure or reporter.`,
          code: "netlogo.missingEnd"
        });
      }

      const keyword = callable[2].toLowerCase();
      const name = callable[3];
      const nameColumn = line.text.indexOf(name, callable[1].length + callable[2].length);
      const start = line.start + Math.max(0, nameColumn);
      open = {
        kind: keyword === "to-report" ? "reporter" : "procedure",
        name,
        start,
        end: start + name.length
      };
      continue;
    }

    if (endPattern.test(source)) {
      if (open) {
        open = undefined;
      } else {
        const column = line.text.search(/\bend\b/i);
        const start = line.start + Math.max(0, column);
        diagnostics.push({
          start,
          end: start + "end".length,
          message: "Unexpected 'end' outside a NetLogo procedure or reporter.",
          code: "netlogo.unexpectedEnd"
        });
      }
    }
  }

  if (open) {
    diagnostics.push({
      start: open.start,
      end: open.end,
      message: `Missing 'end' for NetLogo ${open.kind} '${open.name}'.`,
      code: "netlogo.missingEnd"
    });
  }

  return diagnostics;
}

function skipComment(code: string, start: number): number {
  const newline = code.indexOf("\n", start);
  return newline < 0 ? code.length : newline + 1;
}

function readStringEnd(code: string, start: number): number | undefined {
  let index = start + 1;
  while (index < code.length) {
    if (code[index] === "\\" && index + 1 < code.length) {
      index += 2;
      continue;
    }
    if (code[index] === "\"") {
      return index + 1;
    }
    index += 1;
  }
  return undefined;
}

function stripInlineComment(line: string): string {
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

function splitLines(source: string): CodeLine[] {
  if (source.length === 0) {
    return [];
  }

  const lines: CodeLine[] = [];
  let start = 0;
  while (start <= source.length) {
    const newline = source.indexOf("\n", start);
    if (newline < 0) {
      lines.push({ text: source.slice(start), start, end: source.length });
      break;
    }
    lines.push({ text: source.slice(start, newline), start, end: newline });
    start = newline + 1;
  }
  return lines;
}
