// Box builder: the adapter's optional members, and what the panel does when a
// host leaves them out. A web page gets the browser's own confirm, print window
// and download links; a host where those do not work (an app's WebView) brings
// its own. No React and no DOM of its own: the window is passed in.

import { printFloorSheet } from "./floorSheet.js";

// What the file tab shows. `capabilities` on the adapter decides; a field it
// leaves out, or no `capabilities` at all, falls back to the `hosted` prop: a
// hosted viewer has no boxes/ folder to point at and no STEP to open.
//   folderPath      the boxes/<name> row
//   copyFolderPath  the button copying the folder the files were written to,
//                   when they carry a path; only a host saying folderPath: false
//                   hides it
//   openStep        the button opening the STEP file in the viewer
//   quota           today's limits, when the host reports them
export function adapterCapabilities(adapter, { hosted = false } = {}) {
  const capabilities = adapter?.capabilities || {};
  const pick = (field, fallback) => (typeof capabilities[field] === "boolean" ? capabilities[field] : fallback);
  return {
    folderPath: pick("folderPath", !hosted),
    copyFolderPath: pick("folderPath", true),
    openStep: pick("openStep", !hosted),
    quota: pick("quota", true)
  };
}

// Asks before throwing away unsaved changes. Resolves true to go ahead; a host
// whose question failed has not said yes.
export async function confirmWithAdapter(adapter, message, host = globalThis) {
  if (typeof adapter?.confirm === "function") {
    try {
      return (await adapter.confirm(message)) === true;
    } catch {
      return false;
    }
  }
  return Boolean(host.confirm(message));
}

// Prints the floor sheet. Resolves false when it could not be shown, which the
// panel reports as blocked.
export async function printFloorWithAdapter(adapter, svg, title, host = globalThis) {
  if (typeof adapter?.printFloorSheet === "function") {
    try {
      return (await adapter.printFloorSheet(svg, title)) === true;
    } catch {
      return false;
    }
  }
  return printFloorSheet(svg, title, host);
}

// How one built file is handed over: through the host's exportFile when it has
// one, otherwise as a link the browser downloads.
export function fileAction(adapter, name, part, format) {
  if (typeof adapter?.exportFile === "function") {
    return { kind: "export", run: () => adapter.exportFile(name, part, format) };
  }
  return { kind: "link", href: adapter.fileUrl(name, part, format) };
}
