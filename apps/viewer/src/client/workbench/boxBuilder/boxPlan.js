// Box builder: spec -> CSG plan. The plan is the single description of the
// geometry: the browser preview evaluates it with manifold, and cadgen evaluates
// the very same tree with build123d (cadgen.box_csg) for the STEP/STL/3MF files.
// Grammar: packages/cadgen/src/cadgen/box_plan.py.

import { boxDimensions, faceFrame, isWallFace, roundMm, standoffPoints } from "./boxSpec.js";

// How far a cutter reaches past the surface it cuts, so no boolean ever works
// on two coincident faces.
const CUT_MARGIN = 1;
// How far a pad sinks into what it stands on, for the same reason.
const FUSE_OVERLAP = 0.01;

const WALL_ROTATIONS = Object.freeze({
  front: [90, 0, 0],
  back: [90, 0, 180],
  right: [90, 0, 90],
  left: [90, 0, -90]
});

function tidy(value) {
  return roundMm(value, 4);
}

function withPlacement(node, { pos, rot } = {}) {
  if (rot && rot.some((angle) => Math.abs(angle) > 1e-9)) {
    node.rot = rot.map(tidy);
  }
  if (pos && pos.some((offset) => Math.abs(offset) > 1e-9)) {
    node.pos = pos.map(tidy);
  }
  return node;
}

export function roundedPrism(width, depth, height, radius, placement) {
  const limit = Math.min(width, depth) / 2;
  return withPlacement({
    type: "rrect",
    w: tidy(width),
    d: tidy(depth),
    h: tidy(height),
    r: tidy(Math.min(Math.max(radius, 0), limit))
  }, placement);
}

function cylinder(radius, height, placement) {
  return withPlacement({ type: "cyl", r: tidy(radius), h: tidy(height) }, placement);
}

function group(children, placement) {
  const list = children.filter(Boolean);
  if (!list.length) {
    return null;
  }
  return withPlacement({ type: "union", children: list }, placement);
}

function union(children) {
  const list = children.filter(Boolean);
  if (list.length <= 1) {
    return list[0] || null;
  }
  return { type: "union", children: list };
}

function difference(body, cutters) {
  const list = cutters.filter(Boolean);
  if (!body || !list.length) {
    return body;
  }
  return { type: "difference", children: [body, ...list] };
}

// A hexagon measured across its flats (the spanner size).
function hexagonPoints(acrossFlats) {
  const circumradius = acrossFlats / Math.sqrt(3);
  return Array.from({ length: 6 }, (_, index) => {
    const angle = (Math.PI / 3) * index;
    return [tidy(circumradius * Math.cos(angle)), tidy(circumradius * Math.sin(angle))];
  });
}

// The hole's outline extruded along local +Z from z = 0 to z = depth, turned in
// its own plane by the hole's rotation.
function holeProfile(hole, depth, bottom) {
  let node;
  if (hole.shape === "circle") {
    node = cylinder(hole.width / 2, depth);
  } else if (hole.shape === "hex") {
    node = { type: "poly", points: hexagonPoints(hole.width), h: tidy(depth) };
  } else if (hole.shape === "slot") {
    node = roundedPrism(hole.width, hole.height, depth, Math.min(hole.width, hole.height) / 2);
  } else {
    node = roundedPrism(hole.width, hole.height, depth, hole.radius);
  }
  return group([node], { rot: [0, 0, hole.rotation], pos: [0, 0, bottom] });
}

function holeCutter(hole, dims) {
  if (hole.face === "floor") {
    return group(
      [holeProfile(hole, dims.floorThickness + 2 * CUT_MARGIN, -CUT_MARGIN)],
      { pos: [hole.u, hole.v, 0] }
    );
  }
  if (hole.face === "lid") {
    const bottom = dims.wallTop - (dims.lipEnabled ? dims.lipHeight : 0) - CUT_MARGIN;
    const top = dims.lidTop + CUT_MARGIN;
    return group([holeProfile(hole, top - bottom, 0)], { pos: [hole.u, hole.v, bottom] });
  }
  // Walls: built in local coordinates (u = X, v = Y, outward = +Z, outer surface
  // at z = 0) and turned onto the wall.
  const frame = faceFrame(dims, hole.face);
  const depth = dims.wallThickness + 2 * CUT_MARGIN;
  const position = [0, 1, 2].map((axis) => (
    frame.origin[axis] + frame.u[axis] * hole.u + frame.v[axis] * hole.v
  ));
  return group(
    [holeProfile(hole, depth, -(dims.wallThickness + CUT_MARGIN))],
    { rot: WALL_ROTATIONS[hole.face], pos: position }
  );
}

function standoffNodes(groupSpec, dims) {
  return standoffPoints(groupSpec).map(([x, y]) => {
    const pad = cylinder(
      groupSpec.outerDiameter / 2,
      groupSpec.height + FUSE_OVERLAP,
      { pos: [x, y, dims.floorTop - FUSE_OVERLAP] }
    );
    if (groupSpec.holeDiameter <= 0) {
      return pad;
    }
    const bore = cylinder(
      groupSpec.holeDiameter / 2,
      groupSpec.height + CUT_MARGIN,
      { pos: [x, y, dims.floorTop] }
    );
    return difference(pad, [bore]);
  });
}

function basePlan(spec, dims) {
  const body = roundedPrism(dims.width, dims.depth, dims.wallsEnabled ? dims.wallTop : dims.floorThickness, dims.radius);
  const cavity = dims.wallsEnabled
    ? roundedPrism(
      dims.innerWidth,
      dims.innerDepth,
      dims.wallHeight + CUT_MARGIN,
      dims.innerRadius,
      { pos: [0, 0, dims.floorTop] }
    )
    : null;
  const cutters = spec.holes
    .filter((hole) => hole.face === "floor" || (isWallFace(hole.face) && dims.wallsEnabled))
    .map((hole) => holeCutter(hole, dims));
  const shell = difference(body, [cavity, ...cutters]);
  const standoffs = spec.standoffs.flatMap((groupSpec) => standoffNodes(groupSpec, dims));
  return union([shell, ...standoffs]);
}

function lidPlan(spec, dims) {
  if (!dims.lidEnabled) {
    return null;
  }
  const plate = roundedPrism(dims.width, dims.depth, dims.lidThickness, dims.radius, { pos: [0, 0, dims.wallTop] });
  let lip = null;
  if (dims.lipEnabled && dims.lipWidth > 2 * dims.lipThickness && dims.lipDepth > 2 * dims.lipThickness) {
    const bottom = dims.wallTop - dims.lipHeight;
    const ringHeight = dims.lipHeight + dims.lidThickness / 2;
    lip = difference(
      roundedPrism(dims.lipWidth, dims.lipDepth, ringHeight, dims.lipRadius, { pos: [0, 0, bottom] }),
      [roundedPrism(
        dims.lipWidth - 2 * dims.lipThickness,
        dims.lipDepth - 2 * dims.lipThickness,
        ringHeight + 2 * CUT_MARGIN,
        Math.max(dims.lipRadius - dims.lipThickness, 0),
        { pos: [0, 0, bottom - CUT_MARGIN] }
      )]
    );
  }
  const cutters = spec.holes
    .filter((hole) => hole.face === "lid")
    .map((hole) => holeCutter(hole, dims));
  return difference(union([plate, lip]), cutters);
}

// `layout: "assembled"` keeps both parts where they sit on the closed box (for the
// preview); `layout: "print"` turns the lid over so its plate lies on the bed.
export function buildBoxPlan(spec, { layout = "assembled" } = {}) {
  const dims = boxDimensions(spec);
  const base = basePlan(spec, dims);
  let lid = lidPlan(spec, dims);
  if (lid && layout === "print") {
    lid = group([lid], { rot: [180, 0, 0], pos: [0, 0, dims.lidTop] });
  }
  return { base, lid, dims };
}

export function countPlanNodes(node) {
  if (!node) {
    return 0;
  }
  return 1 + (node.children || []).reduce((total, child) => total + countPlanNodes(child), 0);
}
