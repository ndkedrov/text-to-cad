import assert from "node:assert/strict";
import test from "node:test";

import { buildBoxPlan } from "./boxPlan.js";
import {
  boxDimensions,
  boxSpecWarnings,
  clampStandoffPosition,
  connectorHole,
  defaultBoxSpec,
  lidScrewPoints,
  lidScrewSink,
  newHole,
  newStandoffGroup,
  normalizeBoxSpec,
  standoffPoints
} from "./boxSpec.js";

function findNodes(node, predicate, found = []) {
  if (!node) {
    return found;
  }
  if (predicate(node)) {
    found.push(node);
  }
  for (const child of node.children || []) {
    findNodes(child, predicate, found);
  }
  return found;
}

test("normalizing clamps impossible values instead of throwing", () => {
  const spec = normalizeBoxSpec({
    base: { width: -5, depth: "abc", thickness: 0, radius: 999 },
    walls: { enabled: true, height: 20, thickness: 500 },
    holes: [{ id: "hole-1" }, { id: "hole-1", face: "nope" }]
  });
  assert.equal(spec.base.width, 10);
  assert.equal(spec.base.depth, 70);
  assert.equal(spec.base.thickness, 0.4);
  assert.equal(spec.base.radius, 5);
  assert.ok(spec.walls.thickness <= 4);
  assert.equal(spec.holes.length, 2);
  assert.notEqual(spec.holes[0].id, spec.holes[1].id);
  assert.equal(spec.holes[1].face, "floor");
});

test("the base is the shell minus the cavity, and the lid rests on the wall top", () => {
  const spec = normalizeBoxSpec(defaultBoxSpec());
  const { base, lid, dims } = buildBoxPlan(spec);
  assert.equal(base.type, "difference");
  assert.deepEqual(base.children[0], { type: "rrect", w: 100, d: 70, h: 32, r: 4 });
  assert.deepEqual(base.children[1].pos, [0, 0, 2]);
  assert.equal(dims.wallTop, 32);
  const plate = findNodes(lid, (node) => node.type === "rrect" && node.w === 100)[0];
  assert.deepEqual(plate.pos, [0, 0, 32]);
  const lipOuter = findNodes(lid, (node) => node.type === "rrect" && node.w === 95.5)[0];
  assert.ok(lipOuter, "lip is inset by wall thickness plus clearance on each side");
});

test("the print layout turns the lid plate-down", () => {
  const spec = normalizeBoxSpec(defaultBoxSpec());
  const { lid } = buildBoxPlan(spec, { layout: "print" });
  assert.deepEqual(lid.rot, [180, 0, 0]);
  assert.deepEqual(lid.pos, [0, 0, 34]);
});

test("a lid needs walls", () => {
  const spec = normalizeBoxSpec({ ...defaultBoxSpec(), walls: { enabled: false, height: 30, thickness: 2 } });
  const { base, lid } = buildBoxPlan(spec);
  assert.equal(lid, null);
  assert.deepEqual(base, { type: "rrect", w: 100, d: 70, h: 2, r: 4 });
});

test("a front-wall hole is turned onto the wall at its height", () => {
  const spec = normalizeBoxSpec(defaultBoxSpec());
  spec.holes.push({ ...newHole(spec, "front"), u: 10, v: 12 });
  const { base } = buildBoxPlan(spec);
  const cutter = findNodes(base, (node) => Array.isArray(node.rot) && node.rot[0] === 90)[0];
  assert.deepEqual(cutter.rot, [90, 0, 0]);
  assert.deepEqual(cutter.pos, [10, -35, 12]);
});

test("the back wall reads left-to-right as seen from behind", () => {
  const spec = normalizeBoxSpec(defaultBoxSpec());
  spec.holes.push({ ...newHole(spec, "back"), u: 10, v: 12 });
  const { base } = buildBoxPlan(spec);
  const cutter = findNodes(base, (node) => Array.isArray(node.rot) && node.rot[2] === 180)[0];
  assert.deepEqual(cutter.pos, [-10, 35, 12]);
});

test("standoffs stand on the floor top with a bore that stops at the floor", () => {
  const spec = normalizeBoxSpec(defaultBoxSpec());
  spec.standoffs.push({ ...newStandoffGroup(spec), pattern: "triangle", spacingX: 40, spacingY: 20, height: 6 });
  const { base } = buildBoxPlan(spec);
  const pads = findNodes(base, (node) => node.type === "cyl" && node.r === 3);
  const bores = findNodes(base, (node) => node.type === "cyl" && node.r === 1.25);
  assert.equal(pads.length, 3);
  assert.equal(bores.length, 3);
  assert.ok(pads.every((pad) => pad.pos[2] === 1.99));
  assert.ok(bores.every((bore) => bore.pos[2] === 2));
  assert.deepEqual(
    standoffPoints(spec.standoffs[0]),
    [[-20, -10], [20, -10], [0, 10]]
  );
});

test("dragging keeps a standoff group inside the walls", () => {
  const spec = normalizeBoxSpec(defaultBoxSpec());
  const groupSpec = { ...newStandoffGroup(spec), pattern: "line", spacingX: 20 };
  const dims = boxDimensions(spec);
  const clamped = clampStandoffPosition(dims, groupSpec, 500, -500);
  assert.equal(clamped.x, 48 - 13);
  assert.equal(clamped.y, -(33 - 3));
});

test("a connector hole is the connector's body plus a margin, and cuts as its shape", () => {
  assert.deepEqual(connectorHole("usbC"), { connector: "usbC", shape: "rect", width: 10, height: 4.3, radius: 1.7 });
  assert.deepEqual(connectorHole("audio"), { connector: "audio", shape: "circle", width: 7.5, height: 7.5, radius: 0 });
  const spec = normalizeBoxSpec({
    ...defaultBoxSpec(),
    holes: [{ face: "front", u: 0, v: 10, ...connectorHole("rj45") }, { face: "floor", connector: "lightning" }]
  });
  assert.equal(spec.holes[0].connector, "rj45");
  assert.deepEqual([spec.holes[0].width, spec.holes[0].height], [17, 14.5]);
  assert.equal(spec.holes[1].connector, "", "an unknown connector is dropped");
  const { base } = buildBoxPlan(spec);
  assert.equal(findNodes(base, (node) => node.type === "rrect" && node.w === 17 && node.d === 14.5).length, 1);
});

test("a keystone hole is its exact cut-out and needs a thin enough wall", () => {
  assert.deepEqual(connectorHole("keystone"), { connector: "keystone", shape: "rect", width: 14.7, height: 16.4, radius: 0 });
  const spec = normalizeBoxSpec({ ...defaultBoxSpec(), holes: [{ face: "front", u: 0, v: 16, ...connectorHole("keystone") }] });
  const keystoneWarning = () => boxSpecWarnings(spec).find((warning) => warning.key === "warning.keystoneWall");
  assert.deepEqual(keystoneWarning()?.params, { n: 1, thickness: 2 });
  spec.walls.thickness = 1.6;
  assert.equal(keystoneWarning(), undefined);
});

test("lid screws: corner bosses hang from the wall top, and the lid and its lip make room", () => {
  const defaults = defaultBoxSpec();
  const spec = normalizeBoxSpec({ ...defaults, lid: { ...defaults.lid, screws: true, screwDepth: 8 } });
  const dims = boxDimensions(spec);
  const { base, lid } = buildBoxPlan(spec);
  // Inside 96 x 66 with 2 mm inner corners: a 7 mm boss touches both walls, 0.3 mm into them.
  const points = lidScrewPoints(dims);
  assert.deepEqual(points.map(({ x, y }) => [x, y]), [[44.8, 29.8], [-44.8, 29.8], [-44.8, -29.8], [44.8, -29.8]]);
  const posts = findNodes(base, (node) => node.type === "cyl" && node.r === 3.5);
  assert.deepEqual(posts.map((post) => [post.pos, post.h]), points.map(({ x, y }) => [[x, y, 24], 8]));
  // The pilot holes run the boss's 8 mm and 1 mm past its top.
  assert.equal(findNodes(base, (node) => node.type === "cyl" && node.r === 1.25 && node.h === 9).length, 4, "a pilot hole in each");
  const narrowest = findNodes(base, (node) => node.type === "cyl" && node.r === 0.5);
  assert.equal(narrowest.length, 4, "each taper narrows to half a millimetre");
  assert.ok(narrowest.every((step) => step.pos[2] > dims.floorTop), "the taper stays clear of the floor");
  assert.equal(findNodes(lid, (node) => node.type === "cyl" && node.r === 1.7).length, 4, "a hole in the lid over each");
  assert.equal(findNodes(lid, (node) => node.type === "cyl" && node.r === 3.75).length, 4, "the lip steps round each boss");
  assert.deepEqual(boxSpecWarnings(spec), []);
  const tiny = normalizeBoxSpec({ ...spec, base: { ...spec.base, width: 20, depth: 20, radius: 2 }, lid: { ...spec.lid, screwDiameter: 12 } });
  assert.ok(boxSpecWarnings(tiny).some((warning) => warning.key === "warning.lidScrewsTight"));
});

test("a lid screw can be moved along a wall, sunk into it, or stood free of it", () => {
  const defaults = defaultBoxSpec();
  const screwed = (lid) => normalizeBoxSpec({ ...defaults, lid: { ...defaults.lid, screws: true, screwDepth: 8, ...lid } });
  const postOf = (spec) => findNodes(buildBoxPlan(spec).base, (node) => node.type === "cyl" && node.r === 3.5);
  const lidHoleOf = (spec) => findNodes(buildBoxPlan(spec).lid, (node) => node.type === "cyl" && node.r === 1.7);

  // Against the right wall, halfway along it, sunk 1.2 mm into the 2 mm wall.
  const sunk = screwed({ screwInset: 1.2, screwPoints: [{ id: "screw-1", x: 45, y: 0 }] });
  const sunkDims = boxDimensions(sunk);
  assert.equal(lidScrewSink(sunkDims, lidScrewPoints(sunkDims)[0]), 1.2);
  assert.deepEqual(postOf(sunk).map((post) => post.pos), [[46, 0, 24]], "against the wall at 44.8, sunk to 46");
  assert.deepEqual(lidHoleOf(sunk).map((hole) => hole.pos), [[46, 0, 31]], "the hole in the lid follows");
  assert.deepEqual(boxSpecWarnings(sunk), []);

  // Asking for more than the wall has leaves the boss inside the box and says so.
  const deep = screwed({ screwInset: 5, screwPoints: [{ id: "screw-1", x: 45, y: 0 }] });
  assert.deepEqual(postOf(deep).map((post) => post.pos), [[46.5, 0, 24]], "50 mm to the outside, less the 3.5 radius");
  assert.deepEqual(boxSpecWarnings(deep), [{ key: "warning.lidScrewInset", params: { n: 1, sink: 1.7 } }]);

  // Clear of every wall: nothing to hang from, so the boss reaches the floor.
  const free = screwed({ screwPoints: [{ id: "screw-1", x: 0, y: 0 }] });
  assert.deepEqual(
    postOf(free).map((post) => [post.pos, post.h]),
    [[[0, 0, 24], 8], [[0, 0, 1.99], 22.01]]
  );
  assert.deepEqual(boxSpecWarnings(free), [{ key: "warning.lidScrewFree", params: { n: 1 } }]);
});

test("warnings name standoffs outside the floor", () => {
  const spec = normalizeBoxSpec(defaultBoxSpec());
  spec.standoffs.push({ ...newStandoffGroup(spec), x: 40 });
  assert.deepEqual(boxSpecWarnings(spec)[0], { key: "warning.standoffsOutside", params: { n: 1 } });
});
