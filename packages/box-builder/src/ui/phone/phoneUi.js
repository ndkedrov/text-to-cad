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
  const resolved = useMemo(
    () => (labels ? { ...PHONE_LABELS, ...labels } : PHONE_LABELS),
    [labels]
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

// Touch sizes. 44px is the smallest target both Apple and Google ask for, so
// controls are 44 and the rows that hold them never squeeze below it. Text
// starts at 13px: a label smaller than that is unreadable at arm's length, and
// the 11px the desktop inspector uses is what made the first phone build look
// like a shrunken desktop.
export const PHONE_UI_TOKENS = Object.freeze({
  "--fs-control-h": "2.75rem",
  "--fs-control-text": "0.9375rem",
  "--fs-label-text": "0.8125rem",
  "--fs-title-text": "0.9375rem",
  "--fs-status-text": "0.8125rem",
  "--fs-badge-text": "0.8125rem",
  "--fs-value-w": "7rem",
  "--fs-row-gap": "0.875rem",
  "--fs-row-px": "1rem",
  "--fs-icon": "1.125rem",
  "--fs-switch-w": "3.25rem",
  "--fs-switch-h": "2rem",
  "--fs-switch-thumb": "1.625rem",
  "--fs-switch-travel": "1.25rem",
  "--fs-switch-pad": "0.375rem",
  "--fs-radius": "0.75rem",
  "--fs-option-h": "2.75rem",
  // The strips floating over the scene are secondary to the panel: big enough
  // to hit, small enough that four of them do not own the screen.
  "--fs-overlay-h": "2.5rem",
  "--fs-overlay-text": "0.8125rem"
});

// The chrome's own measurements, shared by the shell, the sheet and the host
// that has to leave room for them.
export const PHONE_NAV_HEIGHT = 60;
export const PHONE_TOP_BAR_HEIGHT = 52;
export const PHONE_SHEET_HEADER_HEIGHT = 52;
