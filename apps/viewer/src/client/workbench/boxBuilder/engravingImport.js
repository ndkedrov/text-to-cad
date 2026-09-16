// Box builder: reading an SVG drawing for the lid engraving. The browser does the
// hard part -- it knows paths, transforms and units -- and we walk the shapes it
// lays out, sampling each into a closed contour. What comes out is plain numbers
// (see engraving.js), so nothing here is needed again when the box is built.

import {
  MAX_CONTOUR_POINTS,
  MAX_ENGRAVING_CONTOURS,
  MAX_ENGRAVING_POINTS,
  contourArea,
  simplifyContour
} from "./engraving.js";

// A drawing may be laid out in real sizes; these are the units a file may say so in.
const MM_PER_UNIT = Object.freeze({ mm: 1, cm: 10, m: 1000, in: 25.4, pt: 25.4 / 72, pc: 25.4 / 6, px: 25.4 / 96 });
// How many points a stroked line keeps before it is given its width.
const STROKE_LINE_POINTS = 200;

// How finely a shape is walked before it is simplified, and what counts as the
// jump from the end of one subpath to the start of the next.
const SAMPLE_STEP = 0.15;
const MAX_SAMPLES = 3000;
const JUMP = 6;
// A drawing is read on the page's own thread, so the work is bounded on every
// side: a crowded file would otherwise walk millions of points and the browser
// would sit there, looking hung.
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_SHAPES = 300;
const MAX_TOTAL_SAMPLES = 40000;
const TIME_BUDGET_MS = 2500;
// How often the walk stops to let the page draw.
const SHAPES_PER_BREATH = 12;

const pause = () => new Promise((resolve) => { setTimeout(resolve, 0); });

export class EngravingError extends Error {}

function viewportSize(svg) {
  const box = svg.getAttribute("viewBox");
  if (box) {
    const numbers = box.trim().split(/[\s,]+/u).map(Number);
    if (numbers.length === 4 && numbers.every(Number.isFinite) && numbers[2] > 0 && numbers[3] > 0) {
      return { width: numbers[2], height: numbers[3], minX: numbers[0], minY: numbers[1] };
    }
  }
  const width = Number.parseFloat(svg.getAttribute("width"));
  const height = Number.parseFloat(svg.getAttribute("height"));
  if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
    return { width, height, minX: 0, minY: 0 };
  }
  throw new EngravingError("no-size");
}

// Every shape the drawing fills, walked into contours. A shape with several
// subpaths (a letter with a counter, a logo of separate marks) breaks where the
// pen jumps.
function sampleShape(shape, matrix, budget = MAX_SAMPLES) {
  const length = shape.getTotalLength();
  if (!Number.isFinite(length) || length <= 0) {
    return [];
  }
  const step = Math.max(length / Math.max(Math.min(MAX_SAMPLES, budget), 1), SAMPLE_STEP);
  const contours = [];
  let current = [];
  let previous = null;
  for (let walked = 0; walked <= length + step / 2; walked += step) {
    const point = shape.getPointAtLength(Math.min(walked, length));
    const placed = matrix ? point.matrixTransform(matrix) : point;
    const here = [placed.x, placed.y];
    if (previous && Math.hypot(here[0] - previous[0], here[1] - previous[1]) > JUMP * step) {
      if (current.length >= 3) {
        contours.push(current);
      }
      current = [];
    }
    current.push(here);
    previous = here;
  }
  if (current.length >= 3) {
    contours.push(current);
  }
  return contours;
}

function isFilled(element, window) {
  const fill = window.getComputedStyle(element).fill;
  return Boolean(fill) && fill !== "none" && !/^rgba\([^)]*,\s*0\)$/u.test(fill);
}

// A line drawn with a stroke and no fill is an engraved groove: this is how wide
// it is, in the drawing's own units.
function strokeWidth(element, window, matrix) {
  const style = window.getComputedStyle(element);
  if (!style.stroke || style.stroke === "none" || /^rgba\([^)]*,\s*0\)$/u.test(style.stroke)) {
    return 0;
  }
  const width = Number.parseFloat(style.strokeWidth);
  if (!Number.isFinite(width) || width <= 0) {
    return 0;
  }
  // The element's own scale, since the sampled points are in the drawing's space.
  const scale = matrix ? Math.sqrt(Math.abs(matrix.a * matrix.d - matrix.b * matrix.c)) || 1 : 1;
  return width * scale;
}

// How many millimetres one of the drawing's units is, when the file says.
function millimetresPerUnit(svg, viewport) {
  const declared = svg.getAttribute("width");
  const match = /^\s*(-?\d+\.?\d*)\s*([a-z%]*)\s*$/iu.exec(declared || "");
  if (!match) {
    return null;
  }
  const size = Number.parseFloat(match[1]);
  const unit = (match[2] || "px").toLowerCase();
  if (!Number.isFinite(size) || size <= 0 || !MM_PER_UNIT[unit]) {
    return null;
  }
  const millimetres = size * MM_PER_UNIT[unit];
  return millimetres / viewport.width;
}

// Reads an SVG file into { name, width, height, contours } for engraving.js.
// Needs a document to lay the drawing out in, so this runs in the browser only.
export async function drawingFromSvg(text, { name = "", documentRef = globalThis.document, windowRef = globalThis.window } = {}) {
  if (!documentRef || !windowRef) {
    throw new EngravingError("no-browser");
  }
  if (String(text).length > MAX_FILE_BYTES) {
    throw new EngravingError("too-complex");
  }
  const parsed = new windowRef.DOMParser().parseFromString(String(text), "image/svg+xml");
  if (parsed.querySelector("parsererror") || parsed.documentElement?.tagName?.toLowerCase() !== "svg") {
    throw new EngravingError("not-svg");
  }
  // Laid out off-screen: the geometry only exists once the browser has it.
  const stage = documentRef.createElement("div");
  stage.setAttribute("aria-hidden", "true");
  stage.style.cssText = "position:absolute;left:-10000px;top:0;width:0;height:0;overflow:hidden";
  const svg = documentRef.importNode(parsed.documentElement, true);
  stage.appendChild(svg);
  documentRef.body.appendChild(stage);
  try {
    const size = viewportSize(svg);
    const root = svg.getCTM ? svg.getCTM() : null;
    const tolerance = Math.hypot(size.width, size.height) / 1500;
    const shapes = [...svg.querySelectorAll("path,rect,circle,ellipse,polygon,polyline,line")].slice(0, MAX_SHAPES);
    const walked = [];
    const lines = [];
    const deadline = Date.now() + TIME_BUDGET_MS;
    let samples = MAX_TOTAL_SAMPLES;
    let shapeIndex = 0;
    for (const shape of shapes) {
      shapeIndex += 1;
      if (samples <= 0 || Date.now() > deadline) {
        break;
      }
      if (shapeIndex % SHAPES_PER_BREATH === 0) {
        // Let the page draw: this runs where the user is waiting.
        await pause();
      }
      if (typeof shape.getTotalLength !== "function") {
        continue;
      }
      const matrix = shape.getCTM ? shape.getCTM() : null;
      // Back out the viewport's own transform: the drawing keeps its own units.
      const local = matrix && root ? root.inverse().multiply(matrix) : matrix;
      const filled = isFilled(shape, windowRef);
      const groove = filled ? 0 : strokeWidth(shape, windowRef, local);
      if (!filled && !groove) {
        continue;
      }
      const contours = sampleShape(shape, local, samples);
      samples -= contours.reduce((total, points) => total + points.length, 0);
      if (filled) {
        walked.push(...contours);
        continue;
      }
      // A line drawn with a pen is kept as a line: it is cut as a groove as wide
      // as the pen was.
      // A groove is drawn as one shape along its line, so it can be followed
      // closely: a tenth of the pen's width keeps corners where they were.
      const fine = Math.min(tolerance, groove / 10);
      for (const line of contours) {
        const ends = Math.hypot(line[0][0] - line[line.length - 1][0], line[0][1] - line[line.length - 1][1]);
        const closed = ends <= groove;
        const kept = simplifyContour(closed ? line.slice(0, -1) : line, fine, STROKE_LINE_POINTS);
        if (kept.length >= 2) {
          lines.push({ width: groove, closed, points: kept });
        }
      }
    }
    if (!walked.length && !lines.length) {
      throw new EngravingError("nothing-filled");
    }
    const contours = walked
      .map((points) => simplifyContour(points, tolerance))
      .filter((points) => points.length >= 3 && Math.abs(contourArea(points)) > 1e-6)
      // The biggest marks first, so a crowded drawing keeps what matters most.
      .sort((left, right) => Math.abs(contourArea(right)) - Math.abs(contourArea(left)))
      .slice(0, MAX_ENGRAVING_CONTOURS);
    const kept = [];
    let budget = MAX_ENGRAVING_POINTS;
    for (const points of contours) {
      const fitted = points.length > budget ? simplifyContour(points, tolerance, Math.min(budget, MAX_CONTOUR_POINTS)) : points;
      if (fitted.length < 3 || budget - fitted.length < 0) {
        break;
      }
      budget -= fitted.length;
      kept.push(fitted.map(([x, y]) => [x - size.minX, y - size.minY]));
    }
    if (!kept.length && !lines.length) {
      throw new EngravingError("too-complex");
    }
    // The longest lines first, so a drawing over the budget keeps its main marks.
    lines.sort((left, right) => right.points.length - left.points.length);
    return {
      name: String(name).slice(0, 60),
      width: size.width,
      height: size.height,
      // Set when the file gives its real size, so the drawing can come in 1:1.
      millimetresPerUnit: millimetresPerUnit(svg, size),
      contours: kept,
      strokes: lines.map((line) => ({
        ...line,
        points: line.points.map(([x, y]) => [x - size.minX, y - size.minY])
      }))
    };
  } finally {
    stage.remove();
  }
}
