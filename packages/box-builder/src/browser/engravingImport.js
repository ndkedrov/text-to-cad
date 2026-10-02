// Box builder: reading an SVG drawing for the lid engraving. The browser does the
// hard part -- it knows paths, transforms and units -- and we walk the shapes it
// lays out, sampling each into a closed contour. What comes out is plain numbers
// (see engraving.js), so nothing here is needed again when the box is built.

import { SVGLoader } from "three/examples/jsm/loaders/SVGLoader.js";
import { composeColorGroups, unionColorContours } from "../core/engravingColors.js";
import {
  MAX_CONTOUR_POINTS,
  MAX_ENGRAVING_CONTOURS,
  MAX_ENGRAVING_POINTS,
  contourArea,
  simplifyContour
} from "../core/engraving.js";
import { closeNarrowGaps } from "../core/engravingGaps.js";
import { GROOVE_TOLERANCE, grooveContours } from "../core/engravingGrooves.js";
import { loadManifold } from "./manifoldRuntime.js";


// A drawing may be laid out in real sizes; these are the units a file may say so in.
const MM_PER_UNIT = Object.freeze({ mm: 1, cm: 10, m: 1000, in: 25.4, pt: 25.4 / 72, pc: 25.4 / 6, px: 25.4 / 96 });
// How many points a stroked line keeps before it is given its width.
const STROKE_LINE_POINTS = 200;

// How finely a shape is walked before it is simplified, and what counts as the
// jump from the end of one subpath to the start of the next.
const MAX_SAMPLES = 4000;
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
  // Parse subpaths explicitly: distance jumps cannot distinguish a pen lift
  // from a long edge, and can accidentally join separate coloured islands.
  const copy = shape.cloneNode(true);
  copy.removeAttribute("transform");
  const source = new XMLSerializer().serializeToString(copy);
  const paths = new SVGLoader().parse(`<svg xmlns="http://www.w3.org/2000/svg">${source}</svg>`).paths;
  const subpaths = paths.flatMap((path) => path.subPaths);
  const total = subpaths.reduce((sum, path) => sum + path.getLength(), 0);
  return subpaths.map((path) => path.curves.flatMap((curve, index) => {
    const count = curve.isLineCurve ? 1 : Math.max(4, Math.min(128,
      Math.floor(Math.min(MAX_SAMPLES, budget) * curve.getLength() / (total || 1))));
    const points = curve.getPoints(count);
    return (index ? points.slice(1) : points).map((point) => {
      const placed = matrix ? new DOMPoint(point.x, point.y).matrixTransform(matrix) : point;
      return [placed.x, placed.y];
    });
  }));
}

// Filled shapes tidied by the same hands: overlaps merged, holes told apart from
// shapes by which way each contour runs (SVG's even-odd rule decides what is a
// hole, and a walked outline says nothing about it by itself).
function filledContours(wasm, shapes, tolerance, rule = "EvenOdd") {
  const { CrossSection } = wasm;
  const area = new CrossSection(shapes, rule);
  const thinned = area.simplify(tolerance);
  const contours = thinned.toPolygons()
    .filter((polygon) => polygon.length >= 3)
    .map((polygon) => [...polygon].map(([x, y]) => [x, y]));
  area.delete?.();
  thinned.delete?.();
  return contours;
}

// The engraving's contours put together again from what it was made of: the
// filled shapes, and the lines drawn `lineWidth` wide (0 as drawn), with every gap
// narrower than `gapWidth` closed (0 leaves them). Both in the drawing's units.
export async function redrawnContours({ fills = [], strokes = [] }, { lineWidth = 0, gapWidth = 0 } = {}) {
  if (!fills.length && !strokes.length) {
    return [];
  }
  const wasm = await loadManifold();
  const grooves = strokes.length
    ? grooveContours(wasm, lineWidth > 0 ? strokes.map((line) => ({ ...line, width: lineWidth })) : strokes)
    : [];
  return closeNarrowGaps(wasm, [...fills, ...grooves], gapWidth);
}

// Clip paths use their own fill rule and are never paint layers themselves.
function clippedContours(wasm, contours, element, svg, root, tolerance, windowRef) {
  if (!contours.length) return [];
  let area = new wasm.CrossSection(contours, "Positive");
  try {
    for (let host = element; host && host !== svg.parentNode; host = host.parentElement) {
      const clip = windowRef.getComputedStyle(host).clipPath;
      if (!clip || clip === "none") continue;
      const id = /#([^"')]+)["']?\)/u.exec(clip)?.[1];
      const definition = [...svg.querySelectorAll("clipPath")].find((node) => node.id === id);
      if (!definition) throw new EngravingError("unsupported-clip");
      let placement = root.inverse().multiply(host.getCTM());
      if (definition.getAttribute("clipPathUnits") === "objectBoundingBox") {
        const box = host.getBBox();
        placement = placement.translate(box.x, box.y).scale(box.width, box.height);
      }
      const transform = definition.transform?.baseVal?.consolidate()?.matrix;
      if (transform) placement = placement.multiply(transform);
      let mask = null;
      try {
        for (const shape of definition.querySelectorAll("path,rect,circle,ellipse,polygon,polyline")) {
          let local = placement;
          const ancestors = [];
          for (let node = shape; node !== definition; node = node.parentElement) ancestors.unshift(node);
          for (const node of ancestors) {
            const matrix = node.transform?.baseVal?.consolidate()?.matrix;
            if (matrix) local = local.multiply(matrix);
          }
          const rings = sampleShape(shape, local).map((ring) => simplifyContour(ring, tolerance));
          const rule = windowRef.getComputedStyle(shape).clipRule === "evenodd" ? "EvenOdd" : "NonZero";
          if (!rings.length) continue;
          const part = new wasm.CrossSection(rings, rule);
          if (mask) {
            const next = mask.add(part);
            part.delete(); mask.delete(); mask = next;
          } else mask = part;
        }
        if (!mask) return [];
        const next = area.intersect(mask);
        area.delete(); area = next;
      } finally { mask?.delete(); }
    }
    return area.toPolygons().map((ring) => ring.map(([x, y]) => [x, y]));
  } finally { area.delete(); }
}

function paintColor(value, documentRef) {
  if (!value || value === "none" || value.startsWith("url(")) throw new EngravingError("unsupported-paint");
  const context = documentRef.createElement("canvas").getContext("2d");
  context.fillStyle = value;
  const normalized = context.fillStyle;
  if (/^#[0-9a-f]{6}$/iu.test(normalized)) return normalized.toLowerCase();
  const rgb = normalized.match(/[\d.]+/gu)?.slice(0, 3).map(Number);
  if (!rgb || rgb.length !== 3) throw new EngravingError("unsupported-paint");
  return `#${rgb.map((n) => Math.round(n).toString(16).padStart(2, "0")).join("")}`;
}

export async function redrawnDrawing(engraving, options) {
  if (!engraving.colorGroups?.length) return { contours: await redrawnContours(engraving, options) };
  const wasm = await loadManifold();
  const layers = await Promise.all(engraving.colorGroups.map(async (group) => ({
    ...group, contours: await redrawnContours(group.strokes?.length
      ? { fills: group.fills || [], strokes: group.strokes }
      : { fills: group.contours }, options)
  })));
  const colorGroups = composeColorGroups(wasm, layers).map((group) => {
    const source = engraving.colorGroups.find((entry) => entry.id === group.id);
    return { ...group, fills: source?.fills || [], strokes: source?.strokes || [] };
  });
  return { colorGroups, contours: unionColorContours(wasm, colorGroups) };
}

// A <line> has no inside, so its fill (black unless the file says otherwise) never
// shows: only its stroke does.
function isFilled(element, window) {
  if (element.tagName?.toLowerCase() === "line") {
    return false;
  }
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
  // Uploaded drawings are geometry, never executable page content.
  svg.querySelectorAll("script,foreignObject,image,use,style").forEach((node) => {
    if (node.tagName.toLowerCase() !== "style") node.remove();
    else if (/@import|url\s*\(/iu.test(node.textContent)) node.remove();
  });
  for (const node of [svg, ...svg.querySelectorAll("*")]) {
    for (const attr of [...node.attributes]) {
      if (/^on/iu.test(attr.name) || /href$/iu.test(attr.name)) node.removeAttribute(attr.name);
    }
  }
  stage.attachShadow({ mode: "closed" }).appendChild(svg);
  documentRef.body.appendChild(stage);
  try {
    const size = viewportSize(svg);
    const root = svg.getCTM ? svg.getCTM() : null;
    const tolerance = Math.hypot(size.width, size.height) / 6000;
    const shapes = [...svg.querySelectorAll("path,rect,circle,ellipse,polygon,polyline,line")]
      .filter((shape) => !shape.closest("defs,clipPath,mask,symbol"));
    if (shapes.length > MAX_SHAPES) throw new EngravingError("too-complex");
    const wasm = await loadManifold();
    const layers = [];
    const walked = [];
    const lines = [];
    const deadline = Date.now() + TIME_BUDGET_MS;
    let samples = MAX_TOTAL_SAMPLES;
    let shapeIndex = 0;
    for (const shape of shapes) {
      shapeIndex += 1;
      if (samples <= 0 || Date.now() > deadline) {
        throw new EngravingError("too-complex");
      }
      if (shapeIndex % SHAPES_PER_BREATH === 0) {
        // Let the page draw: this runs where the user is waiting.
        await pause();
      }
      if (typeof shape.getTotalLength !== "function") {
        continue;
      }
      const style = windowRef.getComputedStyle(shape);
      if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) continue;
      if ([...function* () { for (let p = shape.parentElement; p; p = p.parentElement) yield p; }()]
        .some((p) => windowRef.getComputedStyle(p).display === "none" || Number(windowRef.getComputedStyle(p).opacity) === 0)) continue;
      const matrix = shape.getCTM ? shape.getCTM() : null;
      // Back out the viewport's own transform: the drawing keeps its own units.
      const local = matrix && root ? root.inverse().multiply(matrix) : matrix;
      const fill = isFilled(shape, windowRef) && Number(style.fillOpacity) > 0;
      const stroke = strokeWidth(shape, windowRef, local);
      if (!fill && !stroke) {
        continue;
      }
      const contours = sampleShape(shape, local, samples);
      samples -= contours.reduce((total, points) => total + points.length, 0);
      // A shape filled by default but drawn as an open stroke (a path with no
      // fill="none") covers no area: what shows, and what is cut, is its stroke.
      const filled = fill && contours.some((points) => Math.abs(contourArea(points)) > tolerance * tolerance);
      const groove = filled ? 0 : stroke;
      if (!filled && !groove) {
        continue;
      }
      if (filled) {
        const walls = contours.map((ring) => simplifyContour(ring, tolerance));
        const filled = filledContours(wasm, walls, GROOVE_TOLERANCE, style.fillRule === "evenodd" ? "EvenOdd" : "NonZero");
        const clipped = clippedContours(wasm, filled, shape, svg, root, tolerance, windowRef);
        walked.push(...clipped);
        layers.push({ color: paintColor(style.fill, documentRef), contours: clipped, fills: clipped });
        continue;
      }
      // The line is followed closely: whatever it is off by comes straight off the
      // width of the groove drawn along it.
      const fine = Math.min(tolerance, groove / 100);
      const shapeLines = [];
      for (const line of contours) {
        const ends = Math.hypot(line[0][0] - line[line.length - 1][0], line[0][1] - line[line.length - 1][1]);
        const closed = ends <= groove;
        const kept = simplifyContour(closed ? line.slice(0, -1) : line, fine, STROKE_LINE_POINTS);
        if (kept.length >= 2) {
          shapeLines.push({ width: groove, closed, points: kept });
        }
      }
      lines.push(...shapeLines);
      layers.push({ color: paintColor(style.stroke, documentRef), strokes: shapeLines, contours: clippedContours(wasm, grooveContours(wasm, shapeLines), shape, svg, root, tolerance, windowRef) });
    }
    if (!walked.length && !lines.length) {
      throw new EngravingError("nothing-filled");
    }
    const colorGroups = composeColorGroups(wasm, layers).map((group) => ({
      ...group,
      fills: layers.filter((layer) => layer.color === group.color).flatMap((layer) => layer.fills || [])
        .map((ring) => ring.map(([x, y]) => [x - size.minX, y - size.minY])),
      strokes: layers.filter((layer) => layer.color === group.color).flatMap((layer) => layer.strokes || [])
        .map((line) => ({ ...line, points: line.points.map(([x, y]) => [x - size.minX, y - size.minY]) })),
      contours: group.contours.map((ring) => ring.map(([x, y]) => [x - size.minX, y - size.minY]))
    }));
    const kept = unionColorContours(wasm, colorGroups);
    if (!kept.length) throw new EngravingError("nothing-filled");
    const all = [...kept, ...colorGroups.flatMap((group) => group.contours)];
    if (colorGroups.length > 32 || all.some((ring) => ring.length > MAX_CONTOUR_POINTS)
      || all.reduce((sum, ring) => sum + ring.length, 0) > MAX_ENGRAVING_POINTS
      || colorGroups.some((group) => group.contours.length > MAX_ENGRAVING_CONTOURS)) {
      throw Object.assign(new EngravingError("too-complex"), { details: { points: all.reduce((sum, ring) => sum + ring.length, 0), longest: Math.max(...all.map((ring) => ring.length)), groups: colorGroups.map((g) => g.contours.length) } });
    }
    const fills = walked;
    return {
      name: String(name).slice(0, 60),
      width: size.width,
      height: size.height,
      // Set when the file gives its real size, so the drawing can come in 1:1.
      millimetresPerUnit: millimetresPerUnit(svg, size),
      contours: kept,
      colorGroups,
      // What the contours were made from, so the groove can be redrawn at another
      // width without the file: the shapes that were filled, and the lines drawn.
      fills: fills.map((points) => points.map(([x, y]) => [x - size.minX, y - size.minY])),
      strokes: lines.map((line) => ({
        ...line,
        points: line.points.map(([x, y]) => [x - size.minX, y - size.minY])
      }))
    };
  } finally {
    stage.remove();
  }
}
