// Box builder: the editable description of a printable box (the "spec") and the
// helpers the sheet and the viewport share. Millimetres and degrees throughout.
// The box's outer footprint is centred on the origin, X to the right, Y to the
// back, and its bottom sits on z = 0.

export const BOX_SPEC_VERSION = 1;

export const HOLE_FACES = Object.freeze(["floor", "front", "back", "left", "right", "lid"]);
export const WALL_FACES = Object.freeze(["front", "back", "left", "right"]);
export const HOLE_SHAPES = Object.freeze(["circle", "rect", "slot", "hex"]);
export const STANDOFF_PATTERNS = Object.freeze(["line", "triangle", "rect"]);

// Display names for faces, shapes and patterns live in i18n.js (face.*, shape.*, pattern.*).

const MAX_HOLES = 60;
const MAX_STANDOFF_GROUPS = 12;

function finiteOr(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function clamp(value, min, max) {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

function numberIn(value, fallback, min, max) {
  return clamp(finiteOr(value, fallback), min, max);
}

function booleanOr(value, fallback) {
  return typeof value === "boolean" ? value : fallback;
}

export function roundMm(value, digits = 4) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function defaultBoxSpec() {
  return {
    version: BOX_SPEC_VERSION,
    base: { width: 100, depth: 70, thickness: 2, radius: 4 },
    walls: { enabled: true, height: 30, thickness: 2 },
    lid: {
      enabled: true,
      thickness: 2,
      lip: true,
      lipHeight: 4,
      lipThickness: 1.6,
      clearance: 0.25
    },
    holes: [],
    standoffs: []
  };
}

// Derived measurements every consumer needs. Pure arithmetic on a normalized spec.
export function boxDimensions(spec) {
  const { base, walls, lid } = spec;
  const width = base.width;
  const depth = base.depth;
  const radius = base.radius;
  const floorThickness = base.thickness;
  const floorTop = floorThickness;
  const wallsEnabled = walls.enabled;
  const wallThickness = walls.thickness;
  const wallHeight = wallsEnabled ? walls.height : 0;
  const wallTop = floorTop + wallHeight;
  const innerWidth = wallsEnabled ? width - 2 * wallThickness : width;
  const innerDepth = wallsEnabled ? depth - 2 * wallThickness : depth;
  const innerRadius = wallsEnabled ? Math.max(radius - wallThickness, 0) : radius;
  const lidEnabled = wallsEnabled && lid.enabled;
  const lipEnabled = lidEnabled && lid.lip;
  const lidThickness = lid.thickness;
  const lidTop = wallTop + lidThickness;
  return {
    width,
    depth,
    radius,
    floorThickness,
    floorTop,
    wallsEnabled,
    wallThickness,
    wallHeight,
    wallTop,
    innerWidth,
    innerDepth,
    innerRadius,
    lidEnabled,
    lidThickness,
    lidTop,
    lipEnabled,
    lipHeight: lid.lipHeight,
    lipThickness: lid.lipThickness,
    clearance: lid.clearance,
    lipWidth: innerWidth - 2 * lid.clearance,
    lipDepth: innerDepth - 2 * lid.clearance,
    lipRadius: Math.max(innerRadius - lid.clearance, 0),
    totalHeight: lidEnabled ? lidTop : wallTop
  };
}

function uniqueId(candidate, prefix, used) {
  let id = typeof candidate === "string" && /^[a-z0-9-]{1,40}$/u.test(candidate) ? candidate : "";
  if (!id || used.has(id)) {
    let index = used.size + 1;
    do {
      id = `${prefix}-${index}`;
      index += 1;
    } while (used.has(id));
  }
  used.add(id);
  return id;
}

export function nextId(prefix, items) {
  let max = 0;
  for (const item of items || []) {
    const match = String(item?.id || "").match(new RegExp(`^${prefix}-(\\d+)$`, "u"));
    if (match) {
      max = Math.max(max, Number(match[1]));
    }
  }
  return `${prefix}-${max + 1}`;
}

function normalizeHole(raw, used) {
  const source = raw && typeof raw === "object" ? raw : {};
  const width = numberIn(source.width, 5, 0.3, 500);
  const height = numberIn(source.height, width, 0.3, 500);
  return {
    id: uniqueId(source.id, "hole", used),
    face: HOLE_FACES.includes(source.face) ? source.face : "floor",
    shape: HOLE_SHAPES.includes(source.shape) ? source.shape : "circle",
    width,
    height,
    radius: numberIn(source.radius, 0, 0, Math.min(width, height) / 2),
    u: numberIn(source.u, 0, -2000, 2000),
    v: numberIn(source.v, 0, -2000, 2000),
    rotation: numberIn(source.rotation, 0, -360, 360)
  };
}

function normalizeStandoffGroup(raw, used) {
  const source = raw && typeof raw === "object" ? raw : {};
  const outerDiameter = numberIn(source.outerDiameter, 6, 1, 200);
  return {
    id: uniqueId(source.id, "standoff", used),
    pattern: STANDOFF_PATTERNS.includes(source.pattern) ? source.pattern : "rect",
    spacingX: numberIn(source.spacingX, 58, 0, 1000),
    spacingY: numberIn(source.spacingY, 23, 0, 1000),
    outerDiameter,
    holeDiameter: numberIn(source.holeDiameter, 2.5, 0, outerDiameter - 0.4),
    height: numberIn(source.height, 5, 0.5, 500),
    x: numberIn(source.x, 0, -2000, 2000),
    y: numberIn(source.y, 0, -2000, 2000),
    rotation: numberIn(source.rotation, 0, -360, 360)
  };
}

// Clamp every value into a buildable range. Never throws: whatever arrives (a
// saved file, a half-typed value) comes back as a spec both geometry engines accept.
export function normalizeBoxSpec(raw) {
  const defaults = defaultBoxSpec();
  const source = raw && typeof raw === "object" ? raw : {};
  const sourceBase = source.base && typeof source.base === "object" ? source.base : {};
  const width = numberIn(sourceBase.width, defaults.base.width, 10, 500);
  const depth = numberIn(sourceBase.depth, defaults.base.depth, 10, 500);
  const half = Math.min(width, depth) / 2;
  const base = {
    width,
    depth,
    thickness: numberIn(sourceBase.thickness, defaults.base.thickness, 0.4, 50),
    radius: numberIn(sourceBase.radius, defaults.base.radius, 0, half)
  };

  const sourceWalls = source.walls && typeof source.walls === "object" ? source.walls : {};
  const walls = {
    enabled: booleanOr(sourceWalls.enabled, defaults.walls.enabled),
    height: numberIn(sourceWalls.height, defaults.walls.height, 1, 500),
    thickness: numberIn(sourceWalls.thickness, defaults.walls.thickness, 0.4, Math.max(0.4, half - 1))
  };

  const sourceLid = source.lid && typeof source.lid === "object" ? source.lid : {};
  const innerHalf = half - walls.thickness;
  const clearance = numberIn(sourceLid.clearance, defaults.lid.clearance, 0, 3);
  const lid = {
    enabled: booleanOr(sourceLid.enabled, defaults.lid.enabled),
    thickness: numberIn(sourceLid.thickness, defaults.lid.thickness, 0.4, 50),
    lip: booleanOr(sourceLid.lip, defaults.lid.lip),
    lipHeight: numberIn(sourceLid.lipHeight, defaults.lid.lipHeight, 0.5, walls.height),
    lipThickness: numberIn(
      sourceLid.lipThickness,
      defaults.lid.lipThickness,
      0.4,
      Math.max(0.4, innerHalf - clearance - 0.5)
    ),
    clearance
  };

  const holeIds = new Set();
  const holes = (Array.isArray(source.holes) ? source.holes : [])
    .slice(0, MAX_HOLES)
    .map((hole) => normalizeHole(hole, holeIds));
  const standoffIds = new Set();
  const standoffs = (Array.isArray(source.standoffs) ? source.standoffs : [])
    .slice(0, MAX_STANDOFF_GROUPS)
    .map((group) => normalizeStandoffGroup(group, standoffIds));

  return { version: BOX_SPEC_VERSION, base, walls, lid, holes, standoffs };
}

// --- faces -------------------------------------------------------------------

// Where a face's (u, v) coordinates live in the assembled box. Floor and lid
// read as seen from above (u = X, v = Y); a wall reads as seen from outside,
// u along the wall from its middle and v the height above the box bottom.
export function faceFrame(dims, face) {
  const halfWidth = dims.width / 2;
  const halfDepth = dims.depth / 2;
  switch (face) {
    case "front":
      return { origin: [0, -halfDepth, 0], u: [1, 0, 0], v: [0, 0, 1], normal: [0, -1, 0] };
    case "back":
      return { origin: [0, halfDepth, 0], u: [-1, 0, 0], v: [0, 0, 1], normal: [0, 1, 0] };
    case "right":
      return { origin: [halfWidth, 0, 0], u: [0, 1, 0], v: [0, 0, 1], normal: [1, 0, 0] };
    case "left":
      return { origin: [-halfWidth, 0, 0], u: [0, -1, 0], v: [0, 0, 1], normal: [-1, 0, 0] };
    case "lid":
      return { origin: [0, 0, dims.lidTop], u: [1, 0, 0], v: [0, 1, 0], normal: [0, 0, 1] };
    default:
      return { origin: [0, 0, dims.floorTop], u: [1, 0, 0], v: [0, 1, 0], normal: [0, 0, 1] };
  }
}

export function isWallFace(face) {
  return WALL_FACES.includes(face);
}

// Position label keys (i18n.js): u and v of a hole on this face.
export function faceAxisLabels(face) {
  return isWallFace(face) ? ["axis.along", "axis.fromBottom"] : ["axis.x", "axis.y"];
}

// Size label keys (i18n.js): a rectangular hole's extent along u and along v.
export function faceSizeLabels(face) {
  return isWallFace(face) ? ["size.width", "size.height"] : ["size.x", "size.y"];
}

export function faceRange(dims, face) {
  const halfWidth = dims.width / 2;
  const halfDepth = dims.depth / 2;
  if (face === "front" || face === "back") {
    return { u: [-halfWidth, halfWidth], v: [0, dims.wallTop] };
  }
  if (face === "left" || face === "right") {
    return { u: [-halfDepth, halfDepth], v: [0, dims.wallTop] };
  }
  return { u: [-halfWidth, halfWidth], v: [-halfDepth, halfDepth] };
}

export function holeAvailable(dims, face) {
  if (isWallFace(face)) {
    return dims.wallsEnabled;
  }
  if (face === "lid") {
    return dims.lidEnabled;
  }
  return true;
}

export function clampHolePosition(dims, hole, u, v) {
  const range = faceRange(dims, hole.face);
  return {
    u: roundMm(clamp(u, range.u[0], range.u[1]), 3),
    v: roundMm(clamp(v, range.v[0], range.v[1]), 3)
  };
}

export function newHole(spec, face = "floor") {
  const dims = boxDimensions(spec);
  const v = isWallFace(face) ? roundMm(dims.floorTop + dims.wallHeight / 2, 2) : 0;
  return {
    id: nextId("hole", spec.holes),
    face,
    shape: "circle",
    width: 5,
    height: 5,
    radius: 0,
    u: 0,
    v,
    rotation: 0
  };
}

// --- standoffs ---------------------------------------------------------------

// Hole centres relative to the group's centre, before rotation. spacingX is the
// distance between the two holes of a row; spacingY is between rows (for the
// triangle: from the two-hole base to the apex, which sits on the middle line).
export function standoffLocalOffsets(group) {
  const halfX = group.spacingX / 2;
  const halfY = group.spacingY / 2;
  if (group.pattern === "line") {
    return [[-halfX, 0], [halfX, 0]];
  }
  if (group.pattern === "triangle") {
    return [[-halfX, -halfY], [halfX, -halfY], [0, halfY]];
  }
  return [[-halfX, -halfY], [halfX, -halfY], [halfX, halfY], [-halfX, halfY]];
}

function rotatedOffsets(group) {
  const angle = (group.rotation * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return standoffLocalOffsets(group).map(([x, y]) => [x * cos - y * sin, x * sin + y * cos]);
}

export function standoffPoints(group) {
  return rotatedOffsets(group).map(([x, y]) => [group.x + x, group.y + y]);
}

// Keep every pad of the group on the floor inside the walls.
export function clampStandoffPosition(dims, group, x, y) {
  const radius = group.outerDiameter / 2;
  const offsets = rotatedOffsets(group);
  const extentX = Math.max(...offsets.map(([dx]) => Math.abs(dx))) + radius;
  const extentY = Math.max(...offsets.map(([, dy]) => Math.abs(dy))) + radius;
  const limitX = Math.max(dims.innerWidth / 2 - extentX, 0);
  const limitY = Math.max(dims.innerDepth / 2 - extentY, 0);
  return {
    x: roundMm(clamp(x, -limitX, limitX), 3),
    y: roundMm(clamp(y, -limitY, limitY), 3)
  };
}

export function newStandoffGroup(spec) {
  const dims = boxDimensions(spec);
  const outerDiameter = 6;
  const group = {
    id: nextId("standoff", spec.standoffs),
    pattern: "rect",
    spacingX: roundMm(clamp(58, 0, dims.innerWidth - outerDiameter - 2), 1),
    spacingY: roundMm(clamp(23, 0, dims.innerDepth - outerDiameter - 2), 1),
    outerDiameter,
    holeDiameter: 2.5,
    height: 5,
    x: 0,
    y: 0,
    rotation: 0
  };
  return group;
}

// --- checks ------------------------------------------------------------------

// Things that build fine but are probably not what was meant, as { key, params }
// for i18n.js's formatWarning.
export function boxSpecWarnings(spec) {
  const dims = boxDimensions(spec);
  const warnings = [];
  spec.standoffs.forEach((group, index) => {
    const n = index + 1;
    const radius = group.outerDiameter / 2;
    const outside = standoffPoints(group).some(([x, y]) => (
      Math.abs(x) + radius > dims.innerWidth / 2 + 1e-6 ||
      Math.abs(y) + radius > dims.innerDepth / 2 + 1e-6
    ));
    if (outside) {
      warnings.push({ key: "warning.standoffsOutside", params: { n } });
    }
    if (dims.wallsEnabled && group.height > dims.wallHeight) {
      warnings.push({ key: "warning.standoffsTall", params: { n } });
    }
  });
  spec.holes.forEach((hole, index) => {
    const n = index + 1;
    if (!holeAvailable(dims, hole.face)) {
      warnings.push({ key: "warning.holeFaceOff", params: { n, face: hole.face } });
      return;
    }
    const range = faceRange(dims, hole.face);
    const extent = Math.max(hole.width, hole.height) / 2;
    if (
      hole.u - extent < range.u[0] - 1e-6 || hole.u + extent > range.u[1] + 1e-6 ||
      hole.v - extent < range.v[0] - 1e-6 || hole.v + extent > range.v[1] + 1e-6
    ) {
      warnings.push({ key: "warning.holeOutside", params: { n } });
    }
  });
  return warnings;
}
