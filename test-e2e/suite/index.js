const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vscode = require("vscode");

async function run() {
  const workspacePath = process.env.VSCODE_NETLOGO_E2E_WORKSPACE;
  assert.ok(workspacePath, "VSCODE_NETLOGO_E2E_WORKSPACE must be set");

  const extension = vscode.extensions.getExtension("local.vscode-netlogo");
  assert.ok(extension, "NetLogo extension should be visible to VS Code");
  await extension.activate();
  assert.equal(extension.isActive, true);

  const commands = await vscode.commands.getCommands(true);
  assert.ok(commands.includes("netlogo.openModelEditor"));
  assert.ok(commands.includes("netlogo.runSetup"));
  assert.ok(commands.includes("netlogo.runGoOnce"));

  await assertCanOpenNetLogoModel(path.join(workspacePath, "minimal.nlogo"));
  const model3DUri = await assertCanOpenNetLogoModel(path.join(workspacePath, "model-3d.nlogo3d"));
  if (process.env.VSCODE_NETLOGO_E2E_CAN_RUN_3D === "1") {
    const result = await vscode.commands.executeCommand("netlogo.runCommand", model3DUri, "setup");
    assert.ok(result, "3D setup should return a run result when NetLogo is auto-detected");
    assert.ok(result.view3DState, "3D setup should return view3DState");
    assert.ok(result.view3DState.turtles.length > 1, "3D view state should contain multiple turtles");
    assert.ok(result.view3DState.turtles.every(turtle => typeof turtle.shape === "string"));
  }
  await vscode.commands.executeCommand("workbench.action.closeAllEditors");
}

async function assertCanOpenNetLogoModel(filePath) {
  assert.equal(fs.existsSync(filePath), true, `${filePath} should exist`);
  const uri = vscode.Uri.file(filePath);
  const document = await vscode.workspace.openTextDocument(uri);
  assert.equal(document.languageId, "netlogo");

  await vscode.commands.executeCommand("vscode.openWith", uri, "netlogo.modelEditor");
  await waitFor(() => hasTab(path.basename(filePath)), `custom editor tab for ${path.basename(filePath)}`);

  await vscode.commands.executeCommand("netlogo.openModelEditor", uri);
  await waitFor(() => hasTab(path.basename(filePath)), `command-opened tab for ${path.basename(filePath)}`);
  return uri;
}

function hasTab(label) {
  return vscode.window.tabGroups.all.some(group => group.tabs.some(tab => tab.label === label));
}

async function waitFor(predicate, label) {
  const started = Date.now();
  while (Date.now() - started < 10_000) {
    if (predicate()) {
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.fail(`Timed out waiting for ${label}`);
}

module.exports = { run };
