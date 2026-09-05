# 2D performance and color checks

NetLogo executes model rules and renders the 2D world. The extension displays the native PNG and reconstructs plot widgets from native plot data. A slow view update can therefore come from simulation, image export, plot transfer, or the browser; it does not necessarily indicate a slow agent renderer.

## Long-running models

Two history-dependent costs were reproduced with Wolf Sheep Simple 5:

1. The SVG renderer assigned the complete growing `d` attribute again for every point. A single 5,000-point line submitted 194,431,395 characters across 4,999 assignments, although its final path contained only 78,084 characters. Each continuous color/pen-down segment is now assembled and submitted once. Coordinates, ordering, color changes, and pen-up gaps are unchanged; no downsampling is applied.
2. Each frame exported all plots as native CSV, encoded that text in base64, and parsed it back into objects. The runtime now reads complete binary snapshots directly from the native plot API, avoiding the wide CSV table, numeric text formatting, and base64 transport. CSV export remains available for comparison and regression tests.

The mounted 2D image is also reused between frames. Unchanged image sources are not reassigned, and plots and monitors refresh without replacing controls or rebuilding Properties. Initial setup, changes to view widgets, failed exports, and active layout dragging retain the full-render fallback. The existing 3D update path is preserved.

### Native plot snapshots

`EXPORT_PLOT_BINARY` exports the named plot without changing the selected plot/pen, consuming the model RNG, or running model code. The runner reads and deletes the temporary file in a `finally` block. Snapshots are complete, not incremental: resets, deleted temporary pens, and histogram replacements cannot leave stale historical points behind.

The `NLP1` version 1 format is big endian:

- Header: magic and version (`int32`), plot name, X/Y minimum and maximum (`float64`), auto-plot and legend flags, current pen name, and pen count (`int32`).
- Pen: name, pen-down flag, mode (`int32`), interval (`float64`), native ARGB (`int32`), current X (`float64`), hidden/in-legend flags, and point count (`int32`).
- Point: X/Y (`float64`), native ARGB (`int32`), and pen-down flag: **21 bytes**.
- Strings: UTF-8 bytes prefixed by their byte length (`int32`). Boolean flags occupy one byte.

The decoder checks lengths, counts, flags, finite coordinates, ranges, modes, UTF-8, and trailing data. Binary pen colors are explicitly marked as ARGB; they are not guessed to be palette numbers when their integer value happens to fall in `0..140`. Plot colors use the native RGB channels, including the native plot painter's behavior of ignoring their alpha channel. This is separate from the 2D world, whose native PNG already contains alpha compositing.

## Color fidelity

The extension does not apply a new palette, gamma, saturation, or tint to the 2D PNG. The native-color integration test opens an independent headless Wolf Sheep Simple 5 workspace with seed 24680 and hides turtles to isolate patches:

- All **1,225 patch-center pixels** match NetLogo's native color API.
- All **207,025 pixels** in the 455 × 455 PNG survive encoding, decoding, and the extension bridge unchanged.
- A separate scene with RGB patches and turtles at alpha 0, 64, 128, and 255 matches the native rendered image pixel for pixel.

These checks validate the source image and bridge, not the final monitor/display color pipeline. The browser scales the image to fit the widget; interpolation can mix edge colors at non-native sizes. Comparing screenshots fairly also requires the same model state, seed, view size, and display scale. No arbitrary recoloring is applied to compensate for those differences.

## Plot sizing and status output

Traffic Basic Adaptive Individuals exposed an independent layout problem: the 415 × 200 Car speeds widget contained a roughly 298px-high SVG and 356px of total content. The intrinsic 160 × 120 SVG ratio enlarged its CSS grid track, while the widget clipped the excess. Its tick text was scaled by approximately 2.48. The 330 × 200 Acceleration widget had the same problem at a different scale.

Plots now reserve a fixed 22px title and a shrinkable body, with an absolutely positioned SVG that does not contribute intrinsic grid size. Coordinates follow the widget's current dimensions, including during Layout resizing. SVG text uses CSS-pixel coordinates without a viewBox transform, avoiding size-dependent glyph scaling and fractional-zoom border-rounding effects. The duplicate footer is removed; axis titles live alongside their axes. Legends occupy a separate, scrollable column, retaining every pen and the complete names in tooltips. Small widgets reduce tick-label density and omit axis titles if they cannot fit; data and ranges are unchanged.

Axis formatting derives precision from the domain rather than imposing two decimals. For example, the ticks for 0..0.0046 are **0, 0.0023, 0.0046**, not **0, 0, 0**. `NIL` axis titles remain absent. A browser check runs the generated production CSS/functions at seven fixture sizes, three UI font sizes and three zoom levels: **63 checks**, including viewport containment, text scaling, tick-label overlap and scrollable legends. Run `node scripts/previewPlotLayout.js` after compilation and select **Check all sizes and zoom levels**. Fixtures are deterministic synthetic data, not another simulation.

The former status box next to Command is replaced by messages in the shared **Output → NetLogo** channel. Each message includes its model name. Duplicate transitions are suppressed in the webview, including agent-context Forever commands whose code differs from their button label. Logging does not automatically reveal or focus Output; **NetLogo: Show Output** opens it when needed. Runtime failure/configuration banners and their recovery actions remain available.

Slider widgets have a 35px display minimum, including existing 33px native widgets. A 16px range-control row, zero native input margins, and an explicit 14px value line keep the thumb and digits inside the border. Newly added and resized sliders use the same minimum. This display correction does not rewrite saved model positions or slider values; Traffic's 35px vertical spacing is preserved. Switches use a single associated checkbox/text label, centered within the widget, without the preceding duplicate heading or asymmetric checkbox margins. `node scripts/previewSliderLayout.js` checks six slider and four switch sizes/values across three UI fonts, three zoom levels, and both Interact/Layout modes: **180 checks**, with no containment or centering failures.

In Interact, Properties displays **Switch to Layout to edit widget properties.** rather than an unexplained empty selection. **No selection** remains the Layout placeholder; selecting a widget in that mode opens its editable properties.

## Reproduce

```bash
npm run compile
node --test test/plotSnapshot.test.js test/plotSnapshot.integration.test.js test/view2D.integration.test.js test/view2DRuntime.test.js test/plotRenderingPerformance.test.js
node scripts/benchmark2D.js
node scripts/previewPlotPerformance.js
```

Set `NETLOGO_HOME` for a non-default NetLogo installation. The native benchmark uses the original Wolf Sheep Simple 5 model, saved slider defaults, and seed 42. It verifies the exact tick and original model hash, compares every plot coordinate/color/pen-down value and the metadata, and removes its temporary directory. No native GUI or additional VS Code instance is opened.

The browser script prints a localhost URL. Open it and run the comparison. It compares the preceding renderer in Git with the working source, verifies identical SVG output, and alternates baseline/updated measurements. See its command-line usage for selecting a baseline revision; keep the baseline fixed when reproducing a comparison after committing changes. Close the temporary tab and stop the server afterward.

### Local comparison (2026-09-05)

NetLogo 6.4 on the development Mac; five warm-ups and ten measured samples, with CSV/binary order alternated at each frozen model state:

| Plot export through parsed data, median | Tick 100 | Tick 5,000 | Tick 10,000 |
| --- | ---: | ---: | ---: |
| Previous CSV path | 5.92 ms | 37.77 ms | 72.91 ms |
| Native binary path | 0.77 ms | 3.26 ms | 5.55 ms |

Each entry times the entire export-to-parsed-data interval directly; it is not a sum of component medians. The native PNG export remained approximately 13–16 ms. At tick 10,000 all 30,000 plot points were retained. Binary data occupied 630,200 bytes, compared with 870,968 bytes of CSV before base64. The subsequent JSON representation is still full-history and can be larger because native ARGB integers and additional metadata replace shorter palette numbers.

A separate real-browser check in Edge used three synthetic pens of 5,000 points each, two warm-ups, and five alternating measurements. Median SVG DOM update plus layout fell from **718.6 ms to 3.9 ms**, with identical final SVG hashes. A mixed fixture also checks line/bar/point modes, colors, and pen-up gaps. This isolates the SVG path change; it excludes native simulation, exports, image decoding, and VS Code IPC. Frame callbacks used by the check are not a measurement of GPU completion or application FPS.

The packaged build was also installed into the existing VS Code window and tested with `random-seed 42 setup repeat 10000 [ go ]`. The 2D world and all three plot series displayed at tick 10,000. Forever continued updating them, and Stop left the model at tick 10,215. This is an installed-build functional check, not a controlled end-to-end FPS benchmark.

Full snapshots, JSON transfer, and drawing complete histories still have linear cost in the total number of points. These improvements remove the quadratic SVG cost and the CSV conversion overhead; they do not establish a fixed memory ceiling or guarantee constant end-to-end FPS for arbitrarily long runs. Timings from the native and browser checks are not additive.
