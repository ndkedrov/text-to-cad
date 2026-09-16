// Box builder: one manifold, loaded once and shared. The preview evaluates plans
// with it, and the engraving import uses its 2D side to turn a drawn line into
// the shape the pen covers.

import manifoldWasmUrl from "manifold-3d/manifold.wasm?url";

let manifoldPromise = null;

export function loadManifold() {
  if (!manifoldPromise) {
    manifoldPromise = import("manifold-3d")
      .then(async ({ default: Module }) => {
        const wasm = await Module({ locateFile: () => manifoldWasmUrl });
        wasm.setup();
        return wasm;
      })
      .catch((error) => {
        manifoldPromise = null;
        throw error;
      });
  }
  return manifoldPromise;
}
