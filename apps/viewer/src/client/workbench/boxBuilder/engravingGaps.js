// Box builder: an engraving's narrow gaps closed. Two lines drawn almost touching
// leave a sliver of lid between them that no nozzle can print: it comes out as
// broken dots, in the lid's colour and in the inlay's around it. Closing every gap
// narrower than asked joins such lines into one, the way they already look.
//
// Takes manifold's wasm module, so it runs wherever manifold does, tests included.

import { MAX_CONTOUR_POINTS, MAX_ENGRAVING_CONTOURS, MAX_ENGRAVING_POINTS } from "./engraving.js";

// Corners of the closed gaps are rounded in this many steps.
const GAP_CORNER_STEPS = 24;
// Joined outlines can run long: thinned by this much in the drawing's units at
// first, and coarser, a step at a time, until they fit the engraving's limits.
const GAP_TOLERANCE = 0.002;
const GAP_TOLERANCE_STEPS = 8;

function toContours(section) {
  return section.toPolygons()
    .filter((polygon) => polygon.length >= 3)
    .map((polygon) => [...polygon].map(([x, y]) => [x, y]));
}

function fits(contours) {
  return contours.length <= MAX_ENGRAVING_CONTOURS
    && contours.every((points) => points.length <= MAX_CONTOUR_POINTS)
    && contours.reduce((sum, points) => sum + points.length, 0) <= MAX_ENGRAVING_POINTS;
}

// `contours` are shapes that run counter-clockwise with holes clockwise, as
// manifold hands them out, and may overlap one another; `gap` is in the same
// units. What comes back is one set of such contours, with every stretch of
// space narrower than `gap` filled in.
export function closeNarrowGaps(wasm, contours, gap) {
  if (!(gap > 0) || !contours.length) {
    return contours;
  }
  const { CrossSection } = wasm;
  // Overlapping shapes add up and a hole takes away only its own shape.
  const area = new CrossSection(contours, "Positive");
  const grown = area.offset(gap / 2, "Round", 2, GAP_CORNER_STEPS);
  const closed = grown.offset(-gap / 2, "Round", 2, GAP_CORNER_STEPS);
  let result = contours;
  try {
    for (let step = 0; step < GAP_TOLERANCE_STEPS; step += 1) {
      const thinned = closed.simplify(GAP_TOLERANCE * 2 ** step);
      result = toContours(thinned);
      thinned.delete?.();
      if (fits(result)) {
        break;
      }
    }
  } finally {
    for (const shape of [area, grown, closed]) {
      shape.delete?.();
    }
  }
  return result;
}
