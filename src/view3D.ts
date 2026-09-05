import type { Link3DValue, Rgb3DValue, Turtle3DValue, View3DState } from "./runner";

/** Decode one native snapshot; keep the large, fixed-width patch section packed for the webview. */
export function parseView3DBinary(data: Buffer): View3DState {
  let offset = 0;
  function take(length: number): number {
    if (!Number.isSafeInteger(length) || length < 0 || offset + length > data.length) {
      throw new Error("Truncated or invalid NetLogo 3D snapshot.");
    }
    const start = offset;
    offset += length;
    return start;
  }
  const integer = (): number => data.readInt32BE(take(4));
  const number = (): number => data.readDoubleBE(take(8));
  const boolean = (): boolean => data.readUInt8(take(1)) !== 0;
  const string = (): string => {
    const length = integer();
    const start = take(length);
    return data.toString("utf8", start, start + length);
  };
  const color = (): { color?: number; colorRgb: Rgb3DValue; alpha: number } => {
    const value = number();
    const start = take(4);
    return {
      color: Number.isFinite(value) ? value : undefined,
      colorRgb: { red: data[start + 1], green: data[start + 2], blue: data[start + 3] },
      alpha: data[start]
    };
  };
  if (integer() !== 0x4e4c5633 || integer() !== 1) {
    throw new Error("Unsupported NetLogo 3D snapshot format.");
  }
  const bounds = {
    minX: integer(), maxX: integer(), minY: integer(), maxY: integer(), minZ: integer(), maxZ: integer()
  };
  if (bounds.minX > bounds.maxX || bounds.minY > bounds.maxY || bounds.minZ > bounds.maxZ) {
    throw new Error("Invalid NetLogo 3D world bounds.");
  }
  const observer = { x: number(), y: number(), z: number() };
  const turtleCount = integer();
  const linkCount = integer();
  const patchCount = integer();
  // The minimum record lengths also bound allocations before any variable-length strings are read.
  if ([turtleCount, linkCount, patchCount].some(count => count < 0)
    || turtleCount * 109 + linkCount * 58 + patchCount * 24 > data.length - offset) {
    throw new Error("Invalid NetLogo 3D agent counts.");
  }
  const turtles: Turtle3DValue[] = [];
  const links: Link3DValue[] = [];
  for (let index = 0; index < turtleCount; index += 1) {
    const turtle = {
      who: number(), x: number(), y: number(), z: number(),
      heading: number(), pitch: number(), roll: number(), size: number(),
      ...color(), hidden: boolean(), shape: string(), label: string()
    };
    const labelColor = color();
    turtles.push({
      ...turtle, labelColor: labelColor.color, labelColorRgb: labelColor.colorRgb, labelAlpha: labelColor.alpha,
      penMode: string(), penSize: number()
    });
  }
  for (let index = 0; index < linkCount; index += 1) {
    const link = {
      end1: number(), end2: number(), ...color(), thickness: number(),
      directed: boolean(), hidden: boolean(), shape: string(), label: string()
    };
    const labelColor = color();
    links.push({ ...link, labelColor: labelColor.color, labelColorRgb: labelColor.colorRgb, labelAlpha: labelColor.alpha });
  }
  const patchOffset = take(patchCount * 24);
  if (offset !== data.length) {
    throw new Error("Unexpected data after NetLogo 3D snapshot.");
  }
  return {
    bounds, observer, turtleCount, linkCount, patchCount, turtles, links,
    patchData: data.buffer.slice(data.byteOffset + patchOffset, data.byteOffset + offset) as ArrayBuffer,
    patches: [], drawingLines: []
  };
}
