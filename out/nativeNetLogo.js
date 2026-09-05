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
const child_process_1 = require("child_process");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
class NativeNetLogoLauncher {
    constructor(launch = runLaunchCommand) {
        this.launch = launch;
        this.pending = new Map();
    }
    openMacModel(appPath, filePath) {
        const modelPath = path.resolve(filePath);
        const applicationPath = path.resolve(appPath);
        const key = JSON.stringify([applicationPath, modelPath]);
        const existing = this.pending.get(key);
        if (existing) {
            return existing;
        }
        const opening = this.launchModel(applicationPath, modelPath).finally(() => this.pending.delete(key));
        this.pending.set(key, opening);
        return opening;
    }
    async launchModel(appPath, filePath) {
        const model = await fs.promises.stat(filePath);
        if (!model.isFile()) {
            throw new Error("The NetLogo model must be a file.");
        }
        // NetLogo has one model per process. OpenFiles events replace that model and
        // can deadlock AWT/JOGL on macOS when the 3D canvas is recreated. Launch the
        // native bundle with the model as a startup argument, never an AppleEvent.
        // --open also avoids loading a blank/previous model before the requested one.
        await this.launch("/usr/bin/open", ["-n", "-a", appPath, "--args", "--open", filePath]);
    }
}
exports.NativeNetLogoLauncher = NativeNetLogoLauncher;
function runLaunchCommand(command, args) {
    return new Promise((resolve, reject) => {
        // This timeout bounds Launch Services, not NetLogo's JVM/model startup.
        (0, child_process_1.execFile)(command, args, { timeout: 15000, maxBuffer: 65536, encoding: "utf8" }, (error, _stdout, stderr) => {
            if (error) {
                reject(new Error(stderr.trim() || error.message));
            }
            else {
                resolve();
            }
        });
    });
}
//# sourceMappingURL=nativeNetLogo.js.map