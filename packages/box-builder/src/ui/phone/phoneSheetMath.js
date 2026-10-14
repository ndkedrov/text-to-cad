import { PHONE_NAV_HEIGHT, PHONE_TOP_BAR_HEIGHT } from "./phoneMetrics.js";

// Where the sheet rests and where a drag settles. Kept apart from the
// components so it can be tested: this is the arithmetic that decides whether
// the model has any screen left, and it cannot be checked by looking at a
// screenshot of one phone.

export const PHONE_SHEET_DETENTS = Object.freeze(["closed", "half", "full"]);

// The fraction of the screen the sheet takes at its middle stop. Just under
// half, so the scene always keeps the larger share.
const HALF_FRACTION = 0.46;

// The sheet never grows past this, whatever the screen: a phone that reports a
// tiny height (a split view, a stale measurement) must not produce a negative
// or vanishing sheet.
const MINIMUM_FULL_HEIGHT = 220;

// A flick beats position: past this speed the sheet goes the way the finger
// threw it, even from the middle of the travel.
const FLICK_VELOCITY = 0.5;

// How tall the sheet stands at each detent, in pixels above the navigation bar.
export function phoneSheetHeights({ height, safeArea }) {
  const navHeight = PHONE_NAV_HEIGHT + (safeArea?.bottom || 0);
  const full = Math.max(
    height - (safeArea?.top || 0) - PHONE_TOP_BAR_HEIGHT - navHeight,
    MINIMUM_FULL_HEIGHT
  );
  return {
    closed: 0,
    half: Math.min(Math.round(height * HALF_FRACTION), full),
    full
  };
}

function closestDetent(heights, value) {
  return PHONE_SHEET_DETENTS.reduce(
    (best, name) => (Math.abs(heights[name] - value) < Math.abs(heights[best] - value) ? name : best),
    "half"
  );
}

// Where a drag ends up: the nearest stop, or the next one along when the finger
// was still moving fast enough to mean it.
export function settleDetent(heights, value, velocity) {
  const closest = closestDetent(heights, value);
  if (Math.abs(velocity) <= FLICK_VELOCITY) {
    return closest;
  }
  // A downward flick is a positive dy, which shrinks the sheet.
  const step = velocity > 0 ? -1 : 1;
  const index = PHONE_SHEET_DETENTS.indexOf(closest) + step;
  return PHONE_SHEET_DETENTS[Math.min(Math.max(index, 0), PHONE_SHEET_DETENTS.length - 1)];
}

// How far the sheet body has to scroll so the field being typed into sits in
// the strip the keyboard leaves uncovered. The keyboard lies over the sheet
// rather than pushing it up, so the browser counts a field under the keys as
// visible and will not scroll to it by itself. Positive scrolls the content
// up; zero means the field is already in view. A field taller than the strip
// shows its top, where its value is.
export const KEYBOARD_REVEAL_MARGIN = 8;

export function keyboardRevealScroll({ fieldTop, fieldBottom, visibleTop, visibleBottom, margin = KEYBOARD_REVEAL_MARGIN }) {
  const values = [fieldTop, fieldBottom, visibleTop, visibleBottom];
  if (!values.every(Number.isFinite) || visibleBottom <= visibleTop) {
    return 0;
  }
  const top = visibleTop + margin;
  const bottom = visibleBottom - margin;
  if (fieldTop < top || fieldBottom - fieldTop > bottom - top) {
    return Math.round(fieldTop - top);
  }
  if (fieldBottom > bottom) {
    return Math.round(fieldBottom - bottom);
  }
  return 0;
}
