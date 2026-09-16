// Box builder: an engraving cut into the top of the lid. A drawing arrives as
// closed contours in its own units (SVG's, Y pointing down); the box keeps those
// contours, where they sit on the lid and how deep they are cut, so both geometry
// engines build the same thing and no SVG has to be parsed again.
//
// The plan grammar holds the limits: a polygon takes at most 64 points and a plan
// 2000 of them, so contours are simplified when they come in.

export const ENGRAVING_MODES = Object.freeze(["cut", "inlay"]);
export const MAX_ENGRAVING_CONTOURS = 40;
export const MAX_CONTOUR_POINTS = 64;
export const MAX_ENGRAVING_POINTS = 1200;
// The smallest contour worth cutting, in the drawing's own units.
const MIN_CONTOUR_SPAN = 1e-6;

function finiteOr(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function round(value, digits = 3) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function numberIn(value, fallback, min, max) {
  return Math.min(Math.max(finiteOr(value, fallback), min), Math.max(min, max));
}

// How far a point lies from the line through `start` and `end`.
function lineDistance(point, start, end) {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const length = Math.hypot(dx, dy);
  if (length < 1e-12) {
    return Math.hypot(point[0] - start[0], point[1] - start[1]);
  }
  return Math.abs(dy * (point[0] - start[0]) - dx * (point[1] - start[1])) / length;
}

// Ramer-Douglas-Peucker: drop the points that say nothing about the shape.
function thin(points, tolerance) {
  if (points.length < 3) {
    return points;
  }
  let worst = 0;
  let index = 0;
  for (let step = 1; step < points.length - 1; step += 1) {
    const distance = lineDistance(points[step], points[0], points[points.length - 1]);
    if (distance > worst) {
      worst = distance;
      index = step;
    }
  }
  if (worst <= tolerance) {
    return [points[0], points[points.length - 1]];
  }
  return [
    ...thin(points.slice(0, index + 1), tolerance).slice(0, -1),
    ...thin(points.slice(index), tolerance)
  ];
}

// A closed contour with at most `limit` points: thinned harder until it fits.
export function simplifyContour(points, tolerance, limit = MAX_CONTOUR_POINTS) {
  let kept = thin(points, tolerance);
  let step = tolerance || 1e-3;
  while (kept.length > limit && step < 1e6) {
    step *= 1.6;
    kept = thin(points, step);
  }
  if (kept.length > limit) {
    // Evenly spaced, as a last resort.
    kept = Array.from({ length: limit }, (_, index) => points[Math.round((index * (points.length - 1)) / (limit - 1))]);
  }
  return kept.map(([x, y]) => [round(x), round(y)]);
}

export function contourArea(points) {
  let sum = 0;
  for (let index = 0; index < points.length; index += 1) {
    const [x1, y1] = points[index];
    const [x2, y2] = points[(index + 1) % points.length];
    sum += x1 * y2 - x2 * y1;
  }
  return sum / 2;
}

export function pointInContour([x, y], points) {
  let inside = false;
  for (let index = 0, previous = points.length - 1; index < points.length; previous = index, index += 1) {
    const [xi, yi] = points[index];
    const [xj, yj] = points[previous];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

// What a drawing becomes when it is first placed on a lid: contours kept as they
// are, sized in millimetres from `millimetresPerUnit`, centred on the lid.
export function engravingFromDrawing(drawing, { depth = 0.6, millimetresPerUnit = 1 } = {}) {
  const width = Math.max(finiteOr(drawing?.width, 0), MIN_CONTOUR_SPAN);
  const height = Math.max(finiteOr(drawing?.height, 0), MIN_CONTOUR_SPAN);
  return normalizeEngraving({
    name: drawing?.name || "",
    width,
    height,
    sizeX: round(width * millimetresPerUnit),
    sizeY: round(height * millimetresPerUnit),
    x: 0,
    y: 0,
    depth,
    contours: drawing?.contours || []
  });
}

// Whatever arrives comes back as an engraving both geometry engines accept, or
// null when there is nothing to cut.
export function normalizeEngraving(raw) {
  const source = raw && typeof raw === "object" ? raw : null;
  if (!source) {
    return null;
  }
  const width = Math.max(finiteOr(source.width, 0), MIN_CONTOUR_SPAN);
  const height = Math.max(finiteOr(source.height, 0), MIN_CONTOUR_SPAN);
  let budget = MAX_ENGRAVING_POINTS;
  const contours = [];
  for (const raw of Array.isArray(source.contours) ? source.contours : []) {
    if (contours.length >= MAX_ENGRAVING_CONTOURS || budget < 3) {
      break;
    }
    const points = (Array.isArray(raw) ? raw : [])
      .filter((point) => Array.isArray(point) && point.length >= 2 && Number.isFinite(Number(point[0])) && Number.isFinite(Number(point[1])))
      .slice(0, MAX_CONTOUR_POINTS)
      .map(([x, y]) => [round(Number(x)), round(Number(y))]);
    if (points.length < 3) {
      continue;
    }
    const kept = points.slice(0, Math.min(points.length, budget));
    if (kept.length < 3) {
      break;
    }
    budget -= kept.length;
    contours.push(kept);
  }
  if (!contours.length) {
    return null;
  }
  return {
    name: typeof source.name === "string" ? source.name.slice(0, 60) : "",
    // "cut" leaves the drawing hollow; "inlay" also makes the piece that fills it,
    // as a part of its own, to print in another colour.
    mode: ENGRAVING_MODES.includes(source.mode) ? source.mode : "cut",
    width: round(width),
    height: round(height),
    // Where the drawing's middle sits on the lid, and how big it is there.
    x: numberIn(source.x, 0, -2000, 2000),
    y: numberIn(source.y, 0, -2000, 2000),
    sizeX: numberIn(source.sizeX, round(width), 0.5, 2000),
    sizeY: numberIn(source.sizeY, round(height), 0.5, 2000),
    // How deep it is cut from the top of the lid; deeper than the lid goes through.
    depth: numberIn(source.depth, 0.6, 0.1, 100),
    contours
  };
}

// The contours in box coordinates: scaled to the size asked for, centred on
// (x, y) and turned the right way up (a drawing counts Y downwards).
export function engravingContours(engraving) {
  if (!engraving) {
    return [];
  }
  const scaleX = engraving.sizeX / engraving.width;
  const scaleY = engraving.sizeY / engraving.height;
  return engraving.contours.map((points) => {
    const placed = points.map(([x, y]) => [
      round(engraving.x + (x - engraving.width / 2) * scaleX, 4),
      round(engraving.y - (y - engraving.height / 2) * scaleY, 4)
    ]);
    // Turning the drawing the right way up turns its contours the wrong way round,
    // and a prism built on a contour that runs backwards grows downwards: one
    // engine then loses the lid, the other cuts nothing.
    return contourArea(placed) < 0 ? placed.reverse() : placed;
  });
}

// The contours sorted into islands: each filled outline with the contours that
// sit inside it and are therefore holes in it, the way a letter "O" is drawn.
export function engravingIslands(engraving) {
  const contours = engravingContours(engraving);
  const nesting = contours.map((points, index) => contours.reduce((depth, other, otherIndex) => (
    otherIndex !== index && pointInContour(points[0], other) ? depth + 1 : depth
  ), 0));
  const islands = [];
  contours.forEach((points, index) => {
    if (nesting[index] % 2 === 0) {
      islands.push({ outline: points, holes: [] });
    }
  });
  contours.forEach((points, index) => {
    if (nesting[index] % 2 === 0) {
      return;
    }
    // A hole belongs to the smallest outline that holds it.
    let host = null;
    for (const island of islands) {
      if (pointInContour(points[0], island.outline)) {
        const area = Math.abs(contourArea(island.outline));
        if (!host || area < Math.abs(contourArea(host.outline))) {
          host = island;
        }
      }
    }
    (host || islands[0])?.holes.push(points);
  });
  return islands;
}

export function engravingPointCount(engraving) {
  return (engraving?.contours || []).reduce((total, points) => total + points.length, 0);
}
