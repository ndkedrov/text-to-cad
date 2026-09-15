import assert from "node:assert/strict";
import test from "node:test";

import { applyArray, arrayBounds, planArray } from "./boxEdits.js";
import {
  boxDimensions,
  boxSpecWarnings,
  defaultBoxSpec,
  holeCentreForLift,
  holeLift,
  newHole,
  newStandoffGroup,
  normalizeBoxSpec
} from "./boxSpec.js";

// The default box: 100 x 70 outside, 2 mm walls (96 x 66 inside), 4 mm corners, 30 mm walls on a 2 mm floor.
function specWith(mutate) {
  const spec = normalizeBoxSpec(defaultBoxSpec());
  mutate(spec);
  return normalizeBoxSpec(spec);
}

function floorHole() {
  const spec = specWith((draft) => draft.holes.push({ ...newHole(draft, "floor"), width: 5 }));
  return { spec, selection: { kind: "hole", id: spec.holes[0].id } };
}

test("fill with a step stops at the last copy that stays inside the cavity", () => {
  const { spec, selection } = floorHole();
  const planned = planArray(spec, selection, { direction: "+u", mode: "fill", step: 10 });
  assert.deepEqual(planned.positions.map(([u]) => u), [10, 20, 30, 40]);
  assert.equal(planned.skipped, 0);
});

test("a count that runs past the edge keeps only the copies that fit", () => {
  const { spec, selection } = floorHole();
  const planned = planArray(spec, selection, { direction: "+u", mode: "count", count: 6, step: 10 });
  assert.equal(planned.positions.length, 4);
  assert.equal(planned.skipped, 2);
});

test("evenly spreads a row from the element to the far edge", () => {
  const { spec, selection } = floorHole();
  const planned = planArray(spec, selection, { direction: "-u", mode: "even", count: 4 });
  assert.equal(planned.positions.length, 3);
  assert.equal(planned.positions[2][0], -45.5);
  assert.equal(planned.spacing, 15.167);
});

test("wall holes stay between the floor and the wall top and off the rounded corners", () => {
  const spec = specWith((draft) => draft.holes.push({ ...newHole(draft, "front"), width: 6 }));
  const selection = { kind: "hole", id: spec.holes[0].id };
  const bounds = arrayBounds(spec, selection);
  assert.deepEqual(bounds.u, [-43, 43]);
  assert.deepEqual(bounds.v, [5, 29]);
  const up = planArray(spec, selection, { direction: "+v", mode: "fill", step: 6 });
  assert.deepEqual(up.positions.map(([, v]) => v), [23, 29]);
});

test("a wall hole's height is its bottom edge above the floor, and it may not dip into the floor", () => {
  // A 16.4 mm keystone cut-out centred 10 mm above the box bottom starts 0.2 mm inside the 2 mm floor.
  const spec = specWith((draft) => draft.holes.push({ ...newHole(draft, "front"), shape: "rect", width: 14.7, height: 16.4, v: 10 }));
  const dims = boxDimensions(spec);
  const [hole] = spec.holes;
  assert.equal(holeLift(dims, hole), -0.2);
  assert.ok(boxSpecWarnings(spec).some((warning) => warning.key === "warning.holeOutside"));
  const raised = { ...hole, v: holeCentreForLift(dims, hole, 10) };
  assert.equal(raised.v, 2 + 10 + 8.2);
  assert.equal(holeLift(dims, raised), 10);
});

test("rotated rectangular holes count their rotated extent", () => {
  const spec = specWith((draft) => draft.holes.push({ ...newHole(draft, "floor"), shape: "rect", width: 20, height: 4, rotation: 90 }));
  const bounds = arrayBounds(spec, { kind: "hole", id: spec.holes[0].id });
  assert.deepEqual(bounds.v.map((value) => Math.round(value * 1000) / 1000), [-23, 23]);
});

test("standoff groups repeat across the floor inside the walls", () => {
  const spec = specWith((draft) => draft.standoffs.push({ ...newStandoffGroup(draft), pattern: "line", spacingX: 20, x: -30, y: 0 }));
  const selection = { kind: "standoff", id: spec.standoffs[0].id };
  const planned = planArray(spec, selection, { direction: "+u", mode: "fill", step: 30 });
  assert.deepEqual(planned.positions, [[0, 0], [30, 0]]);
});

test("applying an array inserts the copies after the source with new ids", () => {
  const { spec, selection } = floorHole();
  const added = applyArray(spec, selection, { direction: "+v", mode: "count", count: 2, step: 10 });
  assert.equal(added, 2);
  assert.deepEqual(spec.holes.map((hole) => hole.v), [0, 10, 20]);
  assert.equal(new Set(spec.holes.map((hole) => hole.id)).size, 3);
});
