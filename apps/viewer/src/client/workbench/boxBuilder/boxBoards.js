// Box builder: circuit boards. A board is drawn first (size, mounting holes,
// ports along its edges) and then mounted: set on generated standoffs on the
// floor, turned so it fits, and pushed against the walls its ports go through.
// Each mutating function edits a spec draft in place (useBoxBuilder's `edit`).

import {
  CLAMP_BAR,
  PCB_THICKNESS,
  PORT_TYPES,
  boardEdgeWall,
  boardLongAxis,
  boardOutline,
  boxDimensions,
  clampBoardPosition,
  defaultBoxSpec,
  defaultClampHeight,
  nextId,
  normalizeBoxSpec,
  roundMm,
  wallInnerHalf
} from "./boxSpec.js";

// Space left between a board edge and the inside of a wall.
export const BOARD_WALL_GAP = 1;
// Room left above the tallest part when the box is grown to fit a board.
const HEADROOM = 1;

export const PORT_TYPE_IDS = Object.freeze(Object.keys(PORT_TYPES));

function port(type, edge, offset, extra = {}) {
  const { shape, width, height, radius, elevation, margin = 0.5 } = PORT_TYPES[type];
  return { type, edge, offset, elevation, shape, width, height, radius, overhang: 0, margin, ...extra };
}

function holesAt(points, diameter) {
  return points.map(([x, y]) => ({ x, y, diameter }));
}

// "Custom": what a new board starts as when no template is picked.
export const CUSTOM_BOARD = Object.freeze({
  width: 50,
  length: 30,
  thickness: PCB_THICKNESS,
  clearance: 5,
  componentHeight: 10,
  padDiameter: 6,
  boreDiameter: 2.5,
  holes: Object.freeze(holesAt([[3.5, 3.5], [46.5, 3.5], [3.5, 26.5], [46.5, 26.5]], 3.2)),
  ports: Object.freeze([])
});

// A new, unmounted board from a template: one of the server's board presets
// (GET /__cad/boxes/presets, edited from /admin), or CUSTOM_BOARD for none.
// A port missing a size takes its type's.
export function newBoard(spec, preset = null) {
  const source = preset && typeof preset === "object" ? preset : CUSTOM_BOARD;
  const pick = (key) => (Number.isFinite(Number(source[key])) ? Number(source[key]) : CUSTOM_BOARD[key]);
  const board = {
    id: nextId("board", spec.boards),
    preset: source === CUSTOM_BOARD ? "custom" : String(source.id || "custom"),
    name: source === CUSTOM_BOARD ? "" : String(source.name || ""),
    width: pick("width"),
    length: pick("length"),
    thickness: pick("thickness"),
    clearance: pick("clearance"),
    componentHeight: pick("componentHeight"),
    padDiameter: pick("padDiameter"),
    boreDiameter: pick("boreDiameter"),
    holes: (Array.isArray(source.holes) ? source.holes : []).map((hole, index) => ({
      id: `mount-${index + 1}`,
      x: hole.x,
      y: hole.y,
      diameter: hole.diameter
    })),
    ports: (Array.isArray(source.ports) ? source.ports : []).map((entry, index) => ({
      ...port(PORT_TYPES[entry.type] ? entry.type : "custom", entry.edge, entry.offset),
      ...entry,
      id: `port-${index + 1}`
    })),
    rails: (Array.isArray(source.rails) ? source.rails : []).map((rail, index) => ({
      id: `rail-${index + 1}`,
      offset: rail.offset,
      length: rail.length,
      thickness: rail.thickness,
      height: rail.height
    })),
    mounted: false,
    x: 0,
    y: 0,
    rotation: 0
  };
  // With no mounting holes, the board is clamped down unless the template says not to.
  board.clamp = typeof source.clamp === "boolean" ? source.clamp : board.holes.length === 0;
  board.clampHeight = source.clampHeight != null && Number.isFinite(Number(source.clampHeight))
    ? Number(source.clampHeight)
    : defaultClampHeight(board);
  board.clampOffset = source.clampOffset != null && Number.isFinite(Number(source.clampOffset))
    ? Number(source.clampOffset)
    : roundMm(Math.max(board.width, board.length) / 2, 3);
  board.template = source === CUSTOM_BOARD ? "" : boardTemplateStamp(normalizedBoard(board));
  return board;
}

function normalizedBoard(board) {
  return normalizeBoxSpec({ ...defaultBoxSpec(), boards: [board] }).boards[0];
}

// --- templates -------------------------------------------------------------------

// What a board takes from its template; where it sits in the box is its own.
const TEMPLATE_FIELDS = Object.freeze([
  "name", "width", "length", "thickness", "clearance", "componentHeight", "padDiameter", "boreDiameter",
  "clamp", "clampHeight", "clampOffset", "clampDiameter", "clampBore", "clampGap"
]);
const PORT_FIELDS = Object.freeze(["type", "edge", "offset", "elevation", "shape", "width", "height", "radius", "overhang", "margin"]);

// A short fingerprint (FNV-1a) of everything a normalized board takes from its template.
export function boardTemplateStamp(board) {
  const text = JSON.stringify([
    TEMPLATE_FIELDS.map((key) => board[key]),
    board.holes.map((hole) => [hole.x, hole.y, hole.diameter]),
    board.ports.map((entry) => PORT_FIELDS.map((key) => entry[key])),
    (board.rails || []).map((rail) => [rail.offset, rail.length, rail.thickness, rail.height])
  ]);
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash = Math.imul(hash ^ text.charCodeAt(index), 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

// A board against the template it was made from, as { state, latest }:
// "none" - no such template; "current" - the template has not changed since;
// "restamp" - it changed, but the board already matches it; "update" - it changed
// and the board was not edited since it was made (or it predates fingerprints),
// so the board follows on its own; "edited" - it changed and so did the board.
export function boardTemplateState(board, presets) {
  const preset = board.preset === "custom" ? null : (presets || []).find((entry) => entry.id === board.preset);
  if (!preset) {
    return { state: "none", latest: null };
  }
  const latest = normalizedBoard(newBoard({ boards: [] }, preset));
  if (board.template === latest.template) {
    return { state: "current", latest };
  }
  const own = boardTemplateStamp(board);
  if (own === latest.template) {
    return { state: "restamp", latest };
  }
  return { state: !board.template || board.template === own ? "update" : "edited", latest };
}

function applyTemplate(draft, board, latest) {
  for (const key of TEMPLATE_FIELDS) {
    board[key] = latest[key];
  }
  board.holes = latest.holes.map((hole) => ({ ...hole }));
  board.ports = latest.ports.map((entry) => ({ ...entry }));
  board.rails = latest.rails.map((rail) => ({ ...rail }));
  board.template = latest.template;
  if (board.mounted) {
    placeBoard(draft, board, { keep: true });
  }
}

// Boards follow their changed templates unless they were edited; returns whether any changed.
export function syncBoardTemplates(draft, presets) {
  let changed = false;
  for (const board of draft.boards) {
    const { state, latest } = boardTemplateState(board, presets);
    if (state === "restamp") {
      board.template = latest.template;
      changed = true;
    } else if (state === "update") {
      applyTemplate(draft, board, latest);
      changed = true;
    }
  }
  return changed;
}

export function boardTemplatesPending(spec, presets) {
  return spec.boards.some((board) => ["restamp", "update"].includes(boardTemplateState(board, presets).state));
}

// An edited board taken back to its current template, where it sits kept.
export function updateBoardFromTemplate(draft, id, presets) {
  const board = findBoard(draft, id);
  const latest = board ? boardTemplateState(board, presets).latest : null;
  if (latest) {
    applyTemplate(draft, board, latest);
  }
}

export function newBoardHole(board) {
  const last = board.holes[board.holes.length - 1];
  return {
    id: nextId("mount", board.holes),
    x: roundMm(board.width / 2, 2),
    y: roundMm(board.length / 2, 2),
    diameter: last ? last.diameter : 3.2
  };
}

export function newBoardPort(board, type = "usbC") {
  return { id: nextId("port", board.ports), ...port(type, "front", roundMm(board.width / 2, 2)) };
}

// A 4 mm rib across the middle of the board, 1 mm short of each side.
export function newBoardRail(board) {
  const long = Math.max(board.width, board.length);
  const across = Math.min(board.width, board.length);
  return {
    id: nextId("rail", board.rails),
    offset: roundMm(long / 2 - 2, 2),
    length: roundMm(Math.max(across - 2, 1), 2),
    thickness: 4,
    // 0: as tall as the board's gap to the floor.
    height: 0
  };
}

// Switching a port's type takes that connector's body size.
export function setPortType(target, type) {
  const defaults = PORT_TYPES[type] || PORT_TYPES.custom;
  Object.assign(target, {
    type: PORT_TYPES[type] ? type : "custom",
    shape: defaults.shape,
    width: defaults.width,
    height: defaults.height,
    radius: defaults.radius,
    elevation: defaults.elevation,
    margin: defaults.margin ?? 0.5
  });
}

// The words of a name or a search: runs of letters and digits ("ESP32-S3 (N16R8)"
// is esp32, s3, n16r8).
function searchWords(text) {
  return String(text || "").toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

// The words of a board name, with letters and digits apart ("TTL-RS485" is ttl,
// rs, 485), so a model number is found without the letters stuck to it.
function nameWords(name) {
  return searchWords(name).flatMap((word) => word.match(/\p{L}+|\p{N}+/gu));
}

// Whether a board name answers a search. Every word typed must start a word of the
// name, or a run of its words written together ("esp32s3" finds "ESP32-S3", "485"
// finds "RS485"); a fragment inside a word does not count, so "es" finds ESP32 but
// not "Pressure".
export function boardNameMatches(name, query) {
  const words = nameWords(name);
  return searchWords(query).every((term) => (
    words.some((_, index) => words.slice(index).join("").startsWith(term))
  ));
}

export function findBoard(spec, id) {
  return spec.boards.find((board) => board.id === id) || null;
}

const BOARD_MIN_SIZE = 5;

function isCentred(value, size) {
  return Math.abs(value - size / 2) < 1e-6;
}

// How far a coordinate is from the edge it follows on a resize: the nearer one.
function edgeDistance(value, size) {
  return value > size / 2 ? size - value : value;
}

// The smallest width ("x") or length ("y") that keeps every hole and port whole
// on its own half of the board. Shrinking any further would push a hole across
// the middle, after which it would follow the other edge and growing the board
// back would no longer return it (two corner holes would end up as one).
export function boardMinimumSize(board, axis) {
  const size = axis === "x" ? board.width : board.length;
  let half = BOARD_MIN_SIZE / 2;
  for (const hole of board.holes) {
    const value = axis === "x" ? hole.x : hole.y;
    const radius = hole.diameter / 2;
    half = Math.max(half, isCentred(value, size) ? radius : edgeDistance(value, size) + radius);
  }
  for (const entry of board.ports) {
    if ((entry.edge === "front" || entry.edge === "back") !== (axis === "x")) {
      continue;
    }
    const halfWidth = entry.width / 2;
    half = Math.max(half, isCentred(entry.offset, size) ? halfWidth : edgeDistance(entry.offset, size) + halfWidth);
  }
  return Math.ceil(2 * half * 10 - 1e-6) / 10;
}

// A new board size. Holes and ports keep their distance to the nearer edge (a
// centred one stays centred), so corner holes and the standoffs under them stay
// in the corners; the size never goes below boardMinimumSize, so shrinking and
// growing back returns everything where it was. A mounted board stays between the walls.
export function resizeBoard(draft, id, { width, length }) {
  const board = findBoard(draft, id);
  if (!board) {
    return;
  }
  const nextWidth = Math.max(width ?? board.width, boardMinimumSize(board, "x"));
  const nextLength = Math.max(length ?? board.length, boardMinimumSize(board, "y"));
  const keep = (value, from, to) => {
    if (isCentred(value, from)) {
      return roundMm(to / 2, 3);
    }
    return roundMm(value > from / 2 ? to - (from - value) : value, 3);
  };
  for (const hole of board.holes) {
    hole.x = keep(hole.x, board.width, nextWidth);
    hole.y = keep(hole.y, board.length, nextLength);
  }
  for (const entry of board.ports) {
    const alongWidth = entry.edge === "front" || entry.edge === "back";
    entry.offset = alongWidth
      ? keep(entry.offset, board.width, nextWidth)
      : keep(entry.offset, board.length, nextLength);
  }
  // Ribs and the clamp posts keep their distance to the nearer end of the long side.
  const alongX = boardLongAxis(board) === "x";
  const longFrom = alongX ? board.width : board.length;
  const longTo = alongX ? nextWidth : nextLength;
  for (const rail of board.rails || []) {
    const centre = keep(rail.offset + rail.thickness / 2, longFrom, longTo);
    rail.offset = roundMm(Math.max(centre - rail.thickness / 2, 0), 3);
  }
  board.clampOffset = keep(board.clampOffset, longFrom, longTo);
  board.width = nextWidth;
  board.length = nextLength;
  if (board.mounted) {
    Object.assign(board, clampBoardPosition(boxDimensions(draft), board, board.x, board.y));
  }
}

// For each wall some of the board's ports go through: how far the board edge
// stays from it. Never less than BOARD_WALL_GAP, and more when a connector sticks
// out past the edge, so that it ends flush with the outside of the wall.
export function boardWallGaps(spec, board) {
  const gaps = {};
  for (const entry of board.ports) {
    const wall = boardEdgeWall(board, entry.edge);
    const gap = Math.max(BOARD_WALL_GAP, entry.overhang - spec.walls.thickness);
    gaps[wall] = Math.max(gaps[wall] ?? 0, gap);
  }
  return gaps;
}

// Centre the board (unless `keep`), then on each axis where its ports go through
// exactly one wall, push it against that wall.
function placeBoard(draft, board, { keep = false } = {}) {
  const dims = boxDimensions(draft);
  const [sizeX, sizeY] = boardOutline(board);
  const gaps = boardWallGaps(draft, board);
  let { x, y } = keep ? board : { x: 0, y: 0 };
  const along = (low, high, size, current) => {
    if (gaps[low] != null && gaps[high] != null) {
      return current;
    }
    if (gaps[high] != null) {
      return wallInnerHalf(dims, high) - gaps[high] - size / 2;
    }
    if (gaps[low] != null) {
      return -(wallInnerHalf(dims, low) - gaps[low] - size / 2);
    }
    return current;
  };
  x = along("left", "right", sizeX, x);
  y = along("front", "back", sizeY, y);
  Object.assign(board, clampBoardPosition(dims, board, x, y));
}

// Put a board into the box: the first quarter turn that fits between the walls
// (its current one first), centred, then against the walls its ports go through.
export function mountBoard(draft, id) {
  const board = findBoard(draft, id);
  if (!board) {
    return;
  }
  const dims = boxDimensions(draft);
  const fits = (rotation) => {
    const [sizeX, sizeY] = boardOutline({ ...board, rotation });
    return (
      sizeX + 2 * BOARD_WALL_GAP <= dims.innerWidth + 1e-6 &&
      sizeY + 2 * BOARD_WALL_GAP <= dims.innerDepth + 1e-6
    );
  };
  const rotation = [board.rotation, 0, 90, 270, 180].find(fits);
  if (rotation != null) {
    board.rotation = rotation;
  }
  board.mounted = true;
  placeBoard(draft, board);
}

export function unmountBoard(draft, id) {
  const board = findBoard(draft, id);
  if (board) {
    board.mounted = false;
  }
}

// Turning a mounted board sends its ports to other walls: place it again.
export function rotateBoard(draft, id, rotation) {
  const board = findBoard(draft, id);
  if (!board) {
    return;
  }
  board.rotation = rotation;
  if (board.mounted) {
    placeBoard(draft, board);
  }
}

// Turning a board over sends its side ports to the opposite walls: place it again,
// and raise it until the parts now hanging below clear the floor.
export function flipBoard(draft, id, flipped) {
  const board = findBoard(draft, id);
  if (!board) {
    return;
  }
  board.flipped = Boolean(flipped);
  if (board.flipped && board.clearance < board.componentHeight) {
    board.clearance = Math.ceil(board.componentHeight * 2 - 1e-6) / 2;
  }
  if (board.mounted) {
    placeBoard(draft, board);
  }
}

export function snapBoardToWalls(draft, id) {
  const board = findBoard(draft, id);
  if (board?.mounted) {
    placeBoard(draft, board, { keep: true });
  }
}

// Grow the box (never shrink it) until the board, its wall gaps and its tallest
// part fit, the lid's lip included; then place the board again.
export function fitBoxToBoard(draft, id) {
  const board = findBoard(draft, id);
  if (!board) {
    return;
  }
  const [sizeX, sizeY] = boardOutline(board);
  const gaps = boardWallGaps(draft, board);
  const inside =(size, low, high) => size + (gaps[low] ?? BOARD_WALL_GAP) + (gaps[high] ?? BOARD_WALL_GAP);
  const up = (value) => Math.ceil(value * 2 - 1e-6) / 2;
  const wall = draft.walls.thickness;
  draft.walls.enabled = true;
  draft.base.width = Math.min(500, Math.max(draft.base.width, up(inside(sizeX, "left", "right") + 2 * wall)));
  draft.base.depth = Math.min(500, Math.max(draft.base.depth, up(inside(sizeY, "front", "back") + 2 * wall)));
  const tallestPort = Math.max(0, ...board.ports.map((entry) => entry.elevation + entry.height + entry.margin));
  const lip = draft.lid.enabled && draft.lid.lip ? draft.lid.lipHeight : 0;
  // Upside down, the parts hang inside the clearance and nothing rises above the board.
  const above = board.flipped ? 0 : Math.max(board.componentHeight, tallestPort);
  // A clamp's bar lies on its posts and must pass under the lid too.
  const top = Math.max(board.clearance + board.thickness + above, board.clamp ? board.clampHeight + CLAMP_BAR : 0);
  const height = top + HEADROOM + lip;
  draft.walls.height = Math.min(500, Math.max(draft.walls.height, up(height)));
  if (board.mounted) {
    placeBoard(draft, board);
  }
}
