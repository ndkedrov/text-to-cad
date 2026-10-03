// The box builder's adapter for this viewer: boxes are kept and built by the
// viewer server's /__cad/boxes routes (the contract is box-builder's ui/adapter.js).

import { refreshCadCatalog } from "@/workbench/cadManifestStore.js";

const POST_GUARD_HEADERS = Object.freeze({ "x-cadgen-viewer": "1" });

async function readJson(response) {
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (!response.ok) {
    const error = new Error(payload?.error || `HTTP ${response.status}`);
    error.status = response.status;
    error.code = payload?.code || "";
    throw error;
  }
  return payload;
}

function boxUrl(route, name) {
  return `/__cad/boxes${route}?name=${encodeURIComponent(name)}`;
}

export const serverBoxAdapter = Object.freeze({
  async listBoxes() {
    return readJson(await fetch("/__cad/boxes", { cache: "no-store" }));
  },
  async loadBox(name) {
    return readJson(await fetch(boxUrl("/spec", name), { cache: "no-store" }));
  },
  async boxStatus(name) {
    return readJson(await fetch(boxUrl("/status", name), { cache: "no-store" }));
  },
  async saveBox(name, { spec, plan }) {
    return readJson(await fetch(boxUrl("/save", name), {
      method: "POST",
      headers: { ...POST_GUARD_HEADERS, "content-type": "application/json" },
      body: JSON.stringify({ spec, plan })
    }));
  },
  fileUrl(name, part, format) {
    return `${boxUrl("/file", name)}&part=${encodeURIComponent(part)}&format=${encodeURIComponent(format)}`;
  },
  async exportFile(name, part, format) {
    let blob;
    if (format === "3mf" || format === "stl") {
      const [{ spec }, { loadManifold }, { buildBoxPrintMesh }, { packageMeshToFormat }] = await Promise.all([
        serverBoxAdapter.loadBox(name),
        import("box-builder/browser/manifoldRuntime.js"),
        import("box-builder/core/printMesh.js"),
        import("cadgen-js/lib/export/packageMeshExport.js"),
      ]);
      // Export the saved spec, which also produced the downloadable STEP.
      const mesh = buildBoxPrintMesh(await loadManifold(), spec, part);
      const result = packageMeshToFormat(mesh, format, { name: `${name}_${part}`, assembly: true });
      blob = new Blob([result.body], { type: result.contentType });
    } else {
      const response = await fetch(serverBoxAdapter.fileUrl(name, part, format));
      if (!response.ok) await readJson(response);
      blob = await response.blob();
    }
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${name}_${part}.${format}`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    return true;
  },
  // The circuit-board templates "Add board" offers: { boards: [...], categories }.
  async boardPresets() {
    return readJson(await fetch("/__cad/boxes/presets", { cache: "no-store" }));
  },
  onOutputsChanged() {
    refreshCadCatalog();
  }
});
