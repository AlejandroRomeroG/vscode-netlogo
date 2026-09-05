export interface PlotCsvPoint {
  readonly x: number;
  readonly y: number;
  readonly color?: number;
  readonly penDown: boolean;
}

export interface PlotCsvPen {
  readonly name: string;
  readonly penDown: boolean;
  readonly mode: number;
  readonly interval: number;
  readonly color?: number;
  readonly x?: number;
  readonly colorFormat?: "argb";
  readonly hidden?: boolean;
  readonly inLegend?: boolean;
  readonly points: readonly PlotCsvPoint[];
}

export interface ParsedPlotCsv {
  readonly name?: string;
  readonly xMin?: number;
  readonly xMax?: number;
  readonly yMin?: number;
  readonly yMax?: number;
  readonly autoplot?: boolean;
  readonly currentPen?: string;
  readonly legend?: boolean;
  readonly numberOfPens?: number;
  readonly pens: readonly PlotCsvPen[];
}

interface MutablePlotCsvPen {
  name: string;
  penDown: boolean;
  mode: number;
  interval: number;
  color?: number;
  x?: number;
  points: PlotCsvPoint[];
}

interface PlotDataGroup {
  readonly start: number;
  readonly end: number;
  readonly colorIndex?: number;
  readonly penDownIndex?: number;
}

/**
 * Parses the CSV emitted by NetLogo's export-plot command.
 *
 * NetLogo stores all pens in one wide data table. Each pen owns a repeated
 * group of x/y/color/pen-down columns, so empty cells must retain their
 * original indexes while the table is parsed.
 */
export function parsePlotCsv(csv: string): ParsedPlotCsv {
  const rows = csv.split(/\r?\n/).map(parsePlotCsvLine);
  const settingsHeaderIndex = rows.findIndex(isPlotSettingsHeader);
  const settingsHeader = settingsHeaderIndex >= 0 ? rows[settingsHeaderIndex] : [];
  const settingsValueIndex = settingsHeaderIndex >= 0
    ? nextNonBlankRowIndex(rows, settingsHeaderIndex + 1)
    : undefined;
  const settingsValues = settingsValueIndex === undefined ? [] : rows[settingsValueIndex];

  const setting = (name: string): string | undefined => {
    const index = settingsHeader.findIndex(value => normalizeHeader(value) === name);
    return index >= 0 ? settingsValues[index] : undefined;
  };

  const plotNameIndex = settingsHeaderIndex >= 0
    ? previousNonBlankRowIndex(rows, settingsHeaderIndex - 1)
    : undefined;
  const plotNameRow = plotNameIndex === undefined ? undefined : rows[plotNameIndex];
  const plotName = plotNameRow && plotNameRow.filter(value => value.trim().length > 0).length === 1
    ? cleanNetLogoString(plotNameRow.find(value => value.trim().length > 0) ?? "")
    : undefined;

  const penHeaderIndex = rows.findIndex(isPenMetadataHeader);
  const dataHeaderIndex = findDataHeaderIndex(rows, Math.max(0, penHeaderIndex + 1));
  const dataNamesIndex = dataHeaderIndex === undefined
    ? undefined
    : previousNonBlankRowIndex(rows, dataHeaderIndex - 1);
  const penRowsEnd = dataNamesIndex ?? rows.length;
  const pens = penHeaderIndex >= 0
    ? parsePenMetadata(rows, penHeaderIndex, penRowsEnd)
    : [];

  if (dataHeaderIndex !== undefined) {
    addPlotPoints(rows, dataHeaderIndex, dataNamesIndex, pens);
  }

  return {
    name: plotName || undefined,
    xMin: finiteNumber(setting("x min")),
    xMax: finiteNumber(setting("x max")),
    yMin: finiteNumber(setting("y min")),
    yMax: finiteNumber(setting("y max")),
    autoplot: plotBoolean(setting("autoplot?")),
    currentPen: cleanOptionalNetLogoString(setting("current pen")),
    legend: plotBoolean(setting("legend open?") ?? setting("legend?")),
    numberOfPens: finiteNumber(setting("number of pens")),
    pens
  };
}

/** Parses one RFC 4180-style CSV row without discarding empty cells. */
export function parsePlotCsvLine(row: string): string[] {
  const cells: string[] = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < row.length; index += 1) {
    const character = row[index];
    if (quoted) {
      if (character === '"' && row[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        cell += character;
      }
      continue;
    }

    if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      cells.push(cell);
      cell = "";
    } else {
      cell += character;
    }
  }

  cells.push(cell);
  return cells;
}

function parsePenMetadata(
  rows: readonly string[][],
  headerIndex: number,
  endIndex: number
): MutablePlotCsvPen[] {
  const header = rows[headerIndex];
  const nameIndex = columnIndex(header, "pen name");
  const penDownIndex = columnIndex(header, "pen down?");
  const modeIndex = columnIndex(header, "mode");
  const intervalIndex = columnIndex(header, "interval");
  const colorIndex = columnIndex(header, "color");
  const xIndex = columnIndex(header, "x");
  const pens: MutablePlotCsvPen[] = [];

  for (let rowIndex = headerIndex + 1; rowIndex < endIndex; rowIndex += 1) {
    const row = rows[rowIndex];
    if (isBlankRow(row)) {
      break;
    }

    const name = cleanNetLogoString(cellAt(row, nameIndex));
    pens.push({
      name,
      penDown: plotBoolean(cellAt(row, penDownIndex)) ?? true,
      mode: finiteNumber(cellAt(row, modeIndex)) ?? 0,
      interval: finiteNumber(cellAt(row, intervalIndex)) ?? 1,
      color: finiteNumber(cellAt(row, colorIndex)),
      x: finiteNumber(cellAt(row, xIndex)),
      points: []
    });
  }

  return pens;
}

function addPlotPoints(
  rows: readonly string[][],
  headerIndex: number,
  namesIndex: number | undefined,
  pens: MutablePlotCsvPen[]
): void {
  const header = rows[headerIndex];
  const names = namesIndex === undefined ? [] : rows[namesIndex];
  const groups = plotDataGroups(header);

  for (let groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
    const group = groups[groupIndex];
    const exportedName = cleanNetLogoString(names[group.start] ?? "");
    let pen = pens[groupIndex];

    if (!pen) {
      pen = {
        name: exportedName,
        penDown: true,
        mode: 0,
        interval: 1,
        points: []
      };
      pens.push(pen);
    }

    for (let rowIndex = headerIndex + 1; rowIndex < rows.length; rowIndex += 1) {
      const row = rows[rowIndex];
      if (isBlankRow(row)) {
        continue;
      }

      const x = finiteNumber(row[group.start]);
      const y = finiteNumber(row[group.start + 1]);
      if (x === undefined || y === undefined) {
        continue;
      }

      pen.points.push({
        x,
        y,
        color: group.colorIndex === undefined ? undefined : finiteNumber(row[group.colorIndex]),
        penDown: group.penDownIndex === undefined
          ? true
          : plotBoolean(row[group.penDownIndex]) ?? true
      });
    }
  }
}

function plotDataGroups(header: readonly string[]): PlotDataGroup[] {
  const starts: number[] = [];
  for (let index = 0; index + 1 < header.length; index += 1) {
    if (normalizeHeader(header[index]) === "x" && normalizeHeader(header[index + 1]) === "y") {
      starts.push(index);
    }
  }

  return starts.map((start, index) => {
    const end = starts[index + 1] ?? header.length;
    return {
      start,
      end,
      colorIndex: findColumnBetween(header, "color", start + 2, end),
      penDownIndex: findColumnBetween(header, "pen down?", start + 2, end)
    };
  });
}

function findDataHeaderIndex(rows: readonly string[][], startIndex: number): number | undefined {
  for (let index = startIndex; index < rows.length; index += 1) {
    if (plotDataGroups(rows[index]).length > 0) {
      return index;
    }
  }
  return undefined;
}

function isPlotSettingsHeader(row: readonly string[]): boolean {
  const headers = new Set(row.map(normalizeHeader));
  return headers.has("x min")
    && headers.has("x max")
    && headers.has("y min")
    && headers.has("y max");
}

function isPenMetadataHeader(row: readonly string[]): boolean {
  const headers = new Set(row.map(normalizeHeader));
  return headers.has("pen name")
    && headers.has("mode")
    && headers.has("interval")
    && headers.has("color");
}

function isBlankRow(row: readonly string[]): boolean {
  return row.every(value => value.trim().length === 0);
}

function nextNonBlankRowIndex(rows: readonly string[][], startIndex: number): number | undefined {
  for (let index = startIndex; index < rows.length; index += 1) {
    if (!isBlankRow(rows[index])) {
      return index;
    }
  }
  return undefined;
}

function previousNonBlankRowIndex(rows: readonly string[][], startIndex: number): number | undefined {
  for (let index = startIndex; index >= 0; index -= 1) {
    if (!isBlankRow(rows[index])) {
      return index;
    }
  }
  return undefined;
}

function columnIndex(header: readonly string[], name: string): number | undefined {
  const index = header.findIndex(value => normalizeHeader(value) === name);
  return index >= 0 ? index : undefined;
}

function findColumnBetween(
  header: readonly string[],
  name: string,
  start: number,
  end: number
): number | undefined {
  for (let index = start; index < end; index += 1) {
    if (normalizeHeader(header[index]) === name) {
      return index;
    }
  }
  return undefined;
}

function cellAt(row: readonly string[], index: number | undefined): string | undefined {
  return index === undefined ? undefined : row[index];
}

function finiteNumber(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === "") {
    return undefined;
  }

  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function plotBoolean(value: string | undefined): boolean | undefined {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "true" || normalized === "t" || normalized === "1") {
    return true;
  }
  if (normalized === "false" || normalized === "f" || normalized === "0") {
    return false;
  }
  return undefined;
}

function cleanOptionalNetLogoString(value: string | undefined): string | undefined {
  if (value === undefined || value.trim() === "") {
    return undefined;
  }
  return cleanNetLogoString(value);
}

function cleanNetLogoString(value: string | undefined): string {
  const trimmed = value?.trim() ?? "";
  const unquoted = trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')
    ? trimmed.slice(1, -1)
    : trimmed;
  let decoded = "";
  for (let index = 0; index < unquoted.length; index += 1) {
    const character = unquoted[index];
    if (character !== "\\" || index + 1 >= unquoted.length) {
      decoded += character;
      continue;
    }

    const escaped = unquoted[index + 1];
    if (escaped === "n") {
      decoded += "\n";
    } else if (escaped === "r") {
      decoded += "\r";
    } else if (escaped === "t") {
      decoded += "\t";
    } else if (escaped === '"') {
      decoded += '"';
    } else if (escaped === "\\") {
      decoded += "\\";
    } else {
      decoded += `\\${escaped}`;
    }
    index += 1;
  }
  return decoded;
}

function normalizeHeader(value: string): string {
  return value.trim().toLowerCase();
}
