// Box builder: edits on the selected hole, standoff group or board. Each mutating
// function edits a spec draft in place (the shape useBoxBuilder's `edit` hands
// out); planArray only reports where an array's copies would go.

import {
  MAX_BOARDS,
  MAX_HOLES,
  MAX_STANDOFF_GROUPS,
  boxDimensions,
  clampBoardPosition,
  clampHolePosition,
  clampStandoffPosition,
  holeHalfExtents,
  isWallFace,
  nextId,
  roundMm,
  standoffPoints
} from "./boxSpec.js";

// u/v are the face's axes: X/Y on the floor, the lid and for standoffs; along the
// wall and up the wall for a wall hole.
export const ARRAY_DIRECTIONS = Object.freeze(["+u", "-u", "+v", "-v"]);
export const ARRAY_MODES = Object.freeze(["count", "fill", "even"]);
const MAX_ARRAY_COPIES = 100;
const EPSILON = 1e-6;

function listFor(spec, selection) {
  if (selection?.kind === "hole") {
    return spec.holes;
  }
  if (selection?.kind === "standoff") {
    return spec.standoffs;
  }
  if (selection?.kind === "board") {
    return spec.boards;
  }
  return null;
}

export function findSelected(spec, selection) {
  return listFor(spec, selection)?.find((item) => item.id === selection.id) || null;
}

export function removeSelected(draft, selection) {
  if (selection?.kind === "hole") {
    draft.holes = draft.holes.filter((hole) => hole.id !== selection.id);
  } else if (selection?.kind === "standoff") {
    draft.standoffs = draft.standoffs.filter((group) => group.id !== selection.id);
  } else if (selection?.kind === "board") {
    draft.boards = draft.boards.filter((board) => board.id !== selection.id);
  }
}

// Returns the selection for the copy, or null.
export function duplicateSelected(draft, selection) {
  const list = listFor(draft, selection);
  const index = list ? list.findIndex((item) => item.id === selection.id) : -1;
  if (index < 0) {
    return null;
  }
  const dims = boxDimensions(draft);
  const source = list[index];
  if (selection.kind === "hole") {
    const copy = { ...source, id: nextId("hole", draft.holes) };
    Object.assign(copy, clampHolePosition(dims, copy, copy.u + Math.max(copy.width, 4) + 2, copy.v));
    draft.holes.splice(index + 1, 0, copy);
    return { kind: "hole", id: copy.id };
  }
  if (selection.kind === "board") {
    if (draft.boards.length >= MAX_BOARDS) {
      return null;
    }
    const copy = { ...JSON.parse(JSON.stringify(source)), id: nextId("board", draft.boards) };
    if (copy.mounted) {
      Object.assign(copy, clampBoardPosition(dims, copy, copy.x + 10, copy.y + 10));
    }
    draft.boards.splice(index + 1, 0, copy);
    return { kind: "board", id: copy.id };
  }
  const copy = { ...source, id: nextId("standoff", draft.standoffs) };
  const offset = copy.outerDiameter + 4;
  Object.assign(copy, clampStandoffPosition(dims, copy, copy.x + offset, copy.y + offset));
  draft.standoffs.splice(index + 1, 0, copy);
  return { kind: "standoff", id: copy.id };
}

export function centerSelected(draft, selection) {
  const item = findSelected(draft, selection);
  if (!item) {
    return;
  }
  const dims = boxDimensions(draft);
  if (selection.kind === "board") {
    Object.assign(item, clampBoardPosition(dims, item, 0, 0));
    return;
  }
  if (selection.kind === "standoff") {
    item.x = 0;
    item.y = 0;
    return;
  }
  item.u = 0;
  item.v = isWallFace(item.face) ? roundMm(dims.floorTop + dims.wallHeight / 2, 2) : 0;
}

export function nudgeSelected(draft, selection, deltaU, deltaV) {
  const item = findSelected(draft, selection);
  if (!item) {
    return;
  }
  const dims = boxDimensions(draft);
  if (selection.kind === "board") {
    Object.assign(item, clampBoardPosition(dims, item, item.x + deltaU, item.y + deltaV));
  } else if (selection.kind === "standoff") {
    Object.assign(item, clampStandoffPosition(dims, item, item.x + deltaU, item.y + deltaV));
  } else {
    Object.assign(item, clampHolePosition(dims, item, item.u + deltaU, item.v + deltaV));
  }
}

// --- arrays --------------------------------------------------------------------

// Where the centre of a copy may go so that the whole element stays in place:
// a floor hole inside the cavity, a wall hole on the flat of its wall between
// the floor and the wall top, a lid hole inside the lip, standoff pads inside
// the walls. Returns { u: [min, max], v: [min, max] } in the item's own coordinates.
export function arrayBounds(spec, selection) {
  const item = findSelected(spec, selection);
  if (!item || selection.kind === "board") {
    return null;
  }
  const dims = boxDimensions(spec);
  if (selection.kind === "standoff") {
    const radius = item.outerDiameter / 2;
    let extentU = 0;
    let extentV = 0;
    for (const [x, y] of standoffPoints(item)) {
      extentU = Math.max(extentU, Math.abs(x - item.x) + radius);
      extentV = Math.max(extentV, Math.abs(y - item.y) + radius);
    }
    const halfU = dims.innerWidth / 2 - extentU;
    const halfV = dims.innerDepth / 2 - extentV;
    return { u: [-halfU, halfU], v: [-halfV, halfV] };
  }
  const [halfWidth, halfHeight] = holeHalfExtents(item);
  if (isWallFace(item.face)) {
    const flat = (item.face === "front" || item.face === "back" ? dims.width : dims.depth) / 2 - dims.radius;
    return {
      u: [-(flat - halfWidth), flat - halfWidth],
      v: [dims.floorTop + halfHeight, dims.wallTop - halfHeight]
    };
  }
  const inLip = item.face === "lid" && dims.lipEnabled;
  const spanU = inLip ? dims.lipWidth / 2 - dims.lipThickness : dims.innerWidth / 2;
  const spanV = inLip ? dims.lipDepth / 2 - dims.lipThickness : dims.innerDepth / 2;
  return {
    u: [-(spanU - halfWidth), spanU - halfWidth],
    v: [-(spanV - halfHeight), spanV - halfHeight]
  };
}

// Where an array's copies of the selected item go, the item itself excluded.
//   count: `count` copies, `step` apart; copies past the edge are skipped
//   fill:  as many copies `step` apart as fit before the edge
//   even:  `count` elements in the row, the item included, spread evenly from
//          the item to the edge
export function planArray(spec, selection, { direction = "+u", mode = "count", count = 1, step = 10 } = {}) {
  const item = findSelected(spec, selection);
  const bounds = item ? arrayBounds(spec, selection) : null;
  if (!item || !bounds) {
    return { positions: [], skipped: 0, spacing: 0 };
  }
  const keys = selection.kind === "standoff" ? ["x", "y"] : ["u", "v"];
  const axis = String(direction).endsWith("v") ? 1 : 0;
  const sign = String(direction).startsWith("-") ? -1 : 1;
  const start = [item[keys[0]], item[keys[1]]];
  const range = axis === 0 ? bounds.u : bounds.v;
  const room = sign > 0 ? range[1] - start[axis] : start[axis] - range[0];
  const fits = ([u, v]) => (
    u >= bounds.u[0] - EPSILON && u <= bounds.u[1] + EPSILON &&
    v >= bounds.v[0] - EPSILON && v <= bounds.v[1] + EPSILON
  );

  const distances = [];
  let spacing = 0;
  if (mode === "fill") {
    const size = Math.max(Number(step) || 0, 0.1);
    for (let k = 1; k <= MAX_ARRAY_COPIES && k * size <= room + EPSILON; k += 1) {
      distances.push(k * size);
    }
  } else if (mode === "even") {
    const total = Math.min(Math.max(Math.round(Number(count) || 2), 2), MAX_ARRAY_COPIES + 1);
    if (room <= EPSILON) {
      return { positions: [], skipped: total - 1, spacing: 0 };
    }
    spacing = room / (total - 1);
    for (let k = 1; k < total; k += 1) {
      distances.push(k * spacing);
    }
  } else {
    const copies = Math.min(Math.max(Math.round(Number(count) || 1), 1), MAX_ARRAY_COPIES);
    const size = Math.max(Number(step) || 0, 0.1);
    for (let k = 1; k <= copies; k += 1) {
      distances.push(k * size);
    }
  }

  let positions = [];
  let skipped = 0;
  for (const distance of distances) {
    const point = [start[0], start[1]];
    point[axis] += sign * distance;
    if (fits(point)) {
      positions.push(point.map((value) => roundMm(value, 3)));
    } else {
      skipped += 1;
    }
  }
  const capacity = Math.max(
    selection.kind === "hole" ? MAX_HOLES - spec.holes.length : MAX_STANDOFF_GROUPS - spec.standoffs.length,
    0
  );
  if (positions.length > capacity) {
    skipped += positions.length - capacity;
    positions = positions.slice(0, capacity);
  }
  return { positions, skipped, spacing: roundMm(spacing, 3) };
}

// Adds the planned copies right after the source item. Returns how many were added.
export function applyArray(draft, selection, options) {
  const { positions } = planArray(draft, selection, options);
  const list = listFor(draft, selection);
  const index = list ? list.findIndex((item) => item.id === selection.id) : -1;
  if (index < 0 || !positions.length) {
    return 0;
  }
  const source = list[index];
  const prefix = selection.kind === "hole" ? "hole" : "standoff";
  const keys = selection.kind === "standoff" ? ["x", "y"] : ["u", "v"];
  const copies = [];
  for (const [first, second] of positions) {
    copies.push({ ...source, id: nextId(prefix, [...list, ...copies]), [keys[0]]: first, [keys[1]]: second });
  }
  list.splice(index + 1, 0, ...copies);
  return copies.length;
}
