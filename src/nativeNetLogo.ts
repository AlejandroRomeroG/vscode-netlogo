import { execFile } from "child_process";
import * as fs from "fs";
import * as path from "path";

type LaunchCommand = (command: string, args: readonly string[]) => Promise<void>;

export class NativeNetLogoLauncher {
  private readonly pending = new Map<string, Promise<void>>();

  constructor(private readonly launch: LaunchCommand = runLaunchCommand) {}

  openMacModel(appPath: string, filePath: string): Promise<void> {
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

  private async launchModel(appPath: string, filePath: string): Promise<void> {
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

function runLaunchCommand(command: string, args: readonly string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    // This timeout bounds Launch Services, not NetLogo's JVM/model startup.
    execFile(command, args, { timeout: 15000, maxBuffer: 65536, encoding: "utf8" }, (error, _stdout, stderr) => {
      if (error) {
        reject(new Error(stderr.trim() || error.message));
      } else {
        resolve();
      }
    });
  });
}
