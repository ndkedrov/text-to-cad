// Box builder: circuit boards. A board is drawn first (size, mounting holes,
// ports along its edges) and then mounted: set on generated standoffs on the
// floor, turned so it fits, and pushed against the walls its ports go through.
// Each mutating function edits a spec draft in place (useBoxBuilder's `edit`).

import {
  PCB_THICKNESS,
  PORT_TYPES,
  boardEdgeWall,
  boardFootprint,
  boxDimensions,
  clampBoardPosition,
  nextId,
  roundMm,
  wallInnerHalf
} from "./boxSpec.js";

// Space left between a board edge and the inside of a wall.
export const BOARD_WALL_GAP = 1;
// Room left above the tallest part when the box is grown to fit a board.
const HEADROOM = 1;

export const PORT_TYPE_IDS = Object.freeze(Object.keys(PORT_TYPES));

function port(type, edge, offset, extra = {}) {
  const { shape, width, height, radius, elevation } = PORT_TYPES[type];
  return { type, edge, offset, elevation, shape, width, height, radius, overhang: 0, margin: 0.5, ...extra };
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
  return {
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
    mounted: false,
    x: 0,
    y: 0,
    rotation: 0
  };
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

// Switching a port's type takes that connector's body size.
export function setPortType(target, type) {
  const defaults = PORT_TYPES[type] || PORT_TYPES.custom;
  Object.assign(target, {
    type: PORT_TYPES[type] ? type : "custom",
    shape: defaults.shape,
    width: defaults.width,
    height: defaults.height,
    radius: defaults.radius,
    elevation: defaults.elevation
  });
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
  const [sizeX, sizeY] = boardFootprint(board);
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
    const [sizeX, sizeY] = boardFootprint({ ...board, rotation });
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
  const [sizeX, sizeY] = boardFootprint(board);
  const gaps = boardWallGaps(draft, board);
  const inside = (size, low, high) => size + (gaps[low] ?? BOARD_WALL_GAP) + (gaps[high] ?? BOARD_WALL_GAP);
  const up = (value) => Math.ceil(value * 2 - 1e-6) / 2;
  const wall = draft.walls.thickness;
  draft.walls.enabled = true;
  draft.base.width = Math.min(500, Math.max(draft.base.width, up(inside(sizeX, "left", "right") + 2 * wall)));
  draft.base.depth = Math.min(500, Math.max(draft.base.depth, up(inside(sizeY, "front", "back") + 2 * wall)));
  const tallestPort = Math.max(0, ...board.ports.map((entry) => entry.elevation + entry.height + entry.margin));
  const lip = draft.lid.enabled && draft.lid.lip ? draft.lid.lipHeight : 0;
  const height = board.clearance + board.thickness + Math.max(board.componentHeight, tallestPort) + HEADROOM + lip;
  draft.walls.height = Math.min(500, Math.max(draft.walls.height, up(height)));
  if (board.mounted) {
    placeBoard(draft, board);
  }
}
