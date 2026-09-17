import assert from "node:assert/strict";
import test from "node:test";

import Module from "manifold-3d";

import { contourArea } from "./engraving.js";
import { closeNarrowGaps } from "./engravingGaps.js";

const wasm = await Module();
wasm.setup();

const square = (x, y, size) => [[x, y], [x + size, y], [x + size, y + size], [x, y + size]];
const area = (contours) => contours.reduce((sum, points) => sum + contourArea(points), 0);

test("two marks closer than the gap join into one; farther apart they stay apart", () => {
  // Two 2 mm squares 0.4 apart.
  const marks = [square(0, 0, 2), square(2.4, 0, 2)];
  assert.equal(closeNarrowGaps(wasm, marks, 0), marks, "no gap asked for leaves the drawing alone");
  const joined = closeNarrowGaps(wasm, marks, 0.6);
  assert.equal(joined.length, 1);
  assert.ok(Math.abs(area(joined) - (8 + 0.8)) < 0.1, "the sliver between them is filled, its ends rounded");
  const apart = closeNarrowGaps(wasm, marks, 0.3);
  assert.equal(apart.length, 2);
  assert.ok(Math.abs(area(apart) - 8) < 0.1);
});

test("a hole narrower than the gap fills, a wider one stays, and overlaps add up", () => {
  // A 6 mm square with a 4 mm hole: a ring 1 mm wide, and a 0.5 mm slit hole.
  const ring = [square(0, 0, 6), [...square(1, 1, 4)].reverse()];
  const kept = closeNarrowGaps(wasm, ring, 0.6);
  assert.equal(kept.length, 2, "the 4 mm hole is wider than the gap");
  assert.ok(Math.abs(area(kept) - 20) < 0.1, "the hole's corners rounded off");
  const slit = [square(0, 0, 3), [[1, 0.5], [1, 2.5], [1.5, 2.5], [1.5, 0.5]]];
  const filled = closeNarrowGaps(wasm, slit, 0.6);
  assert.equal(filled.length, 1);
  assert.ok(Math.abs(area(filled) - 9) < 0.1);
  // Overlapping marks count once, and a hole takes away only from its own shape.
  const overlapping = closeNarrowGaps(wasm, [square(0, 0, 2), square(1, 0, 2)], 0.1);
  assert.ok(Math.abs(area(overlapping) - 6) < 0.1);
});
