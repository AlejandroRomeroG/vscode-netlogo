<h1>
  <img src="resources/logo-hd.png" alt="NetLogo Tools logo" width="48" height="48" align="center">
  NetLogo Tools for VS Code
</h1>

**NetLogo Tools** is an alpha-stage Visual Studio Code extension for opening, editing, and running NetLogo model files directly in VS Code.

Author: **Alejandro Romero González**

> **Alpha notice:** This extension is under active development. It is suitable for experimentation, model inspection, and lightweight editing workflows, but it may still differ from NetLogo Desktop in behavior, rendering, and model compatibility.

## Overview

NetLogo Tools provides a custom editor for `.nlogo`, `.nlogox`, and `.nlogo3d` files. It presents the familiar NetLogo model structure through **Interface**, **Info**, and **Code** tabs while keeping the model file editable inside VS Code.

The extension is intended to complement NetLogo Desktop, not replace it. It is most useful when you want to inspect model code, adjust interface widgets, edit documentation, and run basic commands without leaving your development environment.

## Features

- Opens `.nlogo`, `.nlogox`, and `.nlogo3d` files in a dedicated NetLogo model editor.
- Displays the standard NetLogo sections: **Interface**, **Info**, and **Code**.
- Renders the **Info** tab as Markdown, with access to the source text for editing.
- Provides editable NetLogo source code in the **Code** tab.
- Preserves the overall NetLogo model format when saving changes.
- Renders common Interface widgets, including views, buttons, sliders, switches, choosers, monitors, plots, inputs, text boxes, and output areas.
- Supports selecting, moving, resizing, adding, and deleting Interface widgets.
- Includes a properties inspector for common widget fields such as labels, commands, variables, ranges, choices, monitor sources, plot axes, and text content.
- Runs `setup`, one-step `go`, forever loops, and custom commands through NetLogo headless.
- Keeps a persistent headless NetLogo session per model while VS Code is open.
- Synchronizes slider, switch, chooser, and input values before running model commands.
- Refreshes monitor values, plot previews, and exported views after model execution.
- Detects common local NetLogo installations and can open models in the native NetLogo application.

## Requirements

- Visual Studio Code.
- Java available on your system path.
- A local NetLogo installation, preferably NetLogo 6.x.

On macOS, a typical installation path is:

```text
/Applications/NetLogo 6.4.0/
```

## Installation

Install the extension from a VSIX package:

1. Open VS Code.
2. Open the **Extensions** view.
3. Select the **More Actions** menu.
4. Choose **Install from VSIX...**.
5. Select the generated `vscode-netlogo-*.vsix` file.
6. Run **Developer: Reload Window** if VS Code does not reload the extension automatically.

You can also install it from the command line:

```bash
code --install-extension vscode-netlogo-*.vsix --force
```

## Build from Source

Clone the repository and install the development dependencies:

```bash
git clone https://github.com/AlejandroRomeroG/vscode-netlogo.git
cd vscode-netlogo
npm install
```

Compile the extension:

```bash
npm run compile
```

Create a VSIX package:

```bash
npm run package:vsix
```

The generated `vscode-netlogo-*.vsix` file can be installed from the VS Code Extensions view or with the `code --install-extension` command shown above.

## Getting Started

1. Open a `.nlogo`, `.nlogox`, or `.nlogo3d` file in VS Code.
2. The file should open in the **NetLogo Model Editor**.
3. Run **NetLogo: Configure NetLogo** from the Command Palette.
4. Confirm or select your local NetLogo installation.
5. Use the **Interface** tab to run `setup`, `Go once`, or `Forever`.
6. Use **Info** to review or edit model documentation.
7. Use **Code** to inspect or edit NetLogo procedures.
8. Use **NetLogo: Open in NetLogo** whenever you need to compare behavior with the official desktop application.

## Configuration

The extension attempts to detect common NetLogo installations automatically. If detection fails, configure the installation manually in VS Code settings:

```json
{
  "netlogo.home": "/Applications/NetLogo 6.4.0",
  "netlogo.autoDetect": true,
  "netlogo.javaPath": "java",
  "netlogo.javacPath": "javac",
  "netlogo.verboseOutput": false
}
```

Use `netlogo.classPath` only for advanced or non-standard NetLogo installations.

## Recommended Workflow

Use **Interface** for running and adjusting the model, **Info** for documentation, and **Code** for NetLogo procedures. Save changes with `Cmd+S` on macOS or `Ctrl+S` on Windows and Linux.

For important models, keep a copy of the original file and compare behavior in NetLogo Desktop before relying on modified results.

## Known Limitations

- This is an alpha release and may contain bugs.
- Some behavior may differ from NetLogo Desktop because model execution is handled through NetLogo headless.
- Complex models, external extensions, or non-standard installation paths may require manual configuration.
- 3D support is experimental and may not match the native NetLogo 3D viewer exactly.

## License

This project is licensed under the **Creative Commons Attribution 4.0 International License (CC BY 4.0)**.

Copyright (c) Alejandro Romero González.

See `LICENSE.md` for details.
