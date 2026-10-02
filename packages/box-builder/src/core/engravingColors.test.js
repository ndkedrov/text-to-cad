import assert from "node:assert/strict";
import test from "node:test";
import Module from "manifold-3d";
import { composeColorGroups, unionColorContours } from "./engravingColors.js";
import { contourArea, engravingFromDrawing, normalizeEngraving } from "./engraving.js";
import { buildBoxPlan, coloredPlanParts } from "./boxPlan.js";
import { defaultBoxSpec, normalizeBoxSpec } from "./boxSpec.js";

const wasm = await Module();
wasm.setup();
const square = (x, y, size) => [[x, y], [x + size, y], [x + size, y + size], [x, y + size]];
const area = (rings) => rings.reduce((sum, ring) => sum + contourArea(ring), 0);

test("paint order produces disjoint material regions while equal SVG colors stay one group", () => {
  const groups = composeColorGroups(wasm, [
    { color: "#ff0000", contours: [square(0, 0, 10)] },
    { color: "#0000ff", contours: [square(5, 0, 10)] },
    { color: "#ff0000", contours: [square(6, 1, 2)] }
  ]);
  assert.equal(groups.length, 2);
  assert.deepEqual(groups.map((g) => area(g.contours)), [54, 96]);
  assert.equal(area(unionColorContours(wasm, groups)), 150);
  const first = new wasm.CrossSection(groups[0].contours);
  const second = new wasm.CrossSection(groups[1].contours);
  const overlap = first.intersect(second);
  assert.equal(overlap.area(), 0);
  [first, second, overlap].forEach((s) => s.delete());
});

test("overpainting, empty clipped layers and holes keep the visible silhouette", () => {
  const groups = composeColorGroups(wasm, [
    { color: "#ff0000", contours: [square(0, 0, 10)] },
    { color: "#0000ff", contours: [square(0, 0, 10), square(2, 2, 6).reverse()] },
    { color: "#00ff00", contours: [] }
  ]);
  assert.deepEqual(groups.map((g) => area(g.contours)), [36, 64]);
  assert.equal(area(unionColorContours(wasm, groups)), 100);
  assert.deepEqual(unionColorContours(wasm, []), []);
});

test("new imports fit 90 percent of both lid dimensions regardless of physical SVG units", () => {
  for (const [width, height] of [[1214, 1098], [20, 100], [100, 20]]) {
    const result = engravingFromDrawing({ width, height, contours: [square(0, 0, 10)] }, {
      millimetresPerUnit: 25.4, lidWidth: 100, lidDepth: 70
    });
    assert.ok(result.sizeX <= 90.001 && result.sizeY <= 63.001);
    assert.ok(Math.abs(result.sizeX / result.sizeY - width / height) < 0.0001);
    assert.equal(Math.max(result.sizeX / 100, result.sizeY / 70), 0.9);
  }
});

test("eight editable colors survive normalization, JSON reload and print placement", () => {
  const colors = ["#001a4e", "#0140ab", "#fdd202", "#f6f8fc", "#07e7fc", "#089af8", "#03f6b2", "#041120"];
  const groups = colors.map((color, index) => ({ color, contours: [square(index * 10, 0, 8)] }));
  const engraving = engravingFromDrawing({ width: 80, height: 8, contours: groups.flatMap((g) => g.contours), colorGroups: groups }, { lidWidth: 100, lidDepth: 70 });
  assert.equal(engraving.mode, "inlay");
  engraving.colorGroups[2].color = colors[0];
  const restored = normalizeEngraving(JSON.parse(JSON.stringify(engraving)));
  assert.equal(restored.colorGroups.length, 8, "recolouring does not merge independent controls");
  assert.equal(restored.colorGroups[2].sourceColor, colors[2]);
  assert.equal(restored.colorGroups[2].color, colors[0]);
  const spec = defaultBoxSpec();
  spec.lid.engraving = restored;
  const normal = normalizeBoxSpec(spec);
  const preview = coloredPlanParts(buildBoxPlan(normal).inlay);
  const print = coloredPlanParts(buildBoxPlan(normal, { layout: "print" }).inlay);
  assert.equal(preview.length, 8);
  assert.deepEqual(preview.map((p) => p.color), restored.colorGroups.map((g) => g.color));
  assert.equal(print.length, 8);
  assert.deepEqual(print[0].plan.rot, [180, 0, 0]);
});
