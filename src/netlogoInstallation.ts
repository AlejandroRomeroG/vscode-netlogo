import * as fs from "fs";
import * as os from "os";
import * as path from "path";

export interface NetLogoInstallation {
  readonly home: string;
  readonly jarPath: string;
  readonly classPath: readonly string[];
  readonly jvmArgs: readonly string[];
}

export function getConfiguredClassPath(classPath: readonly string[] | undefined): readonly string[] {
  return (classPath ?? [])
    .map(entry => entry.trim())
    .filter(Boolean);
}

export function getConfiguredJvmArgs(jvmArgs: readonly string[] | undefined): readonly string[] {
  return (jvmArgs ?? [])
    .map(entry => entry.trim())
    .filter(Boolean);
}

export function resolveNetLogoClassPath(options: {
  readonly configuredClassPath?: readonly string[];
  readonly home?: string;
  readonly autoDetect?: boolean;
  readonly searchRoots?: readonly string[];
}): NetLogoInstallation | undefined {
  const configured = getConfiguredClassPath(options.configuredClassPath);
  if (configured.length > 0) {
    const jarPath = configured.find(entry => isNetLogoJarName(path.basename(entry))) ?? configured[0];
    return {
      home: inferHomeFromJar(jarPath),
      jarPath,
      classPath: configured,
      jvmArgs: []
    };
  }

  if (options.home) {
    const installation = installationFromHome(options.home);
    if (installation) {
      return installation;
    }
  }

  if (options.autoDetect !== false) {
    return detectNetLogoInstallations(options.searchRoots ?? defaultSearchRoots())[0];
  }

  return undefined;
}

export function detectNetLogoInstallations(searchRoots: readonly string[] = defaultSearchRoots()): readonly NetLogoInstallation[] {
  const installations: NetLogoInstallation[] = [];
  const seenJars = new Set<string>();

  for (const root of searchRoots) {
    for (const candidate of candidateHomes(root)) {
      const installation = installationFromHome(candidate);
      if (installation && !seenJars.has(installation.jarPath)) {
        installations.push(installation);
        seenJars.add(installation.jarPath);
      }
    }
  }

  return installations.sort((left, right) => right.jarPath.localeCompare(left.jarPath));
}

export function installationFromHome(home: string): NetLogoInstallation | undefined {
  const normalizedHome = path.resolve(home);
  const jarPath = findNetLogoJar(normalizedHome);
  if (!jarPath) {
    return undefined;
  }

  return {
    home: inferHomeFromJar(jarPath),
    jarPath,
    classPath: buildClassPath(jarPath),
    jvmArgs: buildJvmArgs(jarPath)
  };
}

export function findNativeNetLogoApp(home: string, options: { readonly threeD?: boolean } = {}): string | undefined {
  const normalizedHome = path.resolve(home);
  if (normalizedHome.endsWith(".app") && isDirectory(normalizedHome)) {
    if (!options.threeD || isNetLogo3DAppName(path.basename(normalizedHome))) {
      return normalizedHome;
    }
  }

  for (const directory of uniqueExistingDirectories([
    normalizedHome,
    path.dirname(normalizedHome),
    path.dirname(path.dirname(normalizedHome))
  ])) {
    const app = findNetLogoAppInDirectory(directory, options);
    if (app) {
      return app;
    }
  }

  return undefined;
}

export function buildClassPath(jarPath: string): readonly string[] {
  const entries = [jarPath];
  const roots = [
    path.dirname(jarPath),
    path.dirname(path.dirname(jarPath)),
    path.dirname(path.dirname(path.dirname(jarPath)))
  ];

  const wildcardDirs = new Set<string>();
  for (const root of roots) {
    for (const relative of ["lib", "app", "app/lib", "extensions", "app/extensions"]) {
      const candidate = path.join(root, relative);
      if (isDirectory(candidate)) {
        wildcardDirs.add(path.join(candidate, "*"));
      }
    }
  }

  return [...entries, ...wildcardDirs];
}

export function buildJvmArgs(jarPath: string): readonly string[] {
  const home = inferHomeFromJar(jarPath);
  const args = [
    "-Dfile.encoding=UTF-8",
    "-Djava.awt.headless=true",
    "--add-exports=java.base/java.lang=ALL-UNNAMED",
    "--add-exports=java.desktop/sun.awt=ALL-UNNAMED",
    "--add-exports=java.desktop/sun.java2d=ALL-UNNAMED",
    "--add-exports=java.desktop/com.apple.laf=ALL-UNNAMED"
  ];
  const extensionsDir = findFirstDirectory([
    path.join(home, "extensions"),
    path.join(home, "app", "extensions"),
    path.join(home, "Contents", "Resources", "app", "extensions")
  ]);
  const modelsDir = findFirstDirectory([
    path.join(home, "models"),
    path.join(home, "app", "models"),
    path.join(home, "Contents", "Resources", "app", "models")
  ]);

  if (extensionsDir) {
    args.splice(1, 0, `-Dnetlogo.extensions.dir=${extensionsDir}`);
  }
  if (modelsDir) {
    args.splice(1, 0, `-Dnetlogo.models.dir=${modelsDir}`);
  }

  return args;
}

function defaultSearchRoots(): readonly string[] {
  const roots: string[] = [];
  if (process.platform === "darwin") {
    roots.push("/Applications");
    roots.push(path.join(os.homedir(), "Applications"));
  }

  if (process.platform === "win32") {
    roots.push("C:\\Program Files");
    roots.push("C:\\Program Files (x86)");
  }

  roots.push(os.homedir());
  return roots;
}

function candidateHomes(root: string): readonly string[] {
  if (!isDirectory(root)) {
    return [];
  }

  const candidates: string[] = [root];
  for (const entry of safeReadDir(root)) {
    if (/netlogo/i.test(entry.name)) {
      const first = path.join(root, entry.name);
      candidates.push(first);
      if (entry.isDirectory()) {
        for (const nested of safeReadDir(first)) {
          if (/netlogo/i.test(nested.name) || nested.name.endsWith(".app")) {
            candidates.push(path.join(first, nested.name));
          }
        }
      }
    }
  }

  return candidates;
}

function findNetLogoJar(home: string): string | undefined {
  const directCandidates = [
    path.join(home, "NetLogo.jar"),
    path.join(home, "app", "NetLogo.jar"),
    path.join(home, "lib", "NetLogo.jar"),
    path.join(home, "Contents", "Java", "NetLogo.jar"),
    path.join(home, "Contents", "Resources", "app", "NetLogo.jar")
  ];

  for (const candidate of directCandidates) {
    if (isFile(candidate)) {
      return candidate;
    }
  }

  for (const directory of [
    home,
    path.join(home, "app"),
    path.join(home, "lib"),
    path.join(home, "Contents", "Java"),
    path.join(home, "Contents", "Resources", "app")
  ]) {
    const jar = findNetLogoJarInDirectory(directory);
    if (jar) {
      return jar;
    }
  }

  return findJarShallow(home, 4);
}

function findJarShallow(root: string, maxDepth: number): string | undefined {
  if (maxDepth < 0 || !isDirectory(root)) {
    return undefined;
  }

  for (const entry of safeReadDir(root)) {
    const fullPath = path.join(root, entry.name);
    if (entry.isFile() && isNetLogoJarName(entry.name)) {
      return fullPath;
    }
  }

  for (const entry of safeReadDir(root)) {
    if (!entry.isDirectory()) {
      continue;
    }

    if (!/^(app|lib|Contents|Java|Resources|NetLogo|extensions|runtime|jars)|.*\.app$/i.test(entry.name)) {
      continue;
    }

    const found = findJarShallow(path.join(root, entry.name), maxDepth - 1);
    if (found) {
      return found;
    }
  }

  return undefined;
}

function inferHomeFromJar(jarPath: string): string {
  const normalized = path.resolve(jarPath);
  const parts = normalized.split(path.sep);
  const appIndex = parts.findIndex(part => part.endsWith(".app"));
  if (appIndex >= 0) {
    const prefix = normalized.startsWith(path.sep) ? path.sep : "";
    return prefix + parts.filter((part, index) => index <= appIndex && part.length > 0).join(path.sep);
  }

  if (path.basename(path.dirname(normalized)).toLowerCase() === "app") {
    return path.dirname(path.dirname(normalized));
  }

  return path.dirname(normalized);
}

function findNetLogoJarInDirectory(directory: string): string | undefined {
  if (!isDirectory(directory)) {
    return undefined;
  }

  return safeReadDir(directory)
    .filter(entry => entry.isFile() && isNetLogoJarName(entry.name))
    .map(entry => path.join(directory, entry.name))
    .sort((left, right) => path.basename(left).localeCompare(path.basename(right)))
    [0];
}

function uniqueExistingDirectories(directories: readonly string[]): readonly string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const directory of directories) {
    if (!isDirectory(directory) || seen.has(directory)) {
      continue;
    }
    seen.add(directory);
    result.push(directory);
  }
  return result;
}

function findNetLogoAppInDirectory(directory: string, options: { readonly threeD?: boolean }): string | undefined {
  const apps = safeReadDir(directory)
    .filter(entry => entry.isDirectory() && entry.name.endsWith(".app") && /netlogo/i.test(entry.name))
    .map(entry => path.join(directory, entry.name));
  const preferred = apps
    .filter(app => options.threeD ? isNetLogo3DAppName(path.basename(app)) : !isNetLogo3DAppName(path.basename(app)))
    .sort((left, right) => right.localeCompare(left))[0];
  return preferred ?? apps.sort((left, right) => right.localeCompare(left))[0];
}

function isNetLogo3DAppName(fileName: string): boolean {
  return /\b3d\b/i.test(fileName);
}

function isNetLogoJarName(fileName: string): boolean {
  return /^(netlogo\.jar|NetLogo\.jar|netlogo-\d+(?:\.\d+)*(?:-[\w.]+)?\.jar)$/i.test(fileName);
}

function findFirstDirectory(candidates: readonly string[]): string | undefined {
  return candidates.find(isDirectory);
}

function safeReadDir(directory: string): readonly fs.Dirent[] {
  try {
    return fs.readdirSync(directory, { withFileTypes: true });
  } catch {
    return [];
  }
}

function isDirectory(value: string): boolean {
  try {
    return fs.statSync(value).isDirectory();
  } catch {
    return false;
  }
}

function isFile(value: string): boolean {
  try {
    return fs.statSync(value).isFile();
  } catch {
    return false;
  }
}
