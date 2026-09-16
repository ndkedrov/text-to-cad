// Box builder: reading an SVG drawing for the lid engraving. The browser does the
// hard part -- it knows paths, transforms and units -- and we walk the shapes it
// lays out, sampling each into a closed contour. What comes out is plain numbers
// (see engraving.js), so nothing here is needed again when the box is built.

import { MAX_CONTOUR_POINTS, MAX_ENGRAVING_CONTOURS, MAX_ENGRAVING_POINTS, contourArea, simplifyContour } from "./engraving.js";

// How finely a shape is walked before it is simplified, and what counts as the
// jump from the end of one subpath to the start of the next.
const SAMPLE_STEP = 0.4;
const MAX_SAMPLES = 800;
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
    const shapes = [...svg.querySelectorAll("path,rect,circle,ellipse,polygon,polyline,line")].slice(0, MAX_SHAPES);
    const walked = [];
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
      if (typeof shape.getTotalLength !== "function" || !isFilled(shape, windowRef)) {
        continue;
      }
      const matrix = shape.getCTM ? shape.getCTM() : null;
      // Back out the viewport's own transform: the drawing keeps its own units.
      const local = matrix && root ? root.inverse().multiply(matrix) : matrix;
      const contours = sampleShape(shape, local, samples);
      samples -= contours.reduce((total, points) => total + points.length, 0);
      walked.push(...contours);
    }
    if (!walked.length) {
      throw new EngravingError("nothing-filled");
    }
    const tolerance = Math.hypot(size.width, size.height) / 600;
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
    if (!kept.length) {
      throw new EngravingError("too-complex");
    }
    return { name: String(name).slice(0, 60), width: size.width, height: size.height, contours: kept };
  } finally {
    stage.remove();
  }
}
