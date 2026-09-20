import assert from "node:assert/strict";
import test from "node:test";

import { PHONE_NAV_HEIGHT, PHONE_TOP_BAR_HEIGHT } from "./phoneMetrics.js";
import { PHONE_SHEET_DETENTS, phoneSheetHeights, settleDetent } from "./phoneSheetMath.js";

// A phone with a cutout and a home indicator, and one without.
const iPhone = { height: 852, safeArea: { top: 59, right: 0, bottom: 34, left: 0 } };
const flat = { height: 800, safeArea: { top: 0, right: 0, bottom: 0, left: 0 } };

test("the scene always keeps more of the screen than the sheet at its middle stop", () => {
  for (const viewport of [iPhone, flat, { height: 667, safeArea: {} }]) {
    const { half } = phoneSheetHeights(viewport);
    assert.ok(half < viewport.height / 2, `${viewport.height}: ${half}`);
  }
});

test("the full sheet stops clear of the status bar, the title bar and the navigation bar", () => {
  const { full } = phoneSheetHeights(iPhone);
  const chrome = iPhone.safeArea.top + PHONE_TOP_BAR_HEIGHT + PHONE_NAV_HEIGHT + iPhone.safeArea.bottom;
  assert.equal(full, iPhone.height - chrome);
  assert.ok(full + chrome <= iPhone.height);
});

test("a screen too short to hold the chrome still gets a usable sheet", () => {
  // A split view, or a height read before the window settled: the arithmetic
  // must not hand back a zero or negative sheet that can never be dragged open.
  const { full, half } = phoneSheetHeights({ height: 120, safeArea: { top: 59, bottom: 34 } });
  assert.ok(full > 0, String(full));
  assert.ok(half > 0, String(half));
  assert.ok(half <= full);
});

test("the stops are ordered and closed means nothing is showing", () => {
  const heights = phoneSheetHeights(iPhone);
  assert.deepEqual(PHONE_SHEET_DETENTS, ["closed", "half", "full"]);
  assert.equal(heights.closed, 0);
  assert.ok(heights.closed < heights.half);
  assert.ok(heights.half < heights.full);
});

test("a slow drag settles at the nearest stop", () => {
  const heights = phoneSheetHeights(iPhone);
  const slow = 0.1;
  assert.equal(settleDetent(heights, 4, slow), "closed");
  assert.equal(settleDetent(heights, heights.half + 6, slow), "half");
  assert.equal(settleDetent(heights, heights.full - 4, slow), "full");
});

test("a flick carries the sheet one stop further than where the finger stopped", () => {
  const heights = phoneSheetHeights(iPhone);
  // Positive velocity is downwards, which shrinks the sheet.
  assert.equal(settleDetent(heights, heights.half, 2), "closed");
  assert.equal(settleDetent(heights, heights.half, -2), "full");
  // And never past the ends.
  assert.equal(settleDetent(heights, heights.full, -2), "full");
  assert.equal(settleDetent(heights, heights.closed, 2), "closed");
});
