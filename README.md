<div align="center">
  <img src="resources/logo-hd.png" alt="NetLogo Tools logo" width="112">
  <h1>NetLogo Tools for VS Code</h1>
  <p><strong>Open, edit, run, and visualize NetLogo models without leaving Visual Studio Code.</strong></p>
  <p>
    <img alt="Status: Alpha" src="https://img.shields.io/badge/status-alpha-F59E0B?style=flat-square">
    <img alt="VS Code 1.88 or newer" src="https://img.shields.io/badge/VS_Code-%E2%89%A51.88-007ACC?style=flat-square&amp;logo=visualstudiocode&amp;logoColor=white">
    <img alt="Tested with NetLogo 6.4" src="https://img.shields.io/badge/NetLogo-6.4_tested-5A3E85?style=flat-square">
    <a href="LICENSE.md"><img alt="License: CC BY 4.0" src="https://img.shields.io/badge/license-CC_BY_4.0-2E8B57?style=flat-square"></a>
  </p>
  <p>
    <a href="#highlights">Highlights</a> ·
    <a href="#quick-start">Quick start</a> ·
    <a href="#commands">Commands</a> ·
    <a href="#configuration">Configuration</a> ·
    <a href="#development">Development</a>
  </p>
</div>

> [!WARNING]
> NetLogo Tools is alpha software under active development. Keep backups and validate important simulation results in NetLogo Desktop.

NetLogo Tools brings a model-aware editing and execution workflow to VS Code while keeping the original model file as the source of truth. It is designed as a companion to NetLogo Desktop: use VS Code for navigation, editing, interface work, and fast iteration, then open the same model in the native application whenever exact desktop behavior matters.

## Highlights

| Capability | What it provides |
| --- | --- |
| **Model-aware editor** | A dedicated editor for `.nlogo`, `.nlogo3d`, and `.nlogox` files with familiar **Interface**, **Info**, and **Code** tabs. |
| **Interface designer** | Separate **Interact** and **Layout** modes, widget selection, keyboard movement, resizing, property editing, and add/delete workflows. |
| **Headless runtime** | Persistent per-model sessions for `setup`, one-step commands, forever loops, and arbitrary commands with history. |
| **Plots and monitors** | Multi-pen plots with native colors and modes, a comprehensive plot/pen editor, and NetLogo-style monitor labels and number formatting. |
| **2D and 3D visualization** | Native 2D view exports plus an interactive local Three.js renderer for 3D agents, links, labels, patches, and drawing trails. |
| **Language intelligence** | Syntax highlighting, completions, diagnostics, quick fixes, symbols, hover, definitions, references, highlights, and rename support. |
| **Desktop integration** | NetLogo installation detection, runtime configuration, an output channel, and **Open in NetLogo** actions. |

## Supported model formats

| File | Editor support | Runtime notes |
| --- | --- | --- |
| `.nlogo` | Classic NetLogo sections and 2D Interface widgets | Best-tested with NetLogo 6.4 |
| `.nlogo3d` | Classic 3D models and Interface widgets | Requires a NetLogo installation with 3D headless support |
| `.nlogox` | NetLogo 7 XML structure, CDATA, and XML widgets | Execution requires a local NetLogo version that can open the model |

Saving is intentionally scoped: untouched model sections, neighboring widgets, XML entities, and CDATA are preserved wherever possible instead of rewriting the entire model.

## Quick start

### Requirements

- Visual Studio Code 1.88 or newer.
- A JDK with both `java` and `javac` available, or configured explicitly.
- A local NetLogo installation for model execution and view exports.

Editing works without starting the runtime. NetLogo 6.4 is the current best-tested execution target; the editor also understands the NetLogo 7 XML model structure.

### Install from VSIX

1. Open the **Extensions** view in VS Code.
2. Choose **More Actions → Install from VSIX...**.
3. Select the supplied `vscode-netlogo-*.vsix` file.
4. Run **Developer: Reload Window** if the extension is not activated automatically.

Command-line installation is also supported:

```bash
code --install-extension ./vscode-netlogo-x.y.z.vsix --force
```

### Open and run a model

1. Open a `.nlogo`, `.nlogo3d`, or `.nlogox` file. It opens in the **NetLogo Model Editor** by default.
2. Run **NetLogo: Configure NetLogo** if no local installation is detected automatically.
3. In **Interface**, run **Setup**, **Go once**, or **Forever**. The same toolbar can open the command prompt or native NetLogo.
4. Switch to **Layout** to select widgets, edit properties, move or resize them, and add or delete supported widget types.
5. Use **Info** for rendered Markdown documentation and **Code** for NetLogo source editing and language tools.

## Editing and visualization

### Interface workflow

- **Info** renders model documentation as Markdown and can switch back to its editable source; selecting preview content opens the corresponding source position.
- **Interact** runs Interface buttons and updates sliders, switches, and choosers without exposing layout controls.
- **Layout** enables selection, drag/resize interactions, keyboard movement, bounds editing, and widget-specific properties.
- Supported widgets include views, buttons, sliders, switches, choosers, monitors, plots, inputs, text boxes, and output areas.
- `Cmd+S` on macOS or `Ctrl+S` on Windows/Linux saves back to the real model document.

### Plots and monitors

- Reads complete native `export-plot` data, including multiple pens, unequal series lengths, color changes, pen-up points, runtime ranges, and legends.
- Renders NetLogo **Line**, **Bar**, and **Point** pen modes with native palette colors and intervals.
- Edits plot title, axes, ranges, auto-scaling, legend visibility, plot setup/update commands, and every pen's name, color, mode, interval, legend status, and setup/update commands.
- Offers all 154 default NetLogo 6.4 color swatches.
- Displays monitor titles correctly and formats numeric output with precision-aware rounding, grouping separators, trimmed decimal zeroes, and scientific notation when appropriate.

### Runtime and views

- Keeps a persistent headless workspace per model and runtime configuration.
- Saves and synchronizes stored Interface control values before execution.
- Refreshes ticks, monitors, plots, and views after each command.
- Uses NetLogo's tick-based speed scale and configured view frame rate as the target for forever loops while keeping `Stop` responsive.
- Displays 2D models from NetLogo's own exported PNG view.
- Reconstructs 3D models locally with orbit, zoom, pan, standard camera views, reset, fullscreen, light/dark backgrounds, and basic agent inspection.
- Handles compact 3D drawing trails for models with large agent and trail counts.

### NetLogo language tools

- TextMate syntax highlighting and editor pair/comment configuration.
- Built-in primitive and keyword completions plus local procedures, reporters, globals, owned variables, and breeds.
- Document symbols, hover, go to definition, references, document highlights, and rename for local procedures/reporters.
- Structural diagnostics for delimiters, strings, duplicate procedures/reporters, and missing or unexpected `end` statements.
- Quick fixes for repairable structural diagnostics.

## Commands

Open the Command Palette with `Cmd+Shift+P` on macOS or `Ctrl+Shift+P` on Windows/Linux.

| Command | Purpose |
| --- | --- |
| `NetLogo: Open Model Editor` | Open a model in the custom editor |
| `NetLogo: Open in NetLogo` | Open the active model in the native desktop application |
| `NetLogo: Configure NetLogo` | Detect or choose a local installation |
| `NetLogo: Run setup` | Run `setup` in the active model workspace |
| `NetLogo: Run go once` | Run `go` once |
| `NetLogo: Run command...` | Run an arbitrary command with recent-command history |
| `NetLogo: Clear Command History` | Remove saved command history |
| `NetLogo: Show Output` | Reveal bridge commands, exports, and diagnostics |

## Configuration

For most installations, use **NetLogo: Configure NetLogo** or set `netlogo.home` and leave automatic detection enabled:

```json
{
  "netlogo.home": "/Applications/NetLogo 6.4.0",
  "netlogo.autoDetect": true,
  "netlogo.javaPath": "java",
  "netlogo.javacPath": "javac"
}
```

| Setting | Default | Description |
| --- | --- | --- |
| `netlogo.home` | `""` | NetLogo installation folder or macOS app bundle |
| `netlogo.autoDetect` | `true` | Search common local installation paths |
| `netlogo.javaPath` | `"java"` | Java executable used for the headless runtime |
| `netlogo.javacPath` | `"javac"` | Java compiler used to build the small runtime bridge |
| `netlogo.jvmArgs` | `[]` | Additional JVM arguments appended to detected defaults |
| `netlogo.classPath` | `[]` | Explicit headless classpath; takes precedence over `netlogo.home` |
| `netlogo.commandTimeoutMs` | `60000` | Maximum bridge compile, command, report, or export wait time |
| `netlogo.verboseOutput` | `false` | Log detailed bridge activity to the NetLogo output channel |

`netlogo.classPath` is intended for advanced or non-standard installations and accepts Java wildcards such as `/path/to/lib/*`.

## Troubleshooting

<details>
<summary><strong>The runtime is not configured</strong></summary>

Run **NetLogo: Configure NetLogo** and select the installation directory or application bundle. If detection still fails, set `netlogo.home` or provide `netlogo.classPath` explicitly.

</details>

<details>
<summary><strong>java or javac cannot be started</strong></summary>

Install a full JDK, then set `netlogo.javaPath` and `netlogo.javacPath` to the corresponding executables. A JRE without `javac` is not sufficient for the first bridge compilation.

</details>

<details>
<summary><strong>A command times out or a model behaves differently</strong></summary>

Increase `netlogo.commandTimeoutMs` for long-running models. Enable `netlogo.verboseOutput`, open **NetLogo: Show Output**, and compare the model with **NetLogo: Open in NetLogo**. If an already-running workspace appears to use stale Code changes, reload the VS Code window before executing again.

</details>

## Development

```bash
git clone https://github.com/AlejandroRomeroG/vscode-netlogo.git
cd vscode-netlogo
npm ci
npm run compile
npm test
npm run package:vsix
```

Useful scripts:

| Script | Purpose |
| --- | --- |
| `npm run watch` | Compile TypeScript continuously |
| `npm run package:list` | Inspect the files included in the VSIX |
| `npm run test:e2e` | Run the VS Code Electron smoke test |

The test suite covers model parsing/serialization, Interface widgets, language services, runtime lifecycle, plots, monitors, 2D/3D data, and generated webview behavior. When a local NetLogo installation is available, it also exercises real sample models through the Java bridge. Set `NETLOGO_HOME` to select a specific installation for integration tests.

## Compatibility and known limitations

- NetLogo Desktop remains the reference implementation; headless execution and VS Code rendering may differ from the native GUI.
- The 3D viewer is experimental. Shapes, camera behavior, lighting, and some agent details are approximated; non-black patch rendering is currently capped at 5,000 patches.
- The 2D view is an exported image refreshed after execution, not a continuously shared native canvas.
- The **Add widget** menu does not create a new View; existing views can still be inspected, moved, resized, and edited.
- Output widgets are displayed but do not yet receive live `print`/`show` output.
- Input widgets are edited through **Layout → Properties** rather than directly in **Interact**.
- Language diagnostics and completions are static editor assistance, not a replacement for the NetLogo compiler; cross-file symbol analysis is not provided.
- Models using external extensions depend on a correctly resolved NetLogo installation, extension directory, and classpath.
- A persistent workspace can retain previously loaded Code; reload the VS Code window if execution appears stale after structural Code changes.
- Editing a plot definition invalidates its workspace; run **Setup** when prompted to reload it.
- Forever-loop FPS values are targets. Actual performance depends on the model, JVM, view exports, and rendering cost; very fast batches are bounded so **Stop** remains responsive.

## License

Created by **Alejandro Romero González** and distributed under the [Creative Commons Attribution 4.0 International License](LICENSE.md).

NetLogo Tools is an independent companion project and is not an official NetLogo distribution. Learn more about NetLogo at the [Center for Connected Learning and Computer-Based Modeling](https://ccl.northwestern.edu/netlogo/).
