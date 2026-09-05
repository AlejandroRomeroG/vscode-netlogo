# Info rendering and validation

The Info tab uses a locally bundled Markdown parser and the extension's theme tokens. Section bands recall NetLogo Desktop while keeping VS Code's font, background, link colors, and high-contrast support. The reading column is limited to 82ch; tables and literal code have their own horizontal scroll areas.

## Content coverage

| Example | Cases checked |
| --- | --- |
| Spread of Disease | Long prose, references, bare URLs, links containing inline code, code blocks, copyright image, hidden comments |
| Info Tab Example | Heading hierarchy, two-space nested lists, emphasis, reference links, quotations, local images, subscript/superscript |
| Weak Acid | Scientific expressions and legacy HTML tables with omitted closing cell tags |
| Simple Kinetics 1 | Scientific symbols, quotations, and literal diagrams |
| Prisoner's Dilemma Two Person Iterated | Long documentation and ASCII payoff tables |
| Follower 3D and Sierpinski Simple 3D | 3D model documentation and lists |
| CRISPR Bacterium LevelSpace | Additional headings and extended documentation |
| Synthetic narrow-panel fixture | Long headings/URLs, unbroken numbers, wide tables/code, nested lists, image fallback, heading anchors |

On the local NetLogo 6.4 library, all **585** model Info sections rendered without parser exceptions or active HTML elements. This is a corpus smoke test, not visual inspection of every page or a guarantee of identical native output.

The browser layout check covers nine fixtures, three themes, widths of 320/640/1100 CSS pixels, and zoom factors of 0.8/1/1.25: **243 combinations**. It checks document/element containment and heading ID uniqueness. Visual review supplements geometry checks; it is needed for font balance, spacing, table readability, and code highlighting.

## Reproduce

```bash
npm ci
npm run compile
node --test test/infoMarkdown.test.js test/infoResources.test.js
node scripts/checkInfoModels.js
node scripts/previewInfo.js
```

The preview prints a loopback URL. Open it, choose models/themes, and use **Check all sizes**. Set `NETLOGO_HOME` when the installation is not `/Applications/NetLogo 6.4.0`. Native-model tests are skipped if that installation is absent; synthetic fixtures still work. These checks do not edit the model library or run simulations.

`npm run compile` also copies the pinned parser distribution and its MIT license to `resources/vendor/markdown-it`. Both are packaged into the VSIX; no CDN is used. Node 18 remains supported by the chosen dependency versions.

## Source, interaction, and resource boundaries

- The preview does not rewrite the model's Info text. Markdown tokens carry original line ranges and inline character offsets, including entities, escapes, Unicode, and CRLF. Clicking ordinary text enters the source editor; legacy HTML blocks use their block start as a fallback.
- Text selection stays available for copying. Links and image-loading controls stop the edit gesture; internal heading links scroll instead of leaving the model.
- Parser HTML is parsed in an inert template and rebuilt using allowed document elements. Scripts, embedded pages, event attributes, arbitrary styles, and HTML comments are not mounted. Table alignment and spans are retained.
- External navigation accepts HTTP, HTTPS, and mailto addresses. Local resources are resolved against the model directory, including symlink checks; absolute paths and paths escaping that directory are rejected.
- Local raster images are validated by signature and limited to 8 MiB. External images load only after **Load image**, without a referrer, and may still fail when a host is unavailable. This consent is scoped to the current preview session.

## Deliberate limits

This is not a pixel-identical Swing renderer. It supports common Markdown plus selected legacy document HTML, not arbitrary HTML/CSS, embedded applications, SVG, or LaTeX/MathJax equations. Native subscript/superscript HTML remains supported. Source quotes are not converted into typographic quotation marks. Custom HTML anchors and resources outside the model folder are not resolved. Very large images or remote images can remain as alternative text. NetLogo simulation, plot rendering, and playback are unchanged by this work.
