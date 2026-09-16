// Box builder: spec -> CSG plan. The plan is the single description of the
// geometry: the browser preview evaluates it with manifold, and cadgen evaluates
// the very same tree with build123d (cadgen.box_csg) for the STEP/STL/3MF files.
// Grammar: packages/cadgen/src/cadgen/box_plan.py.

import { engravingIslands, engravingStrokes, strokeOutline } from "./engraving.js";
import {
  CLAMP_BAR,
  boardClampPostPoints,
  boardClampSpan,
  boardHolePoints,
  boardPortCutout,
  boardRailHeight,
  boardRailRect,
  boxDimensions,
  clampStemLength,
  faceFrame,
  isWallFace,
  lidScrewAnchor,
  lidScrewPoints,
  lidScrewStepCentre,
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

// Ribs under a mounted board: as tall as its clearance unless the rib says
// otherwise, so the board rests on them.
function boardRailNodes(board, dims) {
  return (board.rails || []).map((rail) => {
    const height = boardRailHeight(board, rail);
    if (height <= 0) {
      return null;
    }
    const rect = boardRailRect(board, rail);
    return roundedPrism(rect.sizeX, rect.sizeY, height + FUSE_OVERLAP, 0, {
      rot: [0, 0, board.rotation],
      pos: [rect.x, rect.y, dims.floorTop - FUSE_OVERLAP]
    });
  }).filter(Boolean);
}

// The screw posts a clamped board's T piece is screwed onto.
function boardClampPostNodes(board, dims) {
  return padNodes(
    boardClampPostPoints(board),
    { outerDiameter: board.clampDiameter, holeDiameter: board.clampBore, height: board.clampHeight },
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
      const piece = { board, x, span, length: span + board.clampDiameter, stem, width: CLAMP_BAR + stem };
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
  const screw = board.clampBore > 0 ? Math.min(board.clampBore + CLAMP_SCREW_PLAY, CLAMP_DEPTH - 2) : 0;
  const holes = screw > 0
    ? [-1, 1].map((side) => cylinder(screw / 2, CLAMP_BAR + 2 * CUT_MARGIN, {
      rot: [0, 90, 0],
      pos: [-CUT_MARGIN, side * piece.span / 2, CLAMP_DEPTH / 2]
    }))
    : [];
  return group([difference(body, holes)], { pos: [piece.x, 0, 0] });
}

// How much a lid screw boss's taper narrows per step; each step is as tall as
// the boss's far edge retreats, so the underside stays at 45 degrees.
const SCREW_TAPER_STEP = 0.25;
const SCREW_TAPER_MIN_RADIUS = 0.5;

// A post under each lid screw, its top flush with the wall top and `screwDepth`
// tall, with a pilot hole down it. A post standing against a wall is fused to it,
// and cylinders that shrink into that wall (or corner) step by step taper its
// underside to 45 degrees, so it prints without supports; one standing free of
// the walls has nothing to hang from, so it carries on down to the floor.
function lidScrewBossNodes(dims) {
  const radius = dims.screwDiameter / 2;
  const bossBottom = Math.max(dims.wallTop - dims.screwDepth, dims.floorTop);
  const stepHeight = SCREW_TAPER_STEP * (1 + Math.SQRT2);
  return lidScrewPoints(dims).map((point) => {
    const anchor = lidScrewAnchor(dims, point);
    const [x, y] = lidScrewStepCentre(dims, point, radius);
    const pieces = [cylinder(radius, dims.wallTop - bossBottom, { pos: [x, y, bossBottom] })];
    if (!anchor.x && !anchor.y) {
      pieces.push(cylinder(radius, bossBottom - dims.floorTop + FUSE_OVERLAP, { pos: [x, y, dims.floorTop - FUSE_OVERLAP] }));
    }
    let top = bossBottom;
    let stepRadius = radius;
    while (
      (anchor.x || anchor.y) &&
      stepRadius - SCREW_TAPER_STEP >= SCREW_TAPER_MIN_RADIUS - 1e-9 &&
      top > dims.floorTop + 1e-6
    ) {
      stepRadius -= SCREW_TAPER_STEP;
      const bottom = Math.max(top - stepHeight, dims.floorTop - FUSE_OVERLAP);
      const [stepX, stepY] = lidScrewStepCentre(dims, point, stepRadius);
      pieces.push(cylinder(stepRadius, top - bottom + FUSE_OVERLAP, { pos: [stepX, stepY, bottom] }));
      top = bottom;
    }
    const pilot = cylinder(dims.screwPilot / 2, dims.wallTop - bossBottom + CUT_MARGIN, { pos: [x, y, bossBottom] });
    return difference(union(pieces), [pilot]);
  });
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
  return union([shell, ...standoffs, ...boardSupports, ...lidScrewBossNodes(dims), ...clamps]);
}

// The drawing as solids `height` tall standing on z = 0: each filled island less
// the holes in it, and each drawn line as a chain of rounded slots as wide as the
// pen. Slots, rather than an outline of the line, because an outline that turns
// sharply crosses itself and the kernel then refuses the part.
function engravingShapes(engraving, height) {
  const prism = (points) => ({
    type: "poly",
    points: points.map(([x, y]) => [tidy(x), tidy(y)]),
    h: tidy(height)
  });
  const islands = engravingIslands(engraving)
    .map((island) => difference(prism(island.outline), island.holes.map(prism)));
  const grooves = engravingStrokes(engraving).flatMap((line) => {
    // The groove as one shape along the line, when an honest outline comes out of
    // it; a line that bends tighter than its own pen is cut as slots instead.
    const drawn = strokeOutline(line.points, line.width, line.closed);
    if (drawn) {
      return [difference(prism(drawn.outline), drawn.hole ? [prism(drawn.hole)] : [])];
    }
    const steps = line.closed ? line.points.length : line.points.length - 1;
    const slots = [];
    for (let index = 0; index < steps; index += 1) {
      const [fromX, fromY] = line.points[index];
      const [toX, toY] = line.points[(index + 1) % line.points.length];
      const span = Math.hypot(toX - fromX, toY - fromY);
      if (span < 1e-6) {
        continue;
      }
      slots.push(roundedPrism(span + line.width, line.width, height, line.width / 2, {
        rot: [0, 0, (Math.atan2(toY - fromY, toX - fromX) * 180) / Math.PI],
        pos: [(fromX + toX) / 2, (fromY + toY) / 2, 0]
      }));
    }
    return slots;
  });
  return [...islands, ...grooves];
}

// The engraving, cut into the top of the lid. A cut as deep as the lid goes
// right through it.
export function engravingCutters(engraving, dims) {
  if (!engraving) {
    return [];
  }
  const through = engraving.depth >= dims.lidThickness - 1e-9;
  const height = through ? dims.lidThickness + 2 * CUT_MARGIN : engraving.depth + CUT_MARGIN;
  const bottom = through ? dims.wallTop - CUT_MARGIN : dims.lidTop - engraving.depth;
  const shapes = engravingShapes(engraving, height);
  return shapes.length ? [group(shapes, { pos: [0, 0, bottom] })] : [];
}

// The piece that fills the engraving, when it is an inlay: the same islands,
// standing in the recess. It is a part of its own, so it can be printed in
// another colour and lands in the slicer already in place.
function inlayPlan(spec, dims) {
  const engraving = spec.lid.engraving;
  if (!dims.lidEnabled || engraving?.mode !== "inlay") {
    return null;
  }
  const height = Math.min(engraving.depth, dims.lidThickness);
  return group(engravingShapes(engraving, height), { pos: [0, 0, dims.lidTop - height] });
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
    // The lip steps round each screw boss, with the lid's clearance.
    const bossCutters = lidScrewPoints(dims).map((point) => {
      const [x, y] = lidScrewStepCentre(dims, point, dims.screwDiameter / 2);
      return cylinder(
        dims.screwDiameter / 2 + dims.clearance,
        ringHeight + 2 * CUT_MARGIN,
        { pos: [x, y, bottom - CUT_MARGIN] }
      );
    });
    lip = difference(
      roundedPrism(dims.lipWidth, dims.lipDepth, ringHeight, dims.lipRadius, { pos: [0, 0, bottom] }),
      [roundedPrism(
        dims.lipWidth - 2 * dims.lipThickness,
        dims.lipDepth - 2 * dims.lipThickness,
        ringHeight + 2 * CUT_MARGIN,
        Math.max(dims.lipRadius - dims.lipThickness, 0),
        { pos: [0, 0, bottom - CUT_MARGIN] }
      ), ...bossCutters]
    );
  }
  const engravingCuts = engravingCutters(spec.lid.engraving, dims);
  const screwHoles = lidScrewPoints(dims).map((point) => {
    const [x, y] = lidScrewStepCentre(dims, point, dims.screwDiameter / 2);
    return cylinder(
      dims.screwHole / 2,
      dims.lidThickness + 2 * CUT_MARGIN,
      { pos: [x, y, dims.wallTop - CUT_MARGIN] }
    );
  });
  const cutters = [
    ...spec.holes.filter((hole) => hole.face === "lid").map((hole) => holeCutter(hole, dims)),
    ...screwHoles,
    ...engravingCuts
  ];
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
  let inlay = inlayPlan(spec, dims);
  if (layout === "print") {
    // The inlay turns over with the lid, so the two still meet on the bed.
    const turn = { rot: [180, 0, 0], pos: [0, 0, dims.lidTop] };
    lid = lid ? group([lid], turn) : lid;
    inlay = inlay ? group([inlay], turn) : inlay;
  }
  return { base, lid, inlay, dims };
}

// The polygon points a plan spends: cadgen refuses more than PLAN_POINT_LIMIT.
export const PLAN_POINT_LIMIT = 6000;

export function countPlanPoints(node) {
  if (!node) {
    return 0;
  }
  return (node.points?.length || 0) + (node.children || []).reduce((total, child) => total + countPlanPoints(child), 0);
}

export function countPlanNodes(node) {
  if (!node) {
    return 0;
  }
  return 1 + (node.children || []).reduce((total, child) => total + countPlanNodes(child), 0);
}
