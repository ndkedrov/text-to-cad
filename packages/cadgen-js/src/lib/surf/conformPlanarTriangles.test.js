import assert from "node:assert/strict";
import test from "node:test";
import { conformPlanarTriangles } from "./conformPlanarTriangles.js";

test("collinear trim vertices remain on a planar face without changing area or winding", () => {
  const points = [[0,0],[4,0],[4,4],[0,4],[1,0],[2,0],[3,0]].map(([x,y])=>({x,y}));
  const result = conformPlanarTriangles(points, [[0,1,2],[0,2,3]]);
  let area = 0;
  const edges = new Map();
  for (const [a,b,c] of result) {
    const [p,q,r] = [points[a],points[b],points[c]];
    const signed = ((q.x-p.x)*(r.y-p.y)-(q.y-p.y)*(r.x-p.x))/2;
    assert.ok(signed>0); area += signed;
    for (const [i,j] of [[a,b],[b,c],[c,a]]) {
      const key=[i,j].sort((x,y)=>x-y).join(':');edges.set(key,(edges.get(key)||0)+1);
    }
  }
  assert.equal(area,16);
  assert.equal(edges.has('0:1'),false);
  for (const key of ['0:4','4:5','5:6','1:6']) assert.equal(edges.get(key),1);
});

test("off-edge vertices do not move or split a planar triangle", () => {
  const points = [[0,0],[4,0],[0,4],[2,.001]].map(([x,y])=>({x,y}));
  assert.deepEqual(conformPlanarTriangles(points,[[0,1,2]]),[[0,1,2]]);
});
