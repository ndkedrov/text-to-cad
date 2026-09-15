// Box builder: the editable description of a printable box (the "spec") and the
// helpers the sheet and the viewport share. Millimetres and degrees throughout.
// The box's outer footprint is centred on the origin, X to the right, Y to the
// back, and its bottom sits on z = 0.

export const BOX_SPEC_VERSION = 1;

export const HOLE_FACES = Object.freeze(["floor", "front", "back", "left", "right", "lid"]);
export const WALL_FACES = Object.freeze(["front", "back", "left", "right"]);
export const HOLE_SHAPES = Object.freeze(["circle", "rect", "slot", "hex"]);
export const STANDOFF_PATTERNS = Object.freeze(["line", "triangle", "rect"]);

// A circuit board's edges as seen from above before it is turned: front is its
// Y = 0 edge, left its X = 0 edge.
export const BOARD_EDGES = Object.freeze(["front", "back", "left", "right"]);
export const BOARD_ROTATIONS = Object.freeze([0, 90, 180, 270]);
export const PORT_SHAPES = Object.freeze(["rect", "circle"]);

// Display names for faces, shapes, patterns, edges and port types live in i18n.js
// (face.*, shape.*, pattern.*, edge.*, port.type.*).

export const MAX_HOLES = 60;
export const MAX_STANDOFF_GROUPS = 12;
export const MAX_BOARDS = 4;
export const MAX_BOARD_HOLES = 8;
export const MAX_BOARD_PORTS = 8;
export const PCB_THICKNESS = 1.6;
// A connector whose front stops further than this from the inside of its wall is
// reported: a plug will not reach it through the cut-out.
export const PORT_REACH_TOLERANCE = 2;

// Connector bodies as they stand on the board: width along the board edge, height
// up from `elevation` above the board top.
export const PORT_TYPES = Object.freeze({
  usbC: Object.freeze({ shape: "rect", width: 9, height: 3.3, radius: 1.2, elevation: 0 }),
  microUsb: Object.freeze({ shape: "rect", width: 8, height: 3, radius: 0.6, elevation: 0 }),
  miniUsb: Object.freeze({ shape: "rect", width: 7.8, height: 4, radius: 0.5, elevation: 0 }),
  usbA: Object.freeze({ shape: "rect", width: 13.2, height: 5.8, radius: 0.5, elevation: 0 }),
  usbA2: Object.freeze({ shape: "rect", width: 13.5, height: 16, radius: 0.5, elevation: 0 }),
  usbB: Object.freeze({ shape: "rect", width: 12.2, height: 11, radius: 0.5, elevation: 0 }),
  hdmi: Object.freeze({ shape: "rect", width: 15.2, height: 5.8, radius: 0.5, elevation: 0 }),
  miniHdmi: Object.freeze({ shape: "rect", width: 11.2, height: 3.4, radius: 0.5, elevation: 0 }),
  microHdmi: Object.freeze({ shape: "rect", width: 7, height: 3.6, radius: 0.5, elevation: 0 }),
  rj45: Object.freeze({ shape: "rect", width: 16, height: 13.5, radius: 0.5, elevation: 0 }),
  dcJack: Object.freeze({ shape: "circle", width: 9.5, height: 9.5, radius: 0, elevation: 1.75 }),
  audio: Object.freeze({ shape: "circle", width: 6.5, height: 6.5, radius: 0, elevation: 0 }),
  // The opening a card goes in through, not the whole socket.
  microSd: Object.freeze({ shape: "rect", width: 12, height: 2, radius: 0.3, elevation: 0 }),
  // The D-shaped face of a right-angle D-sub 9 (RS232) connector.
  db9: Object.freeze({ shape: "rect", width: 19.5, height: 11.5, radius: 1, elevation: 0.5 }),
  // A keystone jack's suggested cut-out for a plastic panel 1.5-1.6 mm thick,
  // with no gap so the jack snaps in.
  keystone: Object.freeze({ shape: "rect", width: 14.7, height: 16.4, radius: 0, elevation: 0, margin: 0 }),
  // Room for an RJ45 plug (up to a shielded Cat6A one) to pass through a wall.
  rj45Pass: Object.freeze({ shape: "rect", width: 15, height: 15.3, radius: 1, elevation: 0 }),
  custom: Object.freeze({ shape: "rect", width: 10, height: 5, radius: 0, elevation: 0 })
});

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
    standoffs: [],
    boards: []
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
    rotation: numberIn(source.rotation, 0, -360, 360),
    // The connector this hole was sized for (see connectorHole), or "".
    connector: CONNECTOR_TYPES.includes(source.connector) ? source.connector : ""
  };
}

// --- connector holes -----------------------------------------------------------

// Connectors a hole can be cut for: every port type but "custom".
export const CONNECTOR_TYPES = Object.freeze(Object.keys(PORT_TYPES).filter((type) => type !== "custom"));
// Room left around a connector's body in its hole, on every side.
export const CONNECTOR_HOLE_MARGIN = 0.5;
// A keystone jack's latches only catch a panel up to this thick.
const KEYSTONE_PANEL_MAX = 1.6;

// The room a connector type leaves around its body in a hole: its own `margin`
// when it has one (a snap-in keystone needs its exact cut-out), else the default.
export function connectorHoleMargin(type) {
  return (PORT_TYPES[type] || PORT_TYPES.custom).margin ?? CONNECTOR_HOLE_MARGIN;
}

// The shape and size of a hole for a connector: its body plus the margin all
// round, a rounded rectangle or, for round connectors, a circle.
export function connectorHole(type) {
  const size = PORT_TYPES[type] || PORT_TYPES.custom;
  const margin = connectorHoleMargin(type);
  const width = roundMm(size.width + 2 * margin, 3);
  if (size.shape === "circle") {
    return { connector: type, shape: "circle", width, height: width, radius: 0 };
  }
  const height = roundMm(size.height + 2 * margin, 3);
  const radius = roundMm(Math.min(size.radius + margin, Math.min(width, height) / 2), 3);
  return { connector: type, shape: "rect", width, height, radius };
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

function normalizeBoardHole(raw, used, width, length) {
  const source = raw && typeof raw === "object" ? raw : {};
  const diameter = numberIn(source.diameter, 3.2, 0.5, 12);
  // A hole stays whole inside the board: its centre at least a radius from each edge.
  const insetX = Math.min(diameter / 2, width / 2);
  const insetY = Math.min(diameter / 2, length / 2);
  return {
    id: uniqueId(source.id, "mount", used),
    x: numberIn(source.x, 3.5, insetX, width - insetX),
    y: numberIn(source.y, 3.5, insetY, length - insetY),
    diameter
  };
}

function normalizePort(raw, used, width, length) {
  const source = raw && typeof raw === "object" ? raw : {};
  const type = Object.prototype.hasOwnProperty.call(PORT_TYPES, source.type) ? source.type : "custom";
  const defaults = PORT_TYPES[type];
  const edge = BOARD_EDGES.includes(source.edge) ? source.edge : "front";
  const shape = PORT_SHAPES.includes(source.shape) ? source.shape : defaults.shape;
  const portWidth = numberIn(source.width, defaults.width, 0.5, 100);
  const portHeight = shape === "circle" ? portWidth : numberIn(source.height, defaults.height, 0.5, 100);
  const edgeLength = edge === "front" || edge === "back" ? width : length;
  return {
    id: uniqueId(source.id, "port", used),
    type,
    edge,
    offset: numberIn(source.offset, edgeLength / 2, 0, edgeLength),
    elevation: numberIn(source.elevation, defaults.elevation, -20, 100),
    shape,
    width: portWidth,
    height: portHeight,
    radius: shape === "circle" ? 0 : numberIn(source.radius, defaults.radius, 0, Math.min(portWidth, portHeight) / 2),
    overhang: numberIn(source.overhang, 0, 0, 30),
    margin: numberIn(source.margin, 0.5, 0, 5)
  };
}

function normalizeBoard(raw, used) {
  const source = raw && typeof raw === "object" ? raw : {};
  const width = numberIn(source.width, 50, 5, 400);
  const length = numberIn(source.length, 30, 5, 400);
  const padDiameter = numberIn(source.padDiameter, 6, 2, 30);
  const quarter = ((Math.round(finiteOr(source.rotation, 0) / 90) % 4) + 4) % 4;
  const holeIds = new Set();
  const portIds = new Set();
  return {
    id: uniqueId(source.id, "board", used),
    preset: typeof source.preset === "string" && /^[A-Za-z0-9][A-Za-z0-9-]{0,39}$/u.test(source.preset) ? source.preset : "custom",
    // The template's name, shown in the board's heading.
    name: typeof source.name === "string" ? source.name.replace(/[ -]/gu, "").trim().slice(0, 60) : "",
    width,
    length,
    thickness: numberIn(source.thickness, PCB_THICKNESS, 0.4, 5),
    // 0 lays the board straight on the floor, with no standoffs.
    clearance: numberIn(source.clearance, 5, 0, 200),
    componentHeight: numberIn(source.componentHeight, 10, 0, 200),
    padDiameter,
    boreDiameter: numberIn(source.boreDiameter, 2.5, 0, padDiameter - 0.8),
    holes: (Array.isArray(source.holes) ? source.holes : [])
      .slice(0, MAX_BOARD_HOLES)
      .map((hole) => normalizeBoardHole(hole, holeIds, width, length)),
    ports: (Array.isArray(source.ports) ? source.ports : [])
      .slice(0, MAX_BOARD_PORTS)
      .map((port) => normalizePort(port, portIds, width, length)),
    mounted: booleanOr(source.mounted, false),
    flipped: booleanOr(source.flipped, false),
    x: numberIn(source.x, 0, -2000, 2000),
    y: numberIn(source.y, 0, -2000, 2000),
    rotation: quarter * 90
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
  const boardIds = new Set();
  const boards = (Array.isArray(source.boards) ? source.boards : [])
    .slice(0, MAX_BOARDS)
    .map((board) => normalizeBoard(board, boardIds));

  return { version: BOX_SPEC_VERSION, base, walls, lid, holes, standoffs, boards };
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

// Position label keys (i18n.js): u and v of a hole on this face. On a wall the
// second one is shown as the hole's bottom edge above the floor (holeLift).
export function faceAxisLabels(face) {
  return isWallFace(face) ? ["axis.along", "axis.aboveFloor"] : ["axis.x", "axis.y"];
}

// Half the hole's extent along u and along v, rotation included.
export function holeHalfExtents(hole) {
  if (hole.shape === "circle") {
    return [hole.width / 2, hole.width / 2];
  }
  if (hole.shape === "hex") {
    const circumradius = hole.width / Math.sqrt(3);
    return [circumradius, circumradius];
  }
  const angle = (hole.rotation * Math.PI) / 180;
  const cos = Math.abs(Math.cos(angle));
  const sin = Math.abs(Math.sin(angle));
  const halfWidth = hole.width / 2;
  const halfHeight = hole.height / 2;
  return [halfWidth * cos + halfHeight * sin, halfWidth * sin + halfHeight * cos];
}

// A wall hole is stored by its centre above the box bottom (v) but read and
// typed as the height of its bottom edge above the inside of the floor.
export function holeLift(dims, hole) {
  return roundMm(hole.v - holeHalfExtents(hole)[1] - dims.floorTop, 3);
}

export function holeCentreForLift(dims, hole, lift) {
  return roundMm(dims.floorTop + lift + holeHalfExtents(hole)[1], 4);
}

// Size label keys (i18n.js): a rectangular hole's extent along u and along v.
export function faceSizeLabels(face) {
  return isWallFace(face) ? ["size.width", "size.height"] : ["size.x", "size.y"];
}

export function faceRange(dims, face) {
  const halfWidth = dims.width / 2;
  const halfDepth = dims.depth / 2;
  // A wall hole belongs above the floor: one reaching below its top cuts the floor.
  if (face === "front" || face === "back") {
    return { u: [-halfWidth, halfWidth], v: [dims.floorTop, dims.wallTop] };
  }
  if (face === "left" || face === "right") {
    return { u: [-halfDepth, halfDepth], v: [dims.floorTop, dims.wallTop] };
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

// --- boards --------------------------------------------------------------------

// A board is described as on its drawing: seen from above, X along its width from
// the left edge, Y along its length from the front edge. Mounted, its centre sits
// at (x, y) on the floor and it is turned by `rotation` (0/90/180/270) about it.
// A `flipped` board is turned over about its own Y axis first: component side
// down, its left edge on the right, its parts hanging below it.

const EDGE_NORMALS = Object.freeze({ front: [0, -1], back: [0, 1], left: [-1, 0], right: [1, 0] });

function turnQuarter([x, y], rotation) {
  switch (rotation) {
    case 90:
      return [-y, x];
    case 180:
      return [-x, -y];
    case 270:
      return [y, -x];
    default:
      return [x, y];
  }
}

// The board's extent along the box's X and Y.
export function boardFootprint(board) {
  return board.rotation % 180 === 0 ? [board.width, board.length] : [board.length, board.width];
}

// A point given in the board's own coordinates, in box coordinates.
export function boardPoint(board, px, py) {
  const localX = board.flipped ? board.width - px : px;
  const [dx, dy] = turnQuarter([localX - board.width / 2, py - board.length / 2], board.rotation);
  return [roundMm(board.x + dx, 4), roundMm(board.y + dy, 4)];
}

export function boardHolePoints(board) {
  return board.holes.map((hole) => boardPoint(board, hole.x, hole.y));
}

// Heights above the box bottom: the board's underside, its top, and how far its
// parts reach up (or, upside down, down).
export function boardLevels(dims, board) {
  const bottom = dims.floorTop + board.clearance;
  const top = bottom + board.thickness;
  return {
    bottom,
    top,
    partsTop: board.flipped ? top : top + board.componentHeight,
    partsBottom: board.flipped ? bottom - board.componentHeight : bottom
  };
}

// The wall a board edge faces once the board is turned (and turned over).
export function boardEdgeWall(board, edge) {
  const [normalX, normalY] = EDGE_NORMALS[edge] || EDGE_NORMALS.front;
  const [x, y] = turnQuarter([board.flipped ? -normalX : normalX, normalY], board.rotation);
  if (Math.abs(x) > Math.abs(y)) {
    return x > 0 ? "right" : "left";
  }
  return y > 0 ? "back" : "front";
}

function boardEdgePoint(board, edge, offset) {
  switch (edge) {
    case "back":
      return [offset, board.length];
    case "left":
      return [0, offset];
    case "right":
      return [board.width, offset];
    default:
      return [offset, 0];
  }
}

// From the box centre to the inside of a wall.
export function wallInnerHalf(dims, wall) {
  return wall === "front" || wall === "back" ? dims.innerDepth / 2 : dims.innerWidth / 2;
}

// The cut-out a port needs, shaped like a wall hole ({ face, shape, width, height,
// radius, u, v, rotation }), plus `gap`: how far the connector's front stops short
// of the inside of that wall (negative when it reaches into the wall).
export function boardPortCutout(dims, board, port) {
  const face = boardEdgeWall(board, port.edge);
  const frame = faceFrame(dims, face);
  const [px, py] = boardEdgePoint(board, port.edge, port.offset);
  const [x, y] = boardPoint(board, px, py);
  const front = x * frame.normal[0] + y * frame.normal[1] + port.overhang;
  const width = port.width + 2 * port.margin;
  const height = port.shape === "circle" ? width : port.height + 2 * port.margin;
  return {
    face,
    shape: port.shape === "circle" ? "circle" : "rect",
    width: roundMm(width, 4),
    height: roundMm(height, 4),
    radius: port.shape === "circle" ? 0 : roundMm(Math.min(port.radius + port.margin, Math.min(width, height) / 2), 4),
    u: roundMm(x * frame.u[0] + y * frame.u[1], 4),
    // Upside down, a connector's `elevation` and body run down from the board's underside.
    v: roundMm(board.flipped
      ? boardLevels(dims, board).bottom - port.elevation - port.height / 2
      : boardLevels(dims, board).top + port.elevation + port.height / 2, 4),
    rotation: 0,
    gap: roundMm(wallInnerHalf(dims, face) - front, 3)
  };
}

// Keep a mounted board between the walls.
export function clampBoardPosition(dims, board, x, y) {
  const [sizeX, sizeY] = boardFootprint(board);
  const limitX = Math.max(dims.innerWidth / 2 - sizeX / 2, 0);
  const limitY = Math.max(dims.innerDepth / 2 - sizeY / 2, 0);
  // `|| 0` turns a -0 from a centred placement into 0.
  return {
    x: roundMm(clamp(x, -limitX, limitX), 3) || 0,
    y: roundMm(clamp(y, -limitY, limitY), 3) || 0
  };
}

// The stretch of a wall between its rounded corners.
export function wallFlatHalf(dims, face) {
  return (face === "front" || face === "back" ? dims.width : dims.depth) / 2 - dims.radius;
}

// --- checks ------------------------------------------------------------------

// Things that build fine but are probably not what was meant, as { key, params }
// for i18n.js's formatWarning; `target` names the item to select when it is not
// the n-th hole or standoff group.
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
    if (hole.connector === "keystone") {
      const thickness = isWallFace(hole.face) ? dims.wallThickness : hole.face === "lid" ? dims.lidThickness : dims.floorThickness;
      if (thickness > KEYSTONE_PANEL_MAX + 1e-6) {
        warnings.push({ key: "warning.keystoneWall", params: { n, thickness: roundMm(thickness, 2) } });
      }
    }
  });
  spec.boards.forEach((board, index) => {
    if (!board.mounted) {
      return;
    }
    const n = index + 1;
    const target = { kind: "board", id: board.id };
    const [sizeX, sizeY] = boardFootprint(board);
    if (
      Math.abs(board.x) + sizeX / 2 > dims.innerWidth / 2 + 1e-6 ||
      Math.abs(board.y) + sizeY / 2 > dims.innerDepth / 2 + 1e-6
    ) {
      warnings.push({ key: "warning.boardOutside", params: { n }, target });
    }
    if (dims.wallsEnabled && boardLevels(dims, board).partsTop > dims.wallTop + 1e-6) {
      warnings.push({ key: "warning.boardTall", params: { n }, target });
    }
    if (board.flipped && board.componentHeight > board.clearance + 1e-6) {
      warnings.push({ key: "warning.boardPartsBelow", params: { n }, target });
    }
    if (!board.ports.length) {
      return;
    }
    if (!dims.wallsEnabled) {
      warnings.push({ key: "warning.boardNoWalls", params: { n }, target });
      return;
    }
    board.ports.forEach((port, portIndex) => {
      const cutout = boardPortCutout(dims, board, port);
      const params = { n, port: portIndex + 1 };
      if (
        Math.abs(cutout.u) + cutout.width / 2 > wallFlatHalf(dims, cutout.face) + 1e-6 ||
        cutout.v - cutout.height / 2 < dims.floorTop - 1e-6 ||
        cutout.v + cutout.height / 2 > dims.wallTop + 1e-6
      ) {
        warnings.push({ key: "warning.portOutside", params, target });
      } else if (cutout.gap > PORT_REACH_TOLERANCE) {
        warnings.push({ key: "warning.portFar", params: { ...params, gap: Number(cutout.gap.toFixed(1)) }, target });
      }
    });
  });
  return warnings;
}
