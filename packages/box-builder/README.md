# box-builder

The parametric printable-box builder: a box spec, the CSG plan built from it,
circuit boards with their stand-offs, ribs and clamps, lid screws, lid engraving
and inlays, and the React panel and 3D viewport that edit all of it.

The panel does its own geometry in the browser (manifold, WebAssembly). What it
leaves to its host is where boxes are kept and how their print files are built,
through an adapter. The CAD Viewer in this repository hosts it with
`apps/viewer/src/client/workbench/serverBoxAdapter.js` (the `/__cad/boxes`
routes, built by cadgen's build123d kernel); another host brings its own.

## Layout

- `src/core/` — pure JavaScript, no DOM: `boxSpec.js` (the spec, normalizing,
  warnings), `boxPlan.js` (the CSG plan both geometry engines build),
  `boxBoards.js`, `boxEdits.js`, `engraving.js`, `engravingGaps.js`,
  `floorSheet.js`, `i18n.js` (English and Ukrainian), `manifoldPlan.js`,
  `boxNames.js`. Tests sit beside the modules.
- `src/browser/` — needs a browser: `manifoldRuntime.js` (loads the wasm through
  a Vite `?url` import) and `engravingImport.js` (reads an SVG with the DOM).
- `src/ui/` — React: `BoxBuilderSheet.js` (the panel), `BoxBuilderViewport.js`,
  `useBoxBuilder.js` (state, undo, the local draft), `useBoardPresets.js`,
  `useBoxLanguage.js`, `adapter.js` (the host contract).
- `src/ui/kit/` — the sheet primitives the panel is drawn with (`FileSheet`,
  its tabbed surface and the shadcn/Radix controls under it), copied from the
  CAD Viewer so the panel stands on its own.
- `src/presets/boards.json` — the board templates. The viewer server keeps the
  same list in `packages/cadgen/src/cadgen/viewer/board_presets.json`; a test
  fails when the two differ, so change both.

## Hosting the panel

```js
import BoxBuilderSheet from "box-builder/ui/BoxBuilderSheet.js";
import BoxBuilderViewport from "box-builder/ui/BoxBuilderViewport.js";
import { useBoxBuilder } from "box-builder/ui/useBoxBuilder.js";

const builder = useBoxBuilder();
<BoxBuilderViewport builder={builder} />
<BoxBuilderSheet open builder={builder} adapter={myAdapter} />
```

The adapter's members are documented in `src/ui/adapter.js`: `listBoxes`,
`loadBox`, `boxStatus`, `saveBox`, `fileUrl`, `boardPresets` and, optionally,
`onOutputsChanged`.

A host also provides:

- a Vite build (the modules are `.js` files with JSX, and the wasm is imported
  with `?url`), resolving `react`, `react-dom`, `three`, `manifold-3d`,
  `radix-ui`, `lucide-react`, `class-variance-authority`, `clsx` and
  `tailwind-merge` to one copy each (see `peerDependencies`);
- Tailwind CSS 4 scanning `src/`, with the shadcn theme variables the kit's
  classes use (`--background`, `--card`, `--muted-foreground`, …).

## Checks

```bash
npm --prefix packages/box-builder install
npm --prefix packages/box-builder test
```

The CAD Viewer's own suite and build (`npm --prefix apps/viewer run test`,
`npm --prefix apps/viewer run build`) cover the panel as hosted there.

## License

MIT, like the rest of this repository (see `LICENSE`). The kit under `src/ui/kit/`
comes from the CAD Viewer, Copyright (c) 2026 Thompson Labs LLC.
