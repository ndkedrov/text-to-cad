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
  `boxNames.js`, `adapterMembers.js`. Tests sit beside the modules.
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
`onOutputsChanged`. A host where download links, `window.confirm` or a print
window do not work (an app's WebView) adds the optional `exportFile`, `confirm`
and `printFloorSheet`, and says with `capabilities` which of the folder path,
the open-STEP button and the quota to show; left out, each behaves as on a web
page (`src/core/adapterMembers.js`).

A host that writes print files itself evaluates the plan with
`manifoldFromPlan(wasm, plan, { quality: "export" })` (`src/core/manifoldPlan.js`):
circles and rounded corners are cut finer than the preview's default
`"preview"`.

A host also provides:

- a Vite build (the modules are `.js` files with JSX, and the wasm is imported
  with `?url`), resolving `react`, `react-dom`, `three`, `manifold-3d`,
  `radix-ui`, `lucide-react`, `class-variance-authority`, `clsx` and
  `tailwind-merge` to one copy each (see `peerDependencies`);
- Tailwind CSS 4 scanning `src/`, with the shadcn theme variables the kit's
  classes use (`--background`, `--card`, `--muted-foreground`, …).

## SVG lid artwork

SVG imports retain solid fill/stroke colours, explicit subpaths, fill rules and
local clip paths. Definition-only paths do not become visible artwork. Paint
order is resolved into disjoint colour regions, so overlapping colours produce
separate inlay bodies instead of cancelling one another as even-odd holes.
Each source colour has its own control in the collapsed colour group section;
recolouring does not merge those controls. New imports fit within 90% of both
lid dimensions, keeping their proportions even when the SVG declares a physical
size. Saved drawings retain their existing placement and size.

When an import exceeds the geometry budget, regions smaller than 0.2 mm at the
initial fitted size may be absorbed into the neighbouring colour with the
longest shared boundary. The smallest regions go first and merging stops as
soon as the drawing fits. Every transferred area stays filled: the original
silhouette and intentional holes remain unchanged, and each colour keeps its
largest component. Separate islands and larger details are retained even if
the import must still be rejected. The panel reports how many regions changed
colour. Saved/reloaded drawings and later redraws use the merged partition.

The spec stores `colorGroups` with source/current colours and contours. Older
specs without groups still load. Inlay plan nodes carry a validated `color`;
the viewport and the web STEP/3MF export preserve separate material bodies.
STL geometry has no colour information. Native shells require their own release
before this shared panel change reaches installed apps.

The web adapter writes STL/3MF from the saved spec with `buildBoxPrintMesh`
(`src/core/printMesh.js`), using the preview's Manifold kernel at export quality.
STEP still comes from the server's exact solids. Indexed vertices are retained
in 3MF: coincident vertices on touching islands must not be welded together.
The lid and its colour regions form one assembly, so arranging the model in a
slicer keeps the artwork in place. Whole-part material references and slicer
metadata assign a distinct filament to every distinct colour.

Bambu Studio 2.8.2 reads the standard 3MF palette through its colour import
dialog; confirm the mappings there. Existing matching filaments may be reused,
so the final numbers need not start at 1. No printer/process preset is embedded.
This Bambu version may report that the file has no valid configuration and load
geometry only before showing the colour dialog. This does not discard the
geometry or colours. Check that its prime tower fits on the selected plate.

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

Hosted quota responses also expose `storageUsedBytes`, `storageLimitBytes` and
`outputRetentionSeconds`; the file panel shows storage usage and the retention
notice when the host supplies them. The hosted viewer retains saved specs and
scripts while the admin-only, POST-guarded `/__cad/admin/box-cleanup` expires
known generated STEP/STL/3MF files and sidecars after 24 hours. A `dryRun=1`
query reports eligible files without deleting them. The deployment schedules
this call; the local viewer has no cleanup route and its files do not expire.

The hosted viewer builds STEP on the server and advertises `clientExportFormats`
for STL/3MF. Its adapter offers these downloads when that part's STEP is ready;
print meshes come from the saved spec through Manifold. The server does not
repeat the browser print exports. Local viewers keep their server mesh exports.
A running or failed part's files are unavailable; a failed rebuild removes old
and partial outputs so downloads cannot mix different generations.
