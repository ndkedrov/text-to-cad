import assert from "node:assert/strict";
import test from "node:test";

import { buildBoxPlan } from "./boxPlan.js";
import {
  boxDimensions,
  boxSpecWarnings,
  clampStandoffPosition,
  connectorHole,
  defaultBoxSpec,
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

test("warnings name standoffs outside the floor", () => {
  const spec = normalizeBoxSpec(defaultBoxSpec());
  spec.standoffs.push({ ...newStandoffGroup(spec), x: 40 });
  assert.deepEqual(boxSpecWarnings(spec)[0], { key: "warning.standoffsOutside", params: { n: 1 } });
});
