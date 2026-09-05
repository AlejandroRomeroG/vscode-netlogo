import * as fs from "fs";
import * as path from "path";

// Info is model-supplied content. Never hand command:, javascript:, absolute
// file URLs, or paths outside the model directory to VS Code or the OS.
export function externalInfoUrl(href: string): string | undefined {
  if (typeof href !== "string" || /[\u0000-\u0020\u007f]/.test(href)) return undefined;
  try {
    const url = new URL(href);
    if (!["https:", "http:", "mailto:"].includes(url.protocol) || url.username || url.password) return undefined;
    if (url.protocol === "mailto:" && /%0[ad]/i.test(href)) return undefined;
    return url.href;
  } catch {
    return undefined;
  }
}

export async function resolveInfoLocalFile(modelPath: string, href: string): Promise<string> {
  if (typeof href !== "string" || /[\u0000-\u001f\u007f]/.test(href)) throw new Error("Invalid documentation path.");
  const relative = decodeURIComponent(href.replace(/^file:/i, ""));
  if (!relative || /[\u0000-\u001f\u007f\\]/.test(relative) || /^[a-z][a-z\d+.-]*:/i.test(relative) || path.isAbsolute(relative)) {
    throw new Error("Documentation files must be relative to the model directory.");
  }
  const root = await fs.promises.realpath(path.dirname(modelPath));
  const candidate = path.resolve(root, relative);
  const inside = (value: string): boolean => {
    const segment = path.relative(root, value);
    return segment !== ".." && !segment.startsWith(".." + path.sep) && !path.isAbsolute(segment);
  };
  if (!inside(candidate)) throw new Error("Documentation files must stay inside the model directory.");
  const resolved = await fs.promises.realpath(candidate);
  if (!inside(resolved) || !(await fs.promises.stat(resolved)).isFile()) {
    throw new Error("Documentation files must stay inside the model directory.");
  }
  return resolved;
}

export async function loadInfoLocalImage(modelPath: string, href: string): Promise<string> {
  const file = await resolveInfoLocalFile(modelPath, href);
  const sizeLimit = 8 * 1024 * 1024;
  if ((await fs.promises.stat(file)).size > sizeLimit) throw new Error("Documentation images must be smaller than 8 MB.");
  const bytes = await fs.promises.readFile(file);
  if (bytes.length > sizeLimit) throw new Error("Documentation images must be smaller than 8 MB.");
  const mime = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? "image/png"
    : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 ? "image/jpeg"
    : /^GIF8[79]a$/.test(bytes.subarray(0, 6).toString("ascii")) ? "image/gif"
    : bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP" ? "image/webp"
    : undefined;
  if (!mime) throw new Error("Supported documentation images are PNG, JPEG, GIF, and WebP.");
  return `data:${mime};base64,${bytes.toString("base64")}`;
}
