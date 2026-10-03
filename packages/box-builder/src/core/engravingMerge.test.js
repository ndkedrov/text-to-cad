import assert from "node:assert/strict";
import test from "node:test";
import Module from "manifold-3d";
import { composeColorGroups, unionColorContours } from "./engravingColors.js";
import { engravingFits, mergeSmallColorRegions } from "./engravingMerge.js";
import { engravingFromDrawing, normalizeEngraving } from "./engraving.js";

const wasm = await Module(); wasm.setup();
const square = (x, y, w) => [[x,y], [x+w,y], [x+w,y+w], [x,y+w]];
function speckles() {
  return composeColorGroups(wasm, [
    {color: "#000000", contours: [square(0,0,20), square(16,16,2).reverse()]},
    {color: "#0090fc", contours: [square(1,1,2), ...Array.from({length: 640}, (_, i) => square(4 + i % 32 * .3, 1 + Math.floor(i/32)*.3, .03))]},
    {color: "#fde102", contours: [square(14,2,2)]},
    {color: "#fdfdfd", contours: [square(14,6,2)]}
  ]);
}
function assertPartition(before, after) {
  const original = new wasm.CrossSection(before.flatMap(g => g.contours), "Positive");
  const result = new wasm.CrossSection(after.flatMap(g => g.contours), "Positive");
  const lost = original.subtract(result), extra = result.subtract(original);
  assert.ok(lost.area() < 1e-7, "no missing material, including small islands");
  assert.ok(extra.area() < 1e-7, "no filled intentional holes or changed silhouette");
  const areas = after.map(g => new wasm.CrossSection(g.contours, "Positive"));
  for (let i=0; i<areas.length; i++) for (let j=i+1; j<areas.length; j++) {
    const overlap = areas[i].intersect(areas[j]); assert.ok(overlap.area() < 1e-7); overlap.delete();
  }
  [...areas, original, result, lost, extra].forEach(a => a.delete());
}

test("dense submillimetre regions merge without holes, overlaps or lost colours", async () => {
  const groups = speckles(), silhouette = unionColorContours(wasm, groups);
  assert.equal(engravingFits(groups, silhouette), false);
  let breaths = 0;
  const out = await mergeSmallColorRegions(wasm, groups, silhouette, {millimetresPerUnit: 1, breathe: async () => { breaths++; }});
  assert.ok(out.mergedRegions > 300);
  assert.ok(breaths > 0, "long work yields to the browser");
  assert.equal(engravingFits(out.colorGroups, silhouette), true);
  assert.deepEqual(out.colorGroups.map(g=>g.color), groups.map(g=>g.color));
  assert.equal(out.contours, silhouette);
  assertPartition(groups, out.colorGroups);
  const engraving = engravingFromDrawing({...out, width:20,height:20}, {millimetresPerUnit:1});
  assertPartition(groups, normalizeEngraving(JSON.parse(JSON.stringify(engraving))).colorGroups);
});

test("fitted physical size controls merging; large details are never removed to meet a limit", async () => {
  const groups = speckles(), silhouette = unionColorContours(wasm, groups);
  const out = await mergeSmallColorRegions(wasm, groups, silhouette, {millimetresPerUnit:100});
  assert.equal(out.mergedRegions, 0);
  assert.deepEqual(out.colorGroups, groups);
  assert.equal(engravingFits(out.colorGroups, silhouette), false);
});

test("ordinary drawings stay byte-for-byte unchanged", async () => {
  const groups = composeColorGroups(wasm,[{color:"#0090fc",contours:[square(0,0,1),square(3,3,.01)]}]);
  const silhouette = unionColorContours(wasm,groups);
  const out = await mergeSmallColorRegions(wasm,groups,silhouette,{millimetresPerUnit:1});
  assert.equal(out.colorGroups,groups);
  assert.equal(out.mergedRegions,0);
});

test("isolated silhouette islands survive even when the drawing stays too complex", async () => {
  const groups = [
    {color:"#0090fc",contours:[square(0,0,2), ...Array.from({length:310},(_,i)=>square(4+i*.5,0,.03))]},
    // Less than the adjacency probe's width away, but no shared edge.
    {color:"#fde102",contours:[square(0,4,2),square(4.0305,0,.03)]}
  ];
  const silhouette = unionColorContours(wasm,groups);
  const out = await mergeSmallColorRegions(wasm,groups,silhouette,{millimetresPerUnit:1});
  assert.equal(out.mergedRegions,0);
  assertPartition(groups,out.colorGroups);
});
