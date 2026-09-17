// Box builder: the grooves of a lid engraving drawn with lines. A line drawn with a
// stroke is cut as what a pen of its width covers; manifold's 2D side does the
// geometry, so this takes the loaded wasm and runs anywhere manifold does.

// Round ends and joints take this many steps per full turn, and the result is
// thinned to this much, in the drawing's own units. Both are fine enough that a
// small circle keeps its roundness instead of coming out as a decagon.
export const GROOVE_CORNER_STEPS = 24;
export const GROOVE_TOLERANCE = 0.002;

// An open line as the pieces a round pen leaves: a band along every segment and a
// disc at every point, all running counter-clockwise, to be read NonZero so their
// overlaps (and the loops a tight bend makes) merge.
function penPieces(points, width) {
  const half = width / 2;
  const pieces = [];
  for (let index = 1; index < points.length; index += 1) {
    const [x0, y0] = points[index - 1];
    const [x1, y1] = points[index];
    const length = Math.hypot(x1 - x0, y1 - y0);
    if (length <= 1e-9) {
      continue;
    }
    const nx = (-(y1 - y0) / length) * half;
    const ny = ((x1 - x0) / length) * half;
    pieces.push([[x0 + nx, y0 + ny], [x0 - nx, y0 - ny], [x1 - nx, y1 - ny], [x1 + nx, y1 + ny]]);
  }
  for (const [x, y] of points) {
    const disc = [];
    for (let step = 0; step < GROOVE_CORNER_STEPS; step += 1) {
      const angle = (2 * Math.PI * step) / GROOVE_CORNER_STEPS;
      disc.push([x + half * Math.cos(angle), y + half * Math.sin(angle)]);
    }
    pieces.push(disc);
  }
  return pieces;
}

// lines: [{ points: [[x, y], ...], width, closed }] -> the grooves as closed
// contours. A closed line is its ring offset outwards minus inwards, which keeps
// the hole it encloses; an open one is the pen's pieces merged. Offsetting an open
// line as a polygon would not do: closed by its chord it covers no area (a
// straight line) or the whole region under a curve.
export function grooveContours(wasm, lines) {
  const { CrossSection } = wasm;
  const contours = [];
  for (const line of lines) {
    const made = [];
    let groove;
    if (line.closed) {
      const ring = new CrossSection([line.points], "NonZero");
      const outer = ring.offset(line.width / 2, "Round", 2, GROOVE_CORNER_STEPS);
      const inner = ring.offset(-line.width / 2, "Round", 2, GROOVE_CORNER_STEPS);
      groove = outer.subtract(inner);
      made.push(ring, outer, inner);
    } else {
      groove = new CrossSection(penPieces(line.points, line.width), "NonZero");
    }
    const thinned = groove.simplify(GROOVE_TOLERANCE);
    made.push(groove, thinned);
    for (const polygon of thinned.toPolygons()) {
      if (polygon.length >= 3) {
        contours.push([...polygon].map(([x, y]) => [x, y]));
      }
    }
    for (const shape of new Set(made)) {
      shape.delete();
    }
  }
  return contours;
}
