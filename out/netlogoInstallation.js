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
exports.getConfiguredClassPath = getConfiguredClassPath;
exports.getConfiguredJvmArgs = getConfiguredJvmArgs;
exports.resolveNetLogoClassPath = resolveNetLogoClassPath;
exports.detectNetLogoInstallations = detectNetLogoInstallations;
exports.installationFromHome = installationFromHome;
exports.findNativeNetLogoApp = findNativeNetLogoApp;
exports.buildClassPath = buildClassPath;
exports.buildJvmArgs = buildJvmArgs;
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const path = __importStar(require("path"));
function getConfiguredClassPath(classPath) {
    return (classPath ?? [])
        .map(entry => entry.trim())
        .filter(Boolean);
}
function getConfiguredJvmArgs(jvmArgs) {
    return (jvmArgs ?? [])
        .map(entry => entry.trim())
        .filter(Boolean);
}
function resolveNetLogoClassPath(options) {
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
function detectNetLogoInstallations(searchRoots = defaultSearchRoots()) {
    const installations = [];
    const seenJars = new Set();
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
function installationFromHome(home) {
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
function findNativeNetLogoApp(home, options = {}) {
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
function buildClassPath(jarPath) {
    const entries = [jarPath];
    const roots = [
        path.dirname(jarPath),
        path.dirname(path.dirname(jarPath)),
        path.dirname(path.dirname(path.dirname(jarPath)))
    ];
    const wildcardDirs = new Set();
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
function buildJvmArgs(jarPath) {
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
function defaultSearchRoots() {
    const roots = [];
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
function candidateHomes(root) {
    if (!isDirectory(root)) {
        return [];
    }
    const candidates = [root];
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
function findNetLogoJar(home) {
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
function findJarShallow(root, maxDepth) {
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
function inferHomeFromJar(jarPath) {
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
function findNetLogoJarInDirectory(directory) {
    if (!isDirectory(directory)) {
        return undefined;
    }
    return safeReadDir(directory)
        .filter(entry => entry.isFile() && isNetLogoJarName(entry.name))
        .map(entry => path.join(directory, entry.name))
        .sort((left, right) => path.basename(left).localeCompare(path.basename(right)))[0];
}
function uniqueExistingDirectories(directories) {
    const seen = new Set();
    const result = [];
    for (const directory of directories) {
        if (!isDirectory(directory) || seen.has(directory)) {
            continue;
        }
        seen.add(directory);
        result.push(directory);
    }
    return result;
}
function findNetLogoAppInDirectory(directory, options) {
    const apps = safeReadDir(directory)
        .filter(entry => entry.isDirectory() && entry.name.endsWith(".app") && /netlogo/i.test(entry.name))
        .map(entry => path.join(directory, entry.name));
    const preferred = apps
        .filter(app => options.threeD ? isNetLogo3DAppName(path.basename(app)) : !isNetLogo3DAppName(path.basename(app)))
        .sort((left, right) => right.localeCompare(left))[0];
    return preferred ?? apps.sort((left, right) => right.localeCompare(left))[0];
}
function isNetLogo3DAppName(fileName) {
    return /\b3d\b/i.test(fileName);
}
function isNetLogoJarName(fileName) {
    return /^(netlogo\.jar|NetLogo\.jar|netlogo-\d+(?:\.\d+)*(?:-[\w.]+)?\.jar)$/i.test(fileName);
}
function findFirstDirectory(candidates) {
    return candidates.find(isDirectory);
}
function safeReadDir(directory) {
    try {
        return fs.readdirSync(directory, { withFileTypes: true });
    }
    catch {
        return [];
    }
}
function isDirectory(value) {
    try {
        return fs.statSync(value).isDirectory();
    }
    catch {
        return false;
    }
}
function isFile(value) {
    try {
        return fs.statSync(value).isFile();
    }
    catch {
        return false;
    }
}
//# sourceMappingURL=netlogoInstallation.js.map