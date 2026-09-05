# 3D rendering and validation

NetLogo executes the simulation in its native headless workspace. The extension reads that workspace and renders a separate Three.js view; it does not reimplement model rules or update agents in JavaScript.

## State transfer

`EXPORT_VIEW_3D` takes one synchronous snapshot of bounds, observer position, turtles, links, and visible patches. Native iteration replaces multiple NetLogo reporters and string parsing. It neither shuffles agentsets nor consumes the simulation RNG. Drawing trails use the existing `NLD3` binary export.

Patches are collected in one pass into a reusable byte buffer, using NetLogo's cached numeric colors. RGB/RGBA lists are resolved separately so opaque RGB black and per-patch alpha retain their native meaning. The buffer is resized when the world grows and released down to the new size when the world shrinks substantially; the binary format is unchanged.

The `NLV3` version 1 format is big endian:

- Header: magic and version (`int32`), six bounds (`int32`), observer XYZ (`float64`), and turtle/link/patch counts (`int32`).
- Turtle records: ID, XYZ, heading, pitch, roll, size, native color, hidden flag, shape, label, label color, pen mode, and pen size.
- Link records: endpoint IDs, native color, thickness, directed/hidden flags, shape, label, and label color.
- Patch records: XYZ (`int32`), numeric NetLogo color (`float64`, NaN for RGB lists), and ARGB (`uint32`): 24 bytes per patch.
- Colors contain both the optional numeric value and native ARGB. Strings use an `int32` UTF-8 byte length, preserving separators, quotes, newlines, and non-ASCII labels.

The decoder checks record lengths and counts. Patch records remain packed through the VS Code message channel and are decoded on demand for inspection. Native patch alpha determines visibility, including NetLogo's transparent numeric black. There is no patch-count sampling limit. Temporary runtime exports are removed after each read, including failure paths.

## Rendering

- Opaque turtle batches use geometry as their key, with per-instance colors. Agent order stays stable when colors change. Hidden and zero-size turtles do not produce geometry.
- Mesh and line buffers persist across updates; capacity grows when required, unused batches are disposed, and bounding volumes are refreshed after movement.
- Opaque patch batches share geometry by exposed-face mask. A dense occupancy array accelerates voxel worlds, with a sparse-set fallback for very large, mostly empty worlds. Faces between two opaque patches are removed, and bounds are accumulated while filling instance transforms rather than scanning all transforms again.
- Transparent patch and turtle meshes share one RGBA `BatchedMesh`, regardless of color, opacity, or shape. Instances are sorted together, farthest first by squared Euclidean distance to the current camera, including during orbit. Alpha blending, back-face culling, and enabled depth writes follow NetLogo 6.4. Translucent interfaces retain all faces.
- Transparent lines or visible agent labels require an individual-object fallback so their draw order can interleave with transparent meshes. This prioritizes ordering fidelity over batching efficiency in mixed scenes. Picking resolves each batched instance back to its original agent; growth, removal, color changes, and mode switches reuse or dispose the appropriate GPU resources.
- A small depth bias on opaque patches gives coincident agents/trails precedence without changing model coordinates. Transparent meshes do not use that bias. Camera clipping follows the world bounds, and unchanged viewport dimensions do not resize the drawing buffer.
- Native observer XYZ is mapped to Three.js XYZ as XZY; Reset camera returns to that native pose after manual navigation. Lambert light intensities account for Three.js's irradiance-to-reflectance conversion.
- Identical packed patch/trail snapshots reuse their existing geometry. This does not skip simulation steps.

These changes address internal patch faces, unstable agent order, and limited depth precision. They reproduce the native agent-level transparency ordering, not order-independent transparency. Custom shapes, label appearance, lighting, equal-distance ties, intersecting geometry, and translucent drawing trails can still differ from NetLogo. The native renderer itself does not globally sort translucent trails with agents.

## Reproduce the checks

```bash
npm run compile
node --test test/threeRenderer.test.js test/view3D.test.js test/netlogoRuntime.integration.test.js
node scripts/benchmark3D.js
node scripts/benchmark3DRenderer.js /path/printed/by/the/benchmark
node scripts/preview3D.js /path/printed/by/the/benchmark
```

The benchmark uses Percolation 3D from NetLogo 6.4, seed 42, and tick 40. It alternates text and binary exports, discards five warm-ups, and reports medians over ten samples. The text baseline fixes the former `of`/list error and removes the former 5,000-patch cap so both paths export the same world. Reported times cover extraction and the bridge response, not simulation speed or end-to-end FPS. The snapshot directory is retained for inspection and the preview server listens only on localhost.

For a paired CPU update comparison, supply a previous compiled `out/netlogoEditor.js` as the second argument to `benchmark3DRenderer.js`. It alternates native tick-40/tick-83 snapshots, warms up both renderers, alternates execution order, and measures 40 updates per renderer in the same process. This excludes WebGL submission, bridge transport, simulation, and plots. `BENCHMARK_BRIDGE_SOURCE` selects a previous Java bridge for extraction comparisons; `PREVIEW_EDITOR_SOURCE` selects a previous compiled editor for the browser preview. Keep the baseline files before installing an updated VSIX.

Integration checks compare native patch counts at ticks 40 and 83, verify RGBA visibility and cached numeric colors, compare repeated snapshots byte for byte, and check that extraction leaves the next random draw unchanged. Tree Simple 3D verifies all 65,536 turtles and 599,989 drawing lines at tick 8. Renderer tests cover dense/sparse face culling, resource reuse/disposal, agent inspection, hidden agents, large instance counts, observer/depth mapping, transparent instance growth, and mixed-agent ordering.

The visual preview renders the actual generated webview functions with the bundled Three.js version. Its repeated-frame check compares pixel hashes for an unchanged scene; its timings exclude the pixel readback. The changing-frame check measures 60 updates after 10 warm-ups and reports observed frame cadence, which is constrained by the browser/display. The transparency check compares batched output pixel by pixel with individual-object rendering using native distance order and depth writes from three camera angles. It is not a screenshot comparison with NetLogo's native shapes or lighting. Use the same VS Code window for final interactive verification when requested.

### Local comparison (2026-09-05)

On the same development Mac, using NetLogo 6.4 Percolation 3D and the preceding installed 0.1.38 build as the baseline:

| Measurement | Previous build | Optimized build |
| --- | ---: | ---: |
| Native binary extraction, median of 10 samples | 6.42 ms | 2.49 ms |
| CPU patch update, paired median of 40 samples | 17.00 ms | 7.34 ms |
| CPU patch update, paired p95 | 26.95 ms | 7.89 ms |
| Browser update plus render submission, median of 60 samples | 17.2 ms | 13.9 ms |
| Observed browser cadence | 60.0 FPS | 60.2 FPS |

The tick-40 binary files were byte-identical (410,012 bytes), and both CPU paths generated the same 67,436/111,148 exposed faces for the two snapshots. The three transparency comparisons had zero differing color channels. Browser FPS did not materially increase because both paths reached the observed display cadence. These component measurements are not additive and do not establish end-to-end simulation FPS; actual speed depends on model execution, plot updates, transfer, viewport size, and machine load.

## Reference implementations

- [NetLogo 6.4 patch renderer](https://github.com/NetLogo/NetLogo/blob/6.4.0/netlogo-gui/src/main/gl/render/PatchRenderer3D.scala)
- [NetLogo 6.4 world renderer](https://github.com/NetLogo/NetLogo/blob/6.4.0/netlogo-gui/src/main/gl/render/WorldRenderer3D.scala)
- [NetLogo 6.4 lighting and depth setup](https://github.com/NetLogo/NetLogo/blob/6.4.0/netlogo-gui/src/main/gl/render/Renderer.java)
- [NetLogo 6.4 transparent-agent distance ordering](https://github.com/NetLogo/NetLogo/blob/6.4.0/netlogo-gui/src/main/gl/render/Euclidean.scala)
- [Three.js instance and geometry updates](https://threejs.org/manual/en/how-to-update-things.html)
