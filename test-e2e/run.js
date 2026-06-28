const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { runTests } = require("@vscode/test-electron");

async function main() {
  const extensionDevelopmentPath = path.resolve(__dirname, "..");
  const extensionTestsPath = path.resolve(__dirname, "suite");
  const workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), "vscode-netlogo-e2e-"));

  fs.copyFileSync(
    path.join(extensionDevelopmentPath, "samples", "minimal.nlogo"),
    path.join(workspacePath, "minimal.nlogo")
  );
  const model3DPath = path.join(workspacePath, "model-3d.nlogo3d");
  const sample3DPath = defaultNetLogo3DSamplePath();
  if (sample3DPath) {
    fs.copyFileSync(sample3DPath, model3DPath);
  } else {
    fs.writeFileSync(model3DPath, minimal3DModel(), "utf8");
  }

  const vscodeExecutablePath = process.env.VSCODE_E2E_PATH || defaultVSCodeExecutablePath();
  const options = {
    extensionDevelopmentPath,
    extensionTestsPath,
    launchArgs: [workspacePath, "--disable-extensions"],
    extensionTestsEnv: {
      VSCODE_NETLOGO_E2E_WORKSPACE: workspacePath,
      VSCODE_NETLOGO_E2E_CAN_RUN_3D: sample3DPath ? "1" : "0"
    }
  };
  if (vscodeExecutablePath) {
    options.vscodeExecutablePath = vscodeExecutablePath;
  }

  try {
    await runTests(options);
  } finally {
    fs.rmSync(workspacePath, { recursive: true, force: true });
  }
}

function defaultVSCodeExecutablePath() {
  const candidates = process.platform === "darwin"
    ? ["/Applications/Visual Studio Code.app/Contents/MacOS/Code"]
    : [];

  return candidates.find(candidate => fs.existsSync(candidate));
}

function defaultNetLogo3DSamplePath() {
  const candidates = process.platform === "darwin"
    ? ["/Applications/NetLogo 6.4.0/models/3D/Sample Models/Flocking 3D.nlogo3d"]
    : [];

  return candidates.find(candidate => fs.existsSync(candidate));
}

function minimal3DModel() {
  return [
    [
      "to setup",
      "  clear-all",
      "  create-turtles 2 [",
      "    setxyz random-xcor random-ycor random-zcor",
      "    set shape \"circle\"",
      "    set label word \"t\" who",
      "  ]",
      "  reset-ticks",
      "end"
    ].join("\n"),
    [
      "GRAPHICS-WINDOW",
      "330",
      "61",
      "750",
      "502",
      "-1",
      "-1",
      "10.0",
      "1",
      "10",
      "1",
      "1",
      "1",
      "0",
      "1",
      "1",
      "1",
      "-20",
      "20",
      "-20",
      "20",
      "-12",
      "12",
      "1",
      "1",
      "1",
      "ticks",
      "30.0",
      "",
      "BUTTON",
      "66",
      "78",
      "137",
      "111",
      "setup",
      "setup",
      "NIL",
      "1",
      "T",
      "OBSERVER",
      "NIL",
      "NIL",
      "NIL",
      "1",
      "",
      "SLIDER",
      "13",
      "206",
      "269",
      "239",
      "vision",
      "vision",
      "0",
      "20",
      "10",
      "1",
      "1",
      "scaled patches",
      "HORIZONTAL"
    ].join("\n"),
    "# Minimal 3D model for VS Code E2E",
    "default\ntrue\n0",
    "NetLogo 6.4.0"
  ].join("\n@#$#@#$#@\n");
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
