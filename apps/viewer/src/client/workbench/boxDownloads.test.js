import assert from "node:assert/strict";
import test from "node:test";
import { withClientBoxExports } from "./boxDownloads.js";

test("web downloads offer browser STL/3MF only for finished STEP parts", () => {
  const payload = { name: "case", clientExportFormats: ["stl", "3mf"], outputs: [{part: "base", format: "step", file: "base.step"}] };
  const result = withClientBoxExports(payload);
  assert.deepEqual(result.outputs.map((f) => [f.part, f.format]), [["base", "step"], ["base", "stl"], ["base", "3mf"]]);
  assert.equal(result.outputs[1].client, true);
  assert.equal(payload.outputs.length, 1);
});

test("expired or failed parts have no invented download buttons", () => {
  assert.deepEqual(withClientBoxExports({name:"case",clientExportFormats:["stl","3mf"],outputs:[]}).outputs, []);
});

test("legacy server exports are preserved and not duplicated", () => {
  const payload={name:"case",outputs:[{part:"lid",format:"step",file:"lid.step"},{part:"lid",format:"stl",file:"lid.stl"}]};
  assert.equal(withClientBoxExports(payload), payload);
  assert.equal(withClientBoxExports({...payload,clientExportFormats:["stl","3mf"]}).outputs.length, 3);
});

test("server browser downloads survive both legacy pass-through and current adapters", () => {
  const payload = { name: "case", clientExportFormats: ["stl", "3mf"], outputs: [
    { part: "inlay", format: "step", file: "inlay.step" },
    { part: "inlay", format: "stl", file: "case_inlay.stl", client: true },
    { part: "inlay", format: "3mf", file: "case_inlay.3mf", client: true },
  ] };
  assert.deepEqual(withClientBoxExports(payload).outputs, payload.outputs);
  assert.equal(payload.outputs.filter((output) => output.part === "inlay").length, 3);
});
