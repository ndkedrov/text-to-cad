// The phone chrome's numbers: the touch sizes it hands the panel, and the
// heights of the bars it puts around it. Data only, no components — the sheet
// arithmetic imports this and is tested without a DOM.
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
  "--fs-overlay-text": "0.8125rem",
  "--fs-overlay-radius": "1.25rem"
});

// The chrome's own measurements, shared by the shell, the sheet and the host
// that has to leave room for them.
// The dock floats: its own height, plus the gap it keeps from the bottom edge
// (and from the sheet above it). PHONE_NAV_HEIGHT is what the two together
// reserve, which is what the sheet arithmetic has to leave alone.
export const PHONE_DOCK_HEIGHT = 62;
export const PHONE_DOCK_GAP = 10;
export const PHONE_NAV_HEIGHT = PHONE_DOCK_HEIGHT + PHONE_DOCK_GAP * 2;
export const PHONE_TOP_BAR_HEIGHT = 52;
export const PHONE_SHEET_HEADER_HEIGHT = 52;
