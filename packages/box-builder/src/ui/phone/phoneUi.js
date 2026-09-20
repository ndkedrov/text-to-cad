import { createContext, useContext, useMemo } from "react";

// Phone mode for the panel.
//
// The panel is one set of components that has to read as a desktop inspector
// beside a scene and as a touch app on a phone. The two differ in three ways,
// and each is handled in its own place so neither layout can drift:
//
//  1. SIZE. Every control size, text size and gap in the sheet comes from a CSS
//     variable with the desktop number as its inline fallback, so the desktop
//     stylesheet stays exactly as it was and nothing has to be edited at a call
//     site. The phone shell sets the variables below on its root; everything
//     under it grows to touch size at once, including controls written later.
//  2. SHAPE. A few primitives change arrangement, not just size (a section
//     becomes a card, a number becomes a stepper). Those ask `usePhoneUi()`.
//  3. CHROME. The tab strip, the side sheet and the drag-to-split panes are
//     desktop furniture. On a phone the shell replaces them wholesale with a
//     bottom navigation bar, a draggable bottom sheet and modals.
const PhoneUiContext = createContext(false);

// The few words the phone chrome says on its own. The panel kit is written
// without a language of its own, so the host hands them in translated; the
// English here is the fallback for a host that has not.
const PHONE_LABELS = Object.freeze({
  close: "Close",
  search: "Search",
  empty: "Nothing found"
});

const PhoneLabelsContext = createContext(PHONE_LABELS);

export function PhoneUiProvider({ value = true, labels, children }) {
  // A nested provider (a modal wrapping its own subtree) must not throw away
  // the words the shell translated: without this the file modal's pickers
  // said "Search" and "Close" in English inside a Ukrainian app.
  const inherited = useContext(PhoneLabelsContext);
  const resolved = useMemo(
    () => (labels ? { ...inherited, ...labels } : inherited),
    [inherited, labels]
  );
  return (
    <PhoneUiContext.Provider value={value}>
      <PhoneLabelsContext.Provider value={resolved}>{children}</PhoneLabelsContext.Provider>
    </PhoneUiContext.Provider>
  );
}

export function usePhoneUi() {
  return useContext(PhoneUiContext);
}

export function usePhoneLabels() {
  return useContext(PhoneLabelsContext);
}

export {
  PHONE_UI_TOKENS,
  PHONE_NAV_HEIGHT,
  PHONE_TOP_BAR_HEIGHT,
  PHONE_SHEET_HEADER_HEIGHT
} from "./phoneMetrics.js";
