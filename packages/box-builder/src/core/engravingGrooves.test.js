import assert from "node:assert/strict";
import test from "node:test";

import Module from "manifold-3d";

import { contourArea } from "./engraving.js";
import { GROOVE_CORNER_STEPS, grooveContours } from "./engravingGrooves.js";

const wasm = await Module();
wasm.setup();

const area = (contours) => contours.reduce((total, points) => total + contourArea(points), 0);
// A round pen's disc as drawn: a regular polygon of GROOVE_CORNER_STEPS sides.
const disc = (radius) => (GROOVE_CORNER_STEPS / 2) * radius * radius * Math.sin((2 * Math.PI) / GROOVE_CORNER_STEPS);

test("a straight open line is a band as wide as the pen, with round ends", () => {
  const contours = grooveContours(wasm, [{ points: [[10, 25], [90, 25]], width: 6, closed: false }]);
  assert.equal(contours.length, 1);
  assert.ok(Math.abs(area(contours) - (80 * 6 + disc(3))) < 0.5, String(area(contours)));
  const xs = contours[0].map(([x]) => x);
  const ys = contours[0].map(([, y]) => y);
  assert.ok(Math.abs(Math.min(...xs) - 7) < 1e-6 && Math.abs(Math.max(...xs) - 93) < 1e-6);
  assert.ok(Math.abs(Math.min(...ys) - 22) < 1e-6 && Math.abs(Math.max(...ys) - 28) < 1e-6);
});

test("an open curve is cut along the line, not filled under it", () => {
  // Half a circle of radius 20 drawn with a 2-wide pen: a thin arc, far less than
  // the half disc its chord would close.
  const points = Array.from({ length: 41 }, (_, index) => {
    const angle = (Math.PI * index) / 40;
    return [20 * Math.cos(angle), 20 * Math.sin(angle)];
  });
  const cut = area(grooveContours(wasm, [{ points, width: 2, closed: false }]));
  const arc = Math.PI * 20 * 2;
  assert.ok(Math.abs(cut - arc) < 0.05 * arc, `${cut} against ${arc}`);
});

test("a closed line is a ring that keeps the hole it encloses", () => {
  const points = Array.from({ length: 64 }, (_, index) => {
    const angle = (2 * Math.PI * index) / 64;
    return [15 * Math.cos(angle), 15 * Math.sin(angle)];
  });
  const contours = grooveContours(wasm, [{ points, width: 3, closed: true }]);
  assert.equal(contours.length, 2, "outer edge and hole");
  const ring = Math.PI * (16.5 * 16.5 - 13.5 * 13.5);
  assert.ok(Math.abs(area(contours) - ring) < 0.02 * ring, String(area(contours)));
});
