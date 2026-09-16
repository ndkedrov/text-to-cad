import assert from "node:assert/strict";
import test from "node:test";

import { buildBoxPlan, engravingCutters } from "./boxPlan.js";
import {
  MAX_CONTOUR_POINTS,
  MAX_ENGRAVING_CONTOURS,
  contourArea,
  engravingContours,
  engravingFromDrawing,
  engravingIslands,
  engravingPointCount,
  normalizeEngraving,
  simplifyContour
} from "./engraving.js";
import { boxDimensions, defaultBoxSpec, normalizeBoxSpec } from "./boxSpec.js";

// A ring: a 10 x 10 square with a 4 x 4 square inside it, as a letter "O" is drawn.
const RING = [
  [[0, 0], [10, 0], [10, 10], [0, 10]],
  [[3, 3], [7, 3], [7, 7], [3, 7]]
];

const drawing = (contours = RING) => ({ name: "mark", width: 10, height: 10, contours });

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

test("a drawing arrives centred on the lid at the size asked for", () => {
  const engraving = engravingFromDrawing(drawing(), { millimetresPerUnit: 3 });
  assert.deepEqual(
    [engraving.name, engraving.width, engraving.height, engraving.sizeX, engraving.sizeY, engraving.x, engraving.y],
    ["mark", 10, 10, 30, 30, 0, 0]
  );
  assert.equal(engraving.contours.length, 2);
  assert.equal(engravingPointCount(engraving), 8);
});

test("nothing to cut comes back as no engraving", () => {
  assert.equal(normalizeEngraving(null), null);
  assert.equal(normalizeEngraving({ width: 10, height: 10, contours: [] }), null);
  assert.equal(normalizeEngraving({ width: 10, height: 10, contours: [[[0, 0], [1, 1]]] }), null, "two points are not a shape");
});

test("contours are placed where the engraving sits, with the drawing turned the right way up", () => {
  const engraving = normalizeEngraving({ ...drawing(), sizeX: 20, sizeY: 20, x: 5, y: -4, depth: 1 });
  const [outline] = engravingContours(engraving);
  // The drawing's 10 x 10 doubled: its corners land 10 mm from the middle, and a
  // drawing counts Y downwards, so its top edge comes out at the back of the lid.
  // Turned the right way up, the contour runs the other way round, and it is put
  // back: a prism on a contour that runs backwards grows the wrong way.
  assert.deepEqual(outline, [[-5, -14], [15, -14], [15, 6], [-5, 6]]);
  for (const contour of engravingContours(engraving)) {
    assert.ok(contourArea(contour) > 0, "every contour runs counter-clockwise");
  }
});

test("a contour inside another is a hole in it", () => {
  const islands = engravingIslands(normalizeEngraving(drawing()));
  assert.equal(islands.length, 1);
  assert.equal(islands[0].holes.length, 1);
  // Two separate marks are two islands.
  const apart = engravingIslands(normalizeEngraving({
    ...drawing([[[0, 0], [2, 0], [2, 2], [0, 2]], [[6, 6], [9, 6], [9, 9], [6, 9]]])
  }));
  assert.equal(apart.length, 2);
  assert.ok(apart.every((island) => !island.holes.length));
});

test("the cut goes down from the top of the lid, or through it", () => {
  const dims = boxDimensions(normalizeBoxSpec(defaultBoxSpec()));
  const shallow = engravingCutters(normalizeEngraving({ ...drawing(), depth: 0.6 }), dims);
  assert.equal(shallow.length, 1);
  // The lid's top is at 34; the cut starts 0.6 below it and reaches past it.
  assert.deepEqual(shallow[0].pos, [0, 0, 33.4]);
  const [prism] = findNodes(shallow[0], (node) => node.type === "poly");
  assert.equal(prism.h, 1.6);
  assert.equal(findNodes(shallow[0], (node) => node.type === "poly").length, 2, "the outline and its hole");

  const deep = engravingCutters(normalizeEngraving({ ...drawing(), depth: 2 }), dims);
  assert.deepEqual(deep[0].pos, [0, 0, 31], "a cut as deep as the lid starts under it");
  assert.equal(findNodes(deep[0], (node) => node.type === "poly")[0].h, 4);
});

test("the lid carries the engraving, and the base knows nothing of it", () => {
  const spec = normalizeBoxSpec(defaultBoxSpec());
  spec.lid.engraving = normalizeEngraving({ ...drawing(), sizeX: 30, sizeY: 30, depth: 0.8 });
  const { base, lid } = buildBoxPlan(normalizeBoxSpec(spec));
  assert.equal(findNodes(lid, (node) => node.type === "poly").length, 2);
  assert.equal(findNodes(base, (node) => node.type === "poly").length, 0);
});

test("filling it in another colour makes a part of its own, standing in the recess", () => {
  const spec = normalizeBoxSpec(defaultBoxSpec());
  spec.lid.engraving = normalizeEngraving({ ...drawing(), sizeX: 30, sizeY: 30, depth: 0.8, mode: "inlay" });
  const { lid, inlay } = buildBoxPlan(normalizeBoxSpec(spec));
  // The lid's top is at 34, so a 0.8 mm filling stands from 33.2 up to it.
  assert.deepEqual(inlay.pos, [0, 0, 33.2]);
  const prisms = findNodes(inlay, (node) => node.type === "poly");
  assert.equal(prisms.length, 2, "the outline and the hole it keeps");
  assert.equal(prisms[0].h, 0.8);
  assert.ok(findNodes(lid, (node) => node.type === "poly").length, "the recess is still cut in the lid");

  const print = buildBoxPlan(normalizeBoxSpec(spec), { layout: "print" });
  assert.deepEqual([print.inlay.rot, print.inlay.pos], [[180, 0, 0], [0, 0, 34]], "turned over with the lid");

  const cut = normalizeBoxSpec({ ...spec, lid: { ...spec.lid, engraving: { ...spec.lid.engraving, mode: "cut" } } });
  assert.equal(buildBoxPlan(cut).inlay, null, "a cut engraving has nothing to fill it");
});

test("a contour walked in thousands of steps is thinned without the page hanging", () => {
  const spiral = Array.from({ length: 20000 }, (_, index) => {
    const angle = (index / 20000) * Math.PI * 12;
    return [angle * Math.cos(angle), angle * Math.sin(angle)];
  });
  const started = Date.now();
  const kept = simplifyContour(spiral, 0.5);
  const took = Date.now() - started;
  assert.ok(kept.length <= MAX_CONTOUR_POINTS, `${kept.length} points`);
  assert.ok(took < 1000, `took ${took} ms`);
});

test("a crowded drawing is thinned to what a plan can hold", () => {
  const circle = Array.from({ length: 400 }, (_, index) => {
    const angle = (index / 400) * Math.PI * 2;
    return [50 + 50 * Math.cos(angle), 50 + 50 * Math.sin(angle)];
  });
  const simplified = simplifyContour(circle, 0.2);
  assert.ok(simplified.length <= MAX_CONTOUR_POINTS, `${simplified.length} points`);
  assert.ok(simplified.length >= 8, "but still round");
  const many = normalizeEngraving({ width: 100, height: 100, contours: Array.from({ length: 80 }, () => circle.slice(0, 60)) });
  assert.ok(many.contours.length <= MAX_ENGRAVING_CONTOURS);
  assert.ok(engravingPointCount(many) <= 1200);
});
