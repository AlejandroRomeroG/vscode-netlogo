export type CodeSymbolKind = "procedure" | "reporter" | "declaration";

export interface CodeSymbol {
  readonly name: string;
  readonly kind: CodeSymbolKind;
  readonly start: number;
  readonly end: number;
  readonly selectionStart: number;
  readonly selectionEnd: number;
}

interface CodeLine {
  readonly text: string;
  readonly start: number;
  readonly end: number;
  readonly next: number;
}

const declarationPattern = /^\s*(globals|extensions|turtles-own|patches-own|links-own|breed|directed-link-breed|undirected-link-breed)\b/i;
const procedurePattern = /^(\s*)(to-report|to)\s+([^\s\[\];]+)/i;

export function analyzeNetLogoCodeSymbols(code: string): CodeSymbol[] {
  const lines = splitLines(code);
  const symbols: CodeSymbol[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    const source = stripInlineComment(line.text);
    const procedure = source.match(procedurePattern);
    if (procedure) {
      const keyword = procedure[2].toLowerCase();
      const name = procedure[3];
      const nameColumn = line.text.indexOf(name, procedure[1].length + procedure[2].length);
      const endIndex = findProcedureEnd(lines, index + 1);
      const endLine = lines[endIndex] ?? line;
      const selectionStart = line.start + Math.max(0, nameColumn);
      symbols.push({
        name,
        kind: keyword === "to-report" ? "reporter" : "procedure",
        start: line.start + procedure[1].length,
        end: endLine.end,
        selectionStart,
        selectionEnd: selectionStart + name.length
      });
      index = endIndex + 1;
      continue;
    }

    const declaration = source.match(declarationPattern);
    if (declaration) {
      const trimmed = source.trim();
      const leading = line.text.length - line.text.trimStart().length;
      const selectionStart = line.start + leading;
      symbols.push({
        name: compactSymbolName(trimmed),
        kind: "declaration",
        start: selectionStart,
        end: line.start + source.replace(/\s+$/, "").length,
        selectionStart,
        selectionEnd: selectionStart + declaration[1].length
      });
    }

    index += 1;
  }

  return symbols;
}

function findProcedureEnd(lines: readonly CodeLine[], startIndex: number): number {
  for (let index = startIndex; index < lines.length; index += 1) {
    if (/^\s*end\s*$/i.test(stripInlineComment(lines[index].text))) {
      return index;
    }
  }
  return Math.max(0, lines.length - 1);
}

function compactSymbolName(value: string): string {
  return value.replace(/\s+/g, " ");
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
      lines.push({ text: source.slice(start), start, end: source.length, next: source.length });
      break;
    }
    lines.push({ text: source.slice(start, newline), start, end: newline, next: newline + 1 });
    start = newline + 1;
  }
  return lines;
}
