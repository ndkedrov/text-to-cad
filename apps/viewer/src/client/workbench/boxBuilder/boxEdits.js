// Box builder: edits on the selected hole or standoff group. Each function
// mutates a spec draft in place (the shape useBoxBuilder's `edit` hands out).

import {
  boxDimensions,
  clampHolePosition,
  clampStandoffPosition,
  isWallFace,
  nextId,
  roundMm
} from "./boxSpec.js";

function listFor(spec, selection) {
  if (selection?.kind === "hole") {
    return spec.holes;
  }
  if (selection?.kind === "standoff") {
    return spec.standoffs;
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
  if (selection.kind === "standoff") {
    item.x = 0;
    item.y = 0;
    return;
  }
  const dims = boxDimensions(draft);
  item.u = 0;
  item.v = isWallFace(item.face) ? roundMm(dims.floorTop + dims.wallHeight / 2, 2) : 0;
}

export function nudgeSelected(draft, selection, deltaU, deltaV) {
  const item = findSelected(draft, selection);
  if (!item) {
    return;
  }
  const dims = boxDimensions(draft);
  if (selection.kind === "standoff") {
    Object.assign(item, clampStandoffPosition(dims, item, item.x + deltaU, item.y + deltaV));
  } else {
    Object.assign(item, clampHolePosition(dims, item, item.u + deltaU, item.v + deltaV));
  }
}
