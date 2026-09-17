import { createContext, createElement, useContext } from "react";

// Box builder: where boxes are kept and built. The panel does the geometry
// itself; saving, opening, building the print files and the board templates are
// the host's. A host hands the panel an adapter with these members:
//
//   listBoxes()                   -> { boxes: [{ name, updatedAt }], quota? }
//   loadBox(name)                 -> { name, spec, build, outputs, quota?, changed? }
//                                    changed: true opens the box as unsaved (the host
//                                    had to adjust the document while reading it)
//   boxStatus(name)               -> { name, build, outputs, quota? }
//   saveBox(name, { spec, plan }) -> the same as boxStatus, once the build is queued
//   fileUrl(name, part, format)   -> a link that downloads one built file
//                                    (not needed with exportFile)
//   boardPresets()                -> { boards, categories }
//
// and, optionally, these. Without one the panel does what a web page does, which
// is what the CAD Viewer relies on; a host where that does not work (an app's
// WebView: no download links, confirm dialogs or print windows) brings its own:
//
//   onOutputsChanged()              -> a build finished, its files are new
//   exportFile(name, part, format)  -> Promise<boolean>: saves or shares one built
//                                      file instead of a download link; false is
//                                      the user cancelling
//   confirm(message)                -> Promise<boolean>: instead of window.confirm,
//                                      before unsaved changes are dropped
//   printFloorSheet(svg, title)     -> Promise<boolean>: prints the floor sheet (an
//                                      SVG in millimetres) instead of a print
//                                      window; false shows it as blocked
//   capabilities                    -> { folderPath, openStep, quota }, booleans:
//                                      show the boxes/ folder (and the copy-path
//                                      button), the open-STEP button, the quota.
//                                      Over the panel's `hosted` prop; a field
//                                      left out keeps what `hosted` gives
//
// `build` is { state: "queued" | "building" | "done" | "error", parts } or null;
// `outputs` lists { part, format, file, size, modifiedAt, path? }. A rejected call
// throws an Error that may carry `status` and `code` (see describeBoxError).
// How the optional members fall back: core/adapterMembers.js.

const BoxAdapterContext = createContext(null);

export function BoxAdapterProvider({ adapter, children }) {
  return createElement(BoxAdapterContext.Provider, { value: adapter }, children);
}

export function useBoxAdapter() {
  const adapter = useContext(BoxAdapterContext);
  if (!adapter) {
    throw new Error("the box builder needs an adapter: render it inside BoxAdapterProvider");
  }
  return adapter;
}

// The adapter a component was handed, or else the one around it.
export function useBoxAdapterOr(adapter) {
  const around = useContext(BoxAdapterContext);
  const chosen = adapter || around;
  if (!chosen) {
    throw new Error("the box builder needs an adapter");
  }
  return chosen;
}
