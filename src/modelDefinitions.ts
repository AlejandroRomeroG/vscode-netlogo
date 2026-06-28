import { analyzeNetLogoCodeSymbols } from "./modelSymbols";

export type CodeCallableKind = "procedure" | "reporter";

export interface CodeDefinition {
  readonly name: string;
  readonly kind: CodeCallableKind;
  readonly signature: string;
  readonly sourceStart: number;
  readonly sourceEnd: number;
  readonly targetStart: number;
  readonly targetEnd: number;
}

export interface CodeReference {
  readonly start: number;
  readonly end: number;
}

export function findNetLogoDefinition(code: string, offset: number): CodeDefinition | undefined {
  if (offset < 0 || offset > code.length || isInsideCommentOrString(code, offset)) {
    return undefined;
  }

  const token = tokenAt(code, offset);
  if (!token) {
    return undefined;
  }

  const name = token.text.toLowerCase();
  const symbol = analyzeNetLogoCodeSymbols(code).find(candidate =>
    candidate.kind !== "declaration" && candidate.name.toLowerCase() === name
  );
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

export function findNetLogoReferences(
  code: string,
  offset: number,
  includeDeclaration = true
): CodeReference[] {
  const definition = findNetLogoDefinition(code, offset);
  if (!definition) {
    return [];
  }

  return scanTokens(code)
    .filter(token => token.text.toLowerCase() === definition.name.toLowerCase())
    .filter(token => includeDeclaration || token.start !== definition.targetStart || token.end !== definition.targetEnd)
    .map(token => ({ start: token.start, end: token.end }));
}

export function isValidNetLogoProcedureName(name: string): boolean {
  return name.length > 0 && name.trim() === name && !Array.from(name).some(isDelimiter);
}

interface CodeToken {
  readonly text: string;
  readonly start: number;
  readonly end: number;
}

function tokenAt(source: string, offset: number): { text: string; start: number; end: number } | undefined {
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

function scanTokens(source: string): CodeToken[] {
  const tokens: CodeToken[] = [];
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

function isDelimiter(character: string): boolean {
  return /\s/.test(character) || "[](){}\";,".includes(character);
}

function skipComment(source: string, start: number): number {
  const newline = source.indexOf("\n", start);
  return newline < 0 ? source.length : newline + 1;
}

function skipString(source: string, start: number): number {
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

function signatureLineAt(source: string, offset: number): string {
  const lineStart = source.lastIndexOf("\n", Math.max(0, offset - 1)) + 1;
  const nextLine = source.indexOf("\n", offset);
  const lineEnd = nextLine < 0 ? source.length : nextLine;
  return source.slice(lineStart, lineEnd).trim();
}

function isInsideCommentOrString(source: string, offset: number): boolean {
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
