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
exports.NativeNetLogoLauncher = void 0;
exports.listMacNetLogoInstances = listMacNetLogoInstances;
exports.launchMacNetLogoModel = launchMacNetLogoModel;
const child_process_1 = require("child_process");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
// AppKit identifies actual native applications, not headless bridge JVMs.
// Only process identity is read: no window titles, screen capture, Accessibility
// automation, process argument inspection, or document-open AppleEvents.
const listMacInstancesScript = `
ObjC.import("AppKit");
function run() {
  const running = $.NSWorkspace.sharedWorkspace.runningApplications;
  const apps = [];
  for (let i = 0; i < running.count; i++) {
    const app = running.objectAtIndex(i);
    const id = ObjC.unwrap(app.bundleIdentifier);
    if (id === "org.nlogo.NetLogo" || id === "org.nlogo.NetLogo3D") {
      apps.push({pid: Number(app.processIdentifier), appPath: ObjC.unwrap(app.bundleURL.path),
        startedAt: Number(app.launchDate.timeIntervalSince1970)});
    }
  }
  return JSON.stringify(apps);
}`;
// The synchronous Launch Services API returns the exact process we start; a
// before/after process-list difference could claim somebody else's new session.
// Keep native startup arguments and new-instance isolation (no OpenFiles event).
const launchMacInstanceScript = `
ObjC.import("AppKit");
function run(argv) {
  const request = JSON.parse(argv[0]);
  const configuration = $.NSMutableDictionary.alloc.init;
  configuration.setObjectForKey($(["--open", request.modelPath]), $.NSWorkspaceLaunchConfigurationArguments);
  const error = Ref();
  const app = $.NSWorkspace.sharedWorkspace.launchApplicationAtURLOptionsConfigurationError(
    $.NSURL.fileURLWithPath(request.appPath), $.NSWorkspaceLaunchNewInstance, configuration, error);
  if (!app || Number(app.processIdentifier) <= 0) {
    const message = error[0] ? ObjC.unwrap(error[0].localizedDescription) : null;
    throw new Error(message || "NetLogo could not be started.");
  }
  return JSON.stringify({pid: Number(app.processIdentifier), appPath: ObjC.unwrap(app.bundleURL.path),
    startedAt: Number(app.launchDate.timeIntervalSince1970)});
}`;
const activateMacInstanceScript = `
ObjC.import("AppKit");
function run(argv) {
  const expected = JSON.parse(argv[0]);
  const app = $.NSRunningApplication.runningApplicationWithProcessIdentifier(expected.pid);
  const id = ObjC.unwrap(app.bundleIdentifier);
  if ((id !== "org.nlogo.NetLogo" && id !== "org.nlogo.NetLogo3D") ||
      ObjC.unwrap(app.bundleURL.path) !== expected.appPath ||
      Number(app.launchDate.timeIntervalSince1970) !== expected.startedAt) {
    throw new Error("The native NetLogo instance has closed. Try again.");
  }
  if (!app.activateWithOptions($.NSApplicationActivateAllWindows | $.NSApplicationActivateIgnoringOtherApps)) {
    throw new Error("NetLogo is already open, but its window could not be activated. No duplicate was opened.");
  }
}`;
async function listMacNetLogoInstances() {
    const value = JSON.parse(await runCommand("/usr/bin/osascript", ["-l", "JavaScript", "-e", listMacInstancesScript]));
    if (!Array.isArray(value) || !value.every(isNativeInstance)) {
        throw new Error("Cannot identify running NetLogo instances. No new instance was opened.");
    }
    return value;
}
async function launchMacNetLogoModel(appPath, modelPath) {
    const value = JSON.parse(await runCommand("/usr/bin/osascript", ["-l", "JavaScript", "-e",
        launchMacInstanceScript, JSON.stringify({ appPath, modelPath })]));
    if (!isNativeInstance(value)) {
        throw new Error("NetLogo may have started, but its process could not be registered. No launch will be retried automatically.");
    }
    return value;
}
const macDesktop = {
    list: listMacNetLogoInstances,
    launch: launchMacNetLogoModel,
    async activate(instance) {
        await runCommand("/usr/bin/osascript", ["-l", "JavaScript", "-e", activateMacInstanceScript, JSON.stringify(instance)]);
    }
};
class NativeNetLogoLauncher {
    constructor(storage, desktop = macDesktop) {
        this.storage = storage;
        this.desktop = desktop;
        this.pending = new Map();
        this.queue = Promise.resolve();
        this.records = [];
    }
    async openMacModel(appPath, filePath) {
        const modelPath = await fs.promises.realpath(filePath);
        if (!(await fs.promises.stat(modelPath)).isFile()) {
            throw new Error("The NetLogo model must be a file.");
        }
        // Canonical paths combine symlink/relative aliases and requests that chose
        // different NetLogo installations for the same model.
        const existing = this.pending.get(modelPath);
        if (existing)
            return existing;
        // Serialize registry read/modify/write operations for distinct model clicks
        // as well as coalescing same-file requests.
        const opening = this.queue.then(() => this.openOrActivate(appPath, modelPath))
            .finally(() => this.pending.delete(modelPath));
        this.queue = opening.then(() => undefined, () => undefined);
        this.pending.set(modelPath, opening);
        return opening;
    }
    async openOrActivate(appPath, modelPath) {
        const instances = await this.desktop.list();
        const saved = readRecords(this.storage ? this.storage.read() : this.records);
        const live = saved.filter(record => instances.some(instance => sameInstance(record, instance)));
        if (live.length !== saved.length)
            await this.saveRecords(live);
        const recorded = live.find(record => record.modelPath === modelPath);
        if (recorded) {
            await this.desktop.activate(recorded);
            return { action: "activated", pid: recorded.pid };
        }
        const unknown = instances.filter(instance => !live.some(record => sameInstance(record, instance)));
        if (unknown.length) {
            return { action: "untracked", instances: unknown };
        }
        // One model per native process: keep startup argv, never send OpenFiles to
        // replace another model and recreate an existing AWT/JOGL 3D canvas.
        const launchAppPath = await fs.promises.realpath(appPath);
        const started = await this.desktop.launch(launchAppPath, modelPath);
        if (!isNativeInstance(started) || started.appPath !== launchAppPath ||
            instances.some(instance => sameInstance(instance, started))) {
            throw new Error("The new NetLogo process could not be identified safely. No launch will be retried automatically.");
        }
        await this.saveRecords([...live, { ...started, modelPath }]);
        return { action: "opened", pid: started.pid };
    }
    async activateExisting(instance) {
        // A user may leave the session picker open while NetLogo closes or restarts.
        const current = (await this.desktop.list()).find(value => sameInstance(value, instance));
        if (!current)
            throw new Error("That NetLogo session has closed. Try again; no new copy was opened.");
        await this.desktop.activate(current);
    }
    async saveRecords(records) {
        this.records = records;
        if (this.storage)
            await this.storage.write(records);
    }
}
exports.NativeNetLogoLauncher = NativeNetLogoLauncher;
function sameInstance(left, right) {
    return left.pid === right.pid && left.startedAt === right.startedAt && left.appPath === right.appPath;
}
function isNativeInstance(value) {
    if (!value || typeof value !== "object")
        return false;
    const item = value;
    return typeof item.pid === "number" && Number.isSafeInteger(item.pid) && item.pid > 0 &&
        typeof item.appPath === "string" && path.isAbsolute(item.appPath) &&
        typeof item.startedAt === "number" && Number.isFinite(item.startedAt) && item.startedAt > 0;
}
function readRecords(value) {
    if (value === undefined)
        return [];
    if (!Array.isArray(value) || value.some(item => !isNativeInstance(item) || !("modelPath" in item) ||
        typeof item.modelPath !== "string" || !path.isAbsolute(item.modelPath))) {
        throw new Error("The saved native NetLogo session registry is invalid. No new copy was opened.");
    }
    return value;
}
function runCommand(command, args) {
    return new Promise((resolve, reject) => {
        (0, child_process_1.execFile)(command, args, { timeout: 15000, maxBuffer: 1024 * 1024, encoding: "utf8" }, (error, stdout, stderr) => {
            if (error)
                reject(new Error(stderr.trim() || error.message));
            else
                resolve(stdout);
        });
    });
}
//# sourceMappingURL=nativeNetLogo.js.map