<div align="center">
  <img src="resources/logo-hd.png" alt="NetLogo Tools logo" width="112">
  <h1>NetLogo Tools for VS Code</h1>
  <p><strong>Open, edit, run, and visualize NetLogo models without leaving Visual Studio Code.</strong></p>
  <p>
    <img alt="Version 0.1.38" src="https://img.shields.io/badge/version-0.1.38-5A3E85?style=flat-square">
    <img alt="Status: Alpha" src="https://img.shields.io/badge/status-alpha-F59E0B?style=flat-square">
    <img alt="VS Code 1.88 or newer" src="https://img.shields.io/badge/VS_Code-%E2%89%A51.88-007ACC?style=flat-square&amp;logo=visualstudiocode&amp;logoColor=white">
    <img alt="Tested with NetLogo 6.4" src="https://img.shields.io/badge/NetLogo-6.4_tested-5A3E85?style=flat-square">
    <a href="LICENSE.md"><img alt="License: CC BY 4.0" src="https://img.shields.io/badge/license-CC_BY_4.0-2E8B57?style=flat-square"></a>
  </p>
  <p>
    <a href="#highlights">Highlights</a> ·
    <a href="#quick-start">Quick start</a> ·
    <a href="#2d-viewer-and-long-runs">2D viewer</a> ·
    <a href="#3d-viewer">3D viewer</a> ·
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
| **Readable model documentation** | Theme-aware Info with NetLogo-style section bands, nested lists, tables, highlighted code, scientific notation markup, links, and opt-in external images. |
| **Interface designer** | Separate **Interact** and **Layout** modes, widget selection, keyboard movement, resizing, property editing, and add/delete workflows. |
| **Headless runtime** | Persistent per-model sessions for `setup`, one-step commands, forever loops, and arbitrary commands with history. |
| **Plots and monitors** | Multi-pen plots with native colors and modes, a comprehensive plot/pen editor, and NetLogo-style monitor labels and number formatting. |
| **2D and 3D visualization** | Native 2D view exports plus an interactive Three.js viewer with uncapped visible patch export, native RGBA colors, sorted transparency, and reusable rendering buffers. |
| **Language intelligence** | Syntax highlighting, completions, diagnostics, quick fixes, symbols, hover, definitions, references, highlights, and rename support. |
| **Desktop integration** | Installation detection, runtime configuration, diagnostics, and **Open in NetLogo** with save-before-launch and permission-free reuse of registered native sessions on macOS. |

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
6. Use **Open in NetLogo** to open the saved model in NetLogo Desktop. The native application runs independently; this does not transfer the current simulation state.

## Editing and visualization

### Interface workflow

- **Info** renders model documentation as Markdown and can switch back to its editable source; clicking preview text opens the corresponding source position, while text selection remains available for copying.
- **Interact** runs Interface buttons and updates sliders, switches, and choosers without enabling layout editing.
- **Layout** enables selection, drag/resize interactions, keyboard movement, bounds editing, and widget-specific properties.
- Returning to **Interact** clears the selection, shows **Switch to Layout to edit widget properties.** in Properties, and hides **Delete widget**. **No selection** is reserved for Layout without a selected widget.
- Supported widgets include views, buttons, sliders, switches, choosers, monitors, plots, inputs, text boxes, and output areas.
- Slider boxes reserve at least 35px of height so their native thumb and numeric value stay inside the border, including in compact imported interfaces.
- Choosers reserve separate title/dropdown rows and a 44px minimum height; existing 45px selectors keep their size and position without clipping the title.
- Chooser options retain text, numeric, boolean, and nested-list values across import, editing, saving, and execution. The **Choices** editor uses NetLogo literal syntax (quote text; separate values by spaces or lines) and validates it before saving. Malformed existing options remain editable and are reported without silently changing the model. Native XML `choice` elements and the `current` selection are supported.
- Switches use one vertically centered checkbox/text row with an associated clickable label, without a duplicate heading.
- `Cmd+S` on macOS or `Ctrl+S` on Windows/Linux saves back to the real model document.

### Info documentation

- NetLogo-inspired heading bands use the active VS Code theme, with a bounded reading column, generous line spacing, and light/dark/high-contrast styling.
- Supports headings, nested ordered/unordered lists (including NetLogo's two-space list indentation), emphasis, quotations, reference links, bare web addresses, tables, and subscript/superscript markup for scientific notation.
- Preserves NetLogo line breaks and literal ASCII diagrams. Unlabelled or `netlogo` code blocks receive NetLogo highlighting; `text` fences remain literal.
- Wide tables and code blocks scroll within the document without stretching the whole preview. Long links and headings wrap; table numbers stay intact.
- Web/email links open through VS Code; heading links scroll within Info. Links and image buttons do not enter edit mode.
- Local PNG, JPEG, GIF, and WebP images can use relative or `file:relative` paths inside the model's folder, up to 8 MiB per image. External images offer **Load image** before contacting their host and retain an alternative-text fallback if unavailable.
- Rendering leaves the saved Markdown unchanged. The parser is bundled locally; model HTML is rebuilt from an allowlist, without scripts, event handlers, arbitrary styles, or embedded pages.

See [Info rendering and validation](docs/info-rendering.md) for checked model examples, reproducible tests, and compatibility limits.

### Plots and monitors

- Reads complete native binary plot snapshots, including multiple pens, unequal series lengths, exact RGB colors, color changes, pen-up points, runtime ranges, and legends. CSV parsing remains available for compatibility checks.
- Renders NetLogo **Line**, **Bar**, and **Point** pen modes with native palette colors and intervals.
- Draws plot series in front of the axes, so a line at zero remains visible.
- Fits plots to each widget's actual dimensions without enlarging text or clipping the lower axis. Legends have a separate scrollable area; long names retain their full tooltip instead of stretching their glyphs.
- Formats axis labels to the domain's precision, retaining small acceleration values and using scientific notation for extreme scales. Crowded widgets reduce tick-label density; `NIL` axis titles remain absent.
- Edits plot title, axes, ranges, auto-scaling, legend visibility, plot setup/update commands, and every pen's name, color, mode, interval, legend status, and setup/update commands.
- Offers all 154 default NetLogo 6.4 color swatches.
- Displays monitor titles correctly and formats numeric output with precision-aware rounding, grouping separators, trimmed decimal zeroes, and scientific notation when appropriate.

### Runtime and playback

- Keeps a persistent headless workspace per model and runtime configuration.
- Saves and synchronizes stored Interface control values before execution.
- Refreshes ticks, monitors, plots, and views after each command.
- Sends editor status messages to **Output → NetLogo**, prefixed with the model name. The toolbar stays clear, and repeated Forever status messages are not logged for every tick. **NetLogo: Show Output** opens the channel without taking focus from the editor.
- Maps the speed slider to NetLogo's tick-based speed scale, including its central normal-speed range and nonlinear slow/fast response. Normal speed uses the model's configured view frame rate, with 30 FPS as the fallback.
- Uses bounded command batches at high speeds to keep **Stop** responsive. The displayed FPS is a target, not a measurement; actual pacing is not guaranteed to match NetLogo Desktop frame for frame.
- Keeps the tick counter vertically centered and the **Forever / Stop** button at fixed dimensions and alignment; only its label and color change when running.
- Displays 2D models from NetLogo's own exported PNG view.

### 2D viewer and long runs

- Keeps NetLogo's native 2D rendering, turtle shapes, colors, and transparency; the extension displays its PNG without recoloring it.
- Sends 2D pointer position, left-button presses/releases, and entry/exit to the model's `mouse-inside?`, `mouse-down?`, `mouse-xcor`, and `mouse-ycor` reporters in **Interact**. Models such as **Paths** can place/remove buildings, and mouse examples can draw or drag turtles. Run the model's mouse-handling button first; clicking does not execute `go` automatically.
- Fits the visible 2D frame to the image's aspect ratio within the saved widget bounds, removing empty side/top/bottom strips without stretching or cropping the world. Clicks stay aligned in resized and zoomed views.
- Switching to Layout, leaving Interface, or losing focus releases the pointer. The coordinate footer is removed from both 2D and 3D views without changing saved world or widget bounds.
- Decodes each 2D PNG off-screen and replaces the visible image only when it is ready, preventing black flashes between updates. One active decode and one latest pending request keep presentation work bounded without changing model execution or plot history.
- Reuses the 2D view container across updates and Layout changes; monitors and plots refresh without rebuilding controls or Properties on every frame. A failed image decode is reported while the previous good frame remains visible.
- Reads plot histories directly through the native plot API instead of converting the full history to CSV and back each frame. Every point remains available, including after pen resets, histogram replacement, and changes to temporary pens.
- Builds each continuous SVG line segment once, avoiding the repeated parsing of growing path prefixes that slowed long-running models. Native pen visibility and legend settings are retained.

The [2D performance and color checks](docs/2d-rendering.md) include **Wolf Sheep Simple 5** at 100, 5,000, and 10,000 ticks. They separate simulation, image export, plot transfer, and browser rendering costs. Full plot histories still grow with the run; the viewer does not discard old points to maintain a fixed memory or FPS budget. Scaling the native image to a smaller widget can blend edge pixels even though the source PNG colors are unchanged.

### 3D viewer

The simulation runs in NetLogo's native headless workspace. The extension reads that state and renders a separate Three.js view; it does not reimplement the model's rules in JavaScript.

- **Navigation and inspection:** orbit, zoom, pan, top/front/side views, fullscreen, light/dark backgrounds, and basic agent inspection. Reset camera restores the native observer position.
- **Complete visible patch export:** binary snapshots replace repeated text reporters and the former 5,000-patch sampling cap. Patch-only worlds such as **Percolation 3D** render without requiring turtles.
- **Native agent data:** transfers turtles, links, patches, labels, RGBA colors, hidden flags, and turtle heading/pitch/roll. Numeric black and RGB/RGBA patch colors retain their different native visibility behavior.
- **Large scenes and drawing trails:** compact binary trail data, reusable GPU instance buffers, packed patch records, and reuse of unchanged patch/trail geometry reduce repeated allocation and rebuilding. Internal faces between opaque patches are omitted.
- **Transparency:** batches translucent meshes with per-agent RGBA colors and sorts them farthest-first by camera distance, including while orbiting. Mixed transparent lines and labels use individual-object ordering so they can interleave with meshes.
- **Depth stability:** world-aware camera clipping and a small opaque-patch depth bias reduce coplanar flicker without moving agents or changing model coordinates.

See [3D rendering and validation](docs/3d-rendering.md) for the binary format, native reference implementations, reproducible checks, and measured performance comparisons. These are component benchmarks, not a promise of a particular end-to-end FPS. Custom shapes, lighting, and intersecting transparent surfaces can still differ from NetLogo Desktop.

### Native desktop integration

- **Open in NetLogo** saves pending model edits before launching; cancelling or failing the save prevents opening an outdated copy.
- On macOS, repeated clicks **activate the session previously launched for that file**. A local VS Code registry stores the canonical file path, application, process ID, and process start time; it survives window reloads and drops closed or replaced processes. This does not read window titles, inspect the screen, or require Screen Recording or Accessibility permission.
- When no unregistered native sessions are present, another model starts a **separate native instance** in the selected 2D or 3D application, with the model supplied at startup. This preserves other open models and avoids the 3D canvas freeze observed when replacing a model through a macOS file-open event. Launch Services returns the exact new process, so registration does not guess from a before/after list.
- Sessions opened manually or before this registry was installed are **not assigned a model by guesswork**. The button offers **Go to NetLogo** (with a session picker when needed), without launching another copy or requesting additional permissions.
- Concurrent requests for the same file are combined, and registry updates for different files are serialized. The editor button shows a busy state; activation and launch results go to **Output → NetLogo**. Failures are not silently retried. Windows and Linux retain their platform file associations.

Native and VS Code simulations are independent. Activating an existing native session does not reload its model, reset its simulation, or discard native edits. **The registry records the file used at launch, not the current native document:** if you use **File → Open**, **New**, or **Save As** inside NetLogo, that session may now contain a different model. This is session reuse, not universal detection of every open model. First launch still includes JVM and model initialization; a successful launch notification means the process started, not that loading is complete. Close unused native instances to release their memory.

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

<details>
<summary><strong>NetLogo Desktop is slow to open or the button offers Go to NetLogo</strong></summary>

Allow the native JVM and model to finish loading. **Go to NetLogo** means an existing session was not launched with this version's registry, so its current model is unknown; it is not a missing screen permission. Use that action to visit the existing session. To register a fresh launch, first close the unregistered native sessions when you no longer need them, then use **Open in NetLogo** again. The extension never closes them for you. If you changed files inside a registered native session, repeated clicks still return to that original session. Check **NetLogo: Show Output** for launch errors, and verify the installation through **NetLogo: Configure NetLogo** if needed.

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
| `node scripts/previewToolbar.js` | Serve a localhost geometry-check page for tick alignment and the Forever/Stop transition; open the printed URL and select **Check geometry** |
| `node scripts/previewPlotLayout.js` | Check the actual plot CSS and drawing functions at Traffic widget sizes, narrow/wide/tall sizes, multiple zoom levels, and with many pens |
| `node scripts/previewSliderLayout.js` | Check slider thumb/value containment, checkbox/text centering, and chooser title/dropdown containment at compact and tall sizes, multiple zoom levels, and in Interact/Layout modes |
| `node scripts/previewInfo.js` | Preview real model documentation with production styles and check narrow/wide layouts, themes, and zoom levels |
| `node scripts/checkInfoModels.js` | Read and render every model's Info in the local library, checking parser errors and active HTML without running simulations |

The test suite covers model parsing/serialization, Interface widgets, language services, runtime lifecycle, plots, monitors, generated webview behavior, and native launch/save/error handling. The 3D checks cover binary decoding, native colors and visibility, transparency ordering, exposed patch faces, inspection, and GPU resource reuse/disposal. When a local NetLogo installation is available, integration tests also exercise real sample models through the Java bridge, check complete patch/agent counts, and verify that taking a snapshot does not consume the model's random-number sequence. Set `NETLOGO_HOME` to select a specific installation for integration tests.

For reproducible 3D export benchmarks and a local visual check, see [3D rendering and validation](docs/3d-rendering.md).
For native 2D/plot benchmarks and a browser comparison of long plot histories, see [2D performance and color checks](docs/2d-rendering.md).

## Compatibility and known limitations

- NetLogo Desktop remains the reference implementation; headless execution and VS Code rendering may differ from the native GUI.
- The 3D viewer is experimental. Custom shapes, some camera behavior, lighting, and overlapping transparent surfaces can differ from the native renderer. Transparency uses native-style agent-level sorting, not order-independent rendering; translucent drawing trails have separate ordering limitations.
- The 2D view is an exported image refreshed after execution, not a continuously shared native canvas.
- The **Add widget** menu does not create a new View; existing views can still be inspected, moved, resized, and edited.
- Output widgets are displayed but do not yet receive live `print`/`show` output.
- Input widgets are edited through **Layout → Properties** rather than directly in **Interact**.
- Language diagnostics and completions are static editor assistance, not a replacement for the NetLogo compiler; cross-file symbol analysis is not provided.
- Models using external extensions depend on a correctly resolved NetLogo installation, extension directory, and classpath.
- A persistent workspace can retain previously loaded Code; reload the VS Code window if execution appears stale after structural Code changes.
- Editing a plot definition invalidates its workspace; run **Setup** when prompted to reload it.
- Forever-loop FPS values are targets. The slider follows NetLogo's tick-based scale, but does not reproduce every adaptive or continuous-update policy of the desktop application. Actual performance depends on the model, JVM, view exports, and rendering cost; very fast batches are bounded so **Stop** remains responsive.

## License

Created by **Alejandro Romero González** and distributed under the [Creative Commons Attribution 4.0 International License](LICENSE.md).

NetLogo Tools is an independent companion project and is not an official NetLogo distribution. Learn more about NetLogo at the [Center for Connected Learning and Computer-Based Modeling](https://ccl.northwestern.edu/netlogo/).
