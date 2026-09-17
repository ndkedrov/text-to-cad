import assert from "node:assert/strict";
import test from "node:test";

import Module from "manifold-3d";

import { buildBoxPlan } from "./boxPlan.js";
import { defaultBoxSpec, normalizeBoxSpec } from "./boxSpec.js";
import {
  PLAN_QUALITIES,
  circleSegments,
  circleSegmentsFor,
  EXPORT_CHORD_TOLERANCE_MM,
  exportCircleSegments,
  manifoldFromPlan,
  roundedRectContour
} from "./manifoldPlan.js";

const wasm = await Module();
wasm.setup();

// Triangles and volume of a plan at a quality, with the manifold freed.
function measure(plan, options) {
  const solid = options === undefined ? manifoldFromPlan(wasm, plan) : manifoldFromPlan(wasm, plan, options);
  try {
    return { triangles: solid.numTri(), volume: solid.volume() };
  } finally {
    solid.delete();
  }
}

test("the preview cuts circles as it always has", () => {
  // Pinned: the site's preview must not change by a pixel.
  const radii = [0, 0.5, 1.25, 2, 3, 5, 10, 20, 40, 100];
  assert.deepEqual(radii.map(circleSegments), [24, 24, 24, 24, 24, 32, 60, 120, 128, 128]);
  for (const radius of radii) {
    assert.equal(circleSegmentsFor(radius), circleSegments(radius), "preview is the default");
    assert.equal(circleSegmentsFor(radius, "preview"), circleSegments(radius));
  }
});

test("export cuts circles no coarser than the preview and within the chord tolerance, in whole quarters", () => {
  for (const radius of [0, 0.01, 0.5, 2, 5, 10, 20, 40, 100, 1000]) {
    const segments = circleSegmentsFor(radius, "export");
    assert.equal(segments, exportCircleSegments(radius));
    assert.ok(segments >= circleSegments(radius), `no coarser than the preview at r=${radius}`);
    assert.ok(segments <= 256, "never past the ceiling");
    assert.equal(segments % 4, 0, "a rounded corner takes a whole quarter");
    if (segments < 256) {
      // The sagitta: how far the middle of a chord sits inside the circle.
      const sagitta = radius * (1 - Math.cos(Math.PI / segments));
      assert.ok(sagitta <= EXPORT_CHORD_TOLERANCE_MM + 1e-9, `chord ${sagitta} mm at r=${radius}`);
    }
  }
  // Small corners the preview already draws finely; large ones export finer.
  assert.equal(exportCircleSegments(2), circleSegments(2));
  assert.ok(exportCircleSegments(100) > circleSegments(100));
  assert.deepEqual(PLAN_QUALITIES, ["preview", "export"]);
  assert.throws(() => circleSegmentsFor(5, "draft"), /unknown plan quality: draft/u);
});

test("rounded corners follow the quality; square corners do not care", () => {
  const preview = roundedRectContour(40, 30, 5);
  assert.deepEqual(roundedRectContour(40, 30, 5, "preview"), preview);
  // 4 corners of (segments / 4 + 1) points each.
  assert.equal(preview.length, 4 * (circleSegments(5) / 4 + 1));
  const fine = roundedRectContour(40, 30, 5, "export");
  assert.equal(fine.length, 4 * (exportCircleSegments(5) / 4 + 1));
  assert.deepEqual(roundedRectContour(40, 30, 0, "export"), roundedRectContour(40, 30, 0));
  assert.throws(() => roundedRectContour(40, 30, 5, "draft"), /unknown plan quality/u);
});

test("a plan evaluated for export has more triangles; for the preview, the same as before", () => {
  const plan = buildBoxPlan(normalizeBoxSpec(defaultBoxSpec()), { layout: "print" });
  const cylinder = { type: "cyl", r: 100, h: 5 };
  for (const node of [plan.base, plan.lid, cylinder]) {
    const before = measure(node);
    assert.deepEqual(measure(node, {}), before, "no options is the preview");
    assert.deepEqual(measure(node, { quality: "preview" }), before);
    const exported = measure(node, { quality: "export" });
    assert.ok(exported.triangles > before.triangles, `${exported.triangles} > ${before.triangles}`);
    // Finer polygons sit closer to the true curve: the volume barely moves.
    assert.ok(Math.abs(exported.volume - before.volume) / before.volume < 0.005);
  }
  // A cylinder is its polygon extruded: 2 caps of (n - 2) triangles and 2n on the side.
  assert.equal(measure(cylinder).triangles, 4 * circleSegments(100) - 4);
  assert.equal(measure(cylinder, { quality: "export" }).triangles, 4 * exportCircleSegments(100) - 4);
  assert.throws(() => manifoldFromPlan(wasm, cylinder, { quality: "draft" }), /unknown plan quality/u);
});
