// Box builder: spec -> CSG plan. The plan is the single description of the
// geometry: the browser preview evaluates it with manifold, and cadgen evaluates
// the very same tree with build123d (cadgen.box_csg) for the STEP/STL/3MF files.
// Grammar: packages/cadgen/src/cadgen/box_plan.py.

import {
  CLAMP_BAR,
  boardClampPostPoints,
  boardClampSpan,
  boardHolePoints,
  boardPortCutout,
  boardRailRect,
  boxDimensions,
  clampStemLength,
  faceFrame,
  isWallFace,
  roundMm,
  standoffPoints
} from "./boxSpec.js";

// The most nodes cadgen.box_plan accepts in one save (base and lid together).
export const PLAN_NODE_LIMIT = 1000;

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

// `reach` is how deep a wall cutter goes in from the outside: the wall itself, or
// further, through the lid's lip that stands inside it.
function holeCutter(hole, dims, reach = dims.wallThickness) {
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
  const depth = reach + 2 * CUT_MARGIN;
  const position = [0, 1, 2].map((axis) => (
    frame.origin[axis] + frame.u[axis] * hole.u + frame.v[axis] * hole.v
  ));
  return group(
    [holeProfile(hole, depth, -(reach + CUT_MARGIN))],
    { rot: WALL_ROTATIONS[hole.face], pos: position }
  );
}

function padNodes(points, { outerDiameter, holeDiameter, height }, dims) {
  return points.map(([x, y]) => {
    const pad = cylinder(outerDiameter / 2, height + FUSE_OVERLAP, { pos: [x, y, dims.floorTop - FUSE_OVERLAP] });
    if (holeDiameter <= 0) {
      return pad;
    }
    const bore = cylinder(holeDiameter / 2, height + CUT_MARGIN, { pos: [x, y, dims.floorTop] });
    return difference(pad, [bore]);
  });
}

function standoffNodes(groupSpec, dims) {
  return padNodes(standoffPoints(groupSpec), groupSpec, dims);
}

// A mounted board stands on one pad under each of its holes, as tall as its
// clearance above the floor; with no clearance it lies on the floor itself.
function boardStandoffNodes(board, dims) {
  if (board.clearance <= 0) {
    return [];
  }
  return padNodes(
    boardHolePoints(board),
    { outerDiameter: board.padDiameter, holeDiameter: board.boreDiameter, height: board.clearance },
    dims
  );
}

// Ribs under a mounted board, as tall as its clearance: it rests on them.
function boardRailNodes(board, dims) {
  if (board.clearance <= 0) {
    return [];
  }
  return (board.rails || []).map((rail) => {
    const rect = boardRailRect(board, rail);
    return roundedPrism(rect.sizeX, rect.sizeY, board.clearance + FUSE_OVERLAP, 0, {
      rot: [0, 0, board.rotation],
      pos: [rect.x, rect.y, dims.floorTop - FUSE_OVERLAP]
    });
  });
}

// The screw posts a clamped board's T piece is screwed onto.
function boardClampPostNodes(board, dims) {
  return padNodes(
    boardClampPostPoints(board),
    { outerDiameter: board.padDiameter, holeDiameter: board.boreDiameter, height: board.clampHeight },
    dims
  );
}

// The T piece lies flat on the bed, `CLAMP_DEPTH` tall.
export const CLAMP_DEPTH = 10;
const CLAMP_STEM_WIDTH = 4;
const CLAMP_PRINT_GAP = 5;
// A screw passes freely through the T's bar into the post's bore.
const CLAMP_SCREW_PLAY = 0.8;

// The T pieces of the clamped boards, side by side on the bed to the right of the
// box: where each starts along X, how wide it lies (bar plus stem) and its sizes.
export function clampPieces(spec, dims) {
  let x = dims.width / 2 + CLAMP_PRINT_GAP;
  return spec.boards
    .filter((board) => board.mounted && board.clamp)
    .map((board) => {
      const span = boardClampSpan(board);
      const stem = Math.max(clampStemLength(board), 0);
      const piece = { board, x, span, length: span + board.padDiameter, stem, width: CLAMP_BAR + stem };
      x += piece.width + CLAMP_PRINT_GAP;
      return piece;
    });
}

// Seen from above as it prints: the bar along Y at X 0..CLAMP_BAR with a screw hole
// through it over each post, the stem out along +X. In the box the bar lies across
// the post tops and the stem hangs down onto the middle of the board.
function clampPieceNode(piece) {
  const { board } = piece;
  const half = piece.length / 2;
  const stemHalf = CLAMP_STEM_WIDTH / 2;
  const tip = CLAMP_BAR + piece.stem;
  const points = piece.stem > 0.05
    ? [[0, -half], [CLAMP_BAR, -half], [CLAMP_BAR, -stemHalf], [tip, -stemHalf], [tip, stemHalf], [CLAMP_BAR, stemHalf], [CLAMP_BAR, half], [0, half]]
    : [[0, -half], [CLAMP_BAR, -half], [CLAMP_BAR, half], [0, half]];
  const body = { type: "poly", points: points.map(([x, y]) => [tidy(x), tidy(y)]), h: CLAMP_DEPTH };
  const screw = board.boreDiameter > 0 ? Math.min(board.boreDiameter + CLAMP_SCREW_PLAY, CLAMP_DEPTH - 2) : 0;
  const holes = screw > 0
    ? [-1, 1].map((side) => cylinder(screw / 2, CLAMP_BAR + 2 * CUT_MARGIN, {
      rot: [0, 90, 0],
      pos: [-CUT_MARGIN, side * piece.span / 2, CLAMP_DEPTH / 2]
    }))
    : [];
  return group([difference(body, holes)], { pos: [piece.x, 0, 0] });
}

// Wall cut-outs for the ports of every mounted board.
export function boardPortCutouts(spec, dims) {
  if (!dims.wallsEnabled) {
    return [];
  }
  return spec.boards
    .filter((board) => board.mounted)
    .flatMap((board) => board.ports.map((port) => boardPortCutout(dims, board, port)));
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
  const portCutters = boardPortCutouts(spec, dims).map((cutout) => holeCutter(cutout, dims));
  const shell = difference(body, [cavity, ...cutters, ...portCutters]);
  const standoffs = spec.standoffs.flatMap((groupSpec) => standoffNodes(groupSpec, dims));
  const mounted = spec.boards.filter((board) => board.mounted);
  const boardSupports = mounted.flatMap((board) => [
    ...boardStandoffNodes(board, dims),
    ...boardRailNodes(board, dims),
    ...boardClampPostNodes(board, dims)
  ]);
  const clamps = clampPieces(spec, dims).map(clampPieceNode);
  return union([shell, ...standoffs, ...boardSupports, ...clamps]);
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
  // A port cut-out that reaches up into the lip's band goes through the lip too,
  // or the closed lid would cover the connector from the inside.
  const lipBottom = dims.wallTop - dims.lipHeight;
  const lipCutters = lip
    ? boardPortCutouts(spec, dims)
      .filter((cutout) => cutout.v + cutout.height / 2 > lipBottom)
      .map((cutout) => holeCutter(cutout, dims, dims.wallThickness + dims.clearance + dims.lipThickness))
    : [];
  return difference(union([plate, lip]), [...cutters, ...lipCutters]);
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
