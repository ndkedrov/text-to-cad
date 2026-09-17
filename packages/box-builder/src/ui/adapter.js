import { createContext, createElement, useContext } from "react";

// Box builder: where boxes are kept and built. The panel does the geometry
// itself; saving, opening, building the print files and the board templates are
// the host's. A host hands the panel an adapter with these members:
//
//   listBoxes()                   -> { boxes: [{ name, updatedAt }], quota? }
//   loadBox(name)                 -> { name, spec, build, outputs, quota? }
//   boxStatus(name)               -> { name, build, outputs, quota? }
//   saveBox(name, { spec, plan }) -> the same as boxStatus, once the build is queued
//   fileUrl(name, part, format)   -> a link that downloads one built file
//   boardPresets()                -> { boards, categories }
//   onOutputsChanged()            -> optional: a build finished, its files are new
//
// `build` is { state: "queued" | "building" | "done" | "error", parts } or null;
// `outputs` lists { part, format, file, size, modifiedAt, path? }. A rejected call
// throws an Error that may carry `status` and `code` (see describeBoxError).

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
