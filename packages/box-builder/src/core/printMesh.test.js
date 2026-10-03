import assert from "node:assert/strict";
import test from "node:test";
import Module from "manifold-3d";
import { buildBoxPrintMesh } from "./printMesh.js";
import { defaultBoxSpec, normalizeBoxSpec } from "./boxSpec.js";
import { buildBoxPlan } from "./boxPlan.js";
import { manifoldFromPlan } from "./manifoldPlan.js";
const wasm = await Module();
wasm.setup();
const square = (x, y, size) => [[x,y],[x+size,y],[x+size,y+size],[x,y+size]];
const ring = [square(0,0,10), square(2,2,6).reverse()];
const contours = [...ring, square(10,10,2)];
function fixture() {
  const spec = defaultBoxSpec();
  spec.lid.engraving = { name: "touching islands and a hole", width: 12, height: 12,
    sizeX: 24, sizeY: 24, mode: "inlay", depth: 0.6, contours,
    colorGroups: [{color:"#001122", contours: ring}, {color:"#AABBCC", contours: [contours[2]]}] };
  return normalizeBoxSpec(spec);
}
function solidOf(p) {
  return new wasm.Manifold(new wasm.Mesh({numProp:3, vertProperties:p.positions, triVerts:p.indices}));
}
test("print export preserves closed parts, holes, contact topology and lid placement", () => {
  const spec = fixture();
  const mesh = buildBoxPrintMesh(wasm, spec, "inlay");
  assert.deepEqual(mesh.primitives.map(p => p.color), ["#E5EAEF", "#001122", "#AABBCC"]);
  const solids = mesh.primitives.map(solidOf);
  const uncut = structuredClone(spec); uncut.lid.engraving = null;
  const lid = manifoldFromPlan(wasm, buildBoxPlan(uncut, {layout:"print"}).lid, {quality:"export"});
  try {
    for (const s of solids) {
      assert.equal(s.status(), "NoError");
      assert.ok(s.boundingBox().min[2] > -1e-5);
    }
    const volume = solids.reduce((n,s) => n+s.volume(), 0);
    assert.ok(Math.abs(volume-lid.volume()) < 0.01, "no material lost or doubled across the logo and lid");
    assert.ok(Math.abs(solids[1].volume() - (100-36)*4*0.6) < 0.001, "the intended hole stays empty");
    for (let a=0;a<solids.length;a++) for(let b=a+1;b<solids.length;b++) {
      const intersection=solids[a].intersect(solids[b]);
      try { assert.ok(intersection.volume() < 0.001, "colors do not overlap"); }
      finally { intersection.delete(); }
    }
  } finally { solids.forEach(s=>s.delete()); lid.delete(); }
});
test("plain lid, base, legacy monochrome inlay and missing parts", () => {
  const spec=fixture(); delete spec.lid.engraving.colorGroups;
  assert.equal(buildBoxPrintMesh(wasm,spec,"inlay").primitives.length,2);
  for(const part of ["base","lid"]) {
    const m=solidOf(buildBoxPrintMesh(wasm,spec,part).primitives[0]);
    try { assert.equal(m.status(),"NoError"); } finally {m.delete();}
  }
  assert.throws(()=>buildBoxPrintMesh(wasm,defaultBoxSpec(),"inlay"),/Unavailable/);
  assert.throws(()=>buildBoxPrintMesh(wasm,spec,"unknown"),/Unavailable/);
});
