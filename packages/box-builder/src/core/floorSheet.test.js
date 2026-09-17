import assert from "node:assert/strict";
import test from "node:test";

import { mountBoard, newBoard } from "./boxBoards.js";
import { floorSheetSvg } from "./floorSheet.js";
import { defaultBoxSpec, newHole, newStandoffGroup, normalizeBoxSpec } from "./boxSpec.js";

const DEMO_BOARD = {
  id: "demo",
  name: "Demo board",
  width: 20,
  length: 40,
  thickness: 1.6,
  clearance: 2,
  componentHeight: 4,
  padDiameter: 5,
  boreDiameter: 2,
  holes: [],
  ports: [],
  rails: [{ offset: 5, length: 16, thickness: 4 }],
  clamp: true,
  clampHeight: 14
};

// The default box, 100 x 70, with a hole through the floor, a pair of standoffs
// and a board on ribs held by a clamp.
function demoSpec(lid = {}) {
  const draft = normalizeBoxSpec(defaultBoxSpec());
  draft.holes.push({ ...newHole(draft, "floor"), u: 10, v: -5, width: 6 });
  draft.standoffs.push({ ...newStandoffGroup(draft), pattern: "line", spacingX: 40, outerDiameter: 6, holeDiameter: 2.5 });
  draft.boards.push(newBoard(draft, DEMO_BOARD));
  Object.assign(draft.lid, lid);
  const spec = normalizeBoxSpec(draft);
  mountBoard(spec, spec.boards[0].id);
  return normalizeBoxSpec(spec);
}

function svgOf(spec) {
  return floorSheetSvg(spec, { title: "box floor", note: "print at 100%", ruler: "50 mm" });
}

const attribute = (svg, name) => svg.match(new RegExp(`${name}="([^"]+)"`, "u"))?.[1];
const countOf = (svg, pattern) => svg.match(new RegExp(pattern, "gu"))?.length || 0;

test("the floor sheet is a page in millimetres, one to one", () => {
  const svg = svgOf(demoSpec());
  // 100 x 70 box, 12 mm margins, 16 mm for the title strip.
  assert.equal(attribute(svg, "width"), "124mm");
  assert.equal(attribute(svg, "height"), "110mm");
  assert.equal(attribute(svg, "viewBox"), "0 0 124 110");
  assert.ok(svg.includes("box floor"), "the title is on the sheet");
  assert.ok(svg.includes("50 mm"), "so is the ruler it is checked against");
});

test("the grid draws every millimetre, every fifth and every tenth", () => {
  const svg = svgOf(demoSpec());
  const lines = (className) => {
    const path = svg.match(new RegExp(`class="${className}" d="([^"]+)"`, "u"))[1];
    return path.split("M").length - 1;
  };
  // 101 lines across and 71 along for 1 mm; 21 and 15 for 5 mm; 11 and 8 for 10 mm.
  assert.equal(lines("grid1"), 172);
  assert.equal(lines("grid5"), 36);
  assert.equal(lines("grid10"), 19);
});

test("everything on the floor is drawn where it lands", () => {
  const spec = demoSpec();
  const svg = svgOf(spec);
  const board = spec.boards[0];

  assert.ok(svg.includes('class="outline"'), "the box outline");
  assert.ok(svg.includes('class="inner"'), "and the inside of its walls");
  // The floor hole: 6 mm wide at u 10, v -5, drawn with Y pointing down.
  assert.ok(svg.includes('<circle class="cut" cx="10" cy="5" r="3"/>'), svg.slice(0, 0) || "the hole through the floor");
  // The two standoffs of the line group: 6 mm pads with 2.5 mm screw holes.
  assert.ok(svg.includes('<circle class="part" cx="-20" cy="0" r="3"/>'));
  assert.ok(svg.includes('<circle class="cut" cx="-20" cy="0" r="1.25"/>'));
  // The board itself, its rib and its two clamp posts.
  assert.ok(svg.includes('class="board"'), "the board outline");
  assert.ok(svg.includes("Demo board"), "named");
  assert.equal(countOf(svg, '<rect class="part"'), 1, "one rib under the board");
  const postPads = countOf(svg, `<circle class="part" cx="[-0-9.]+" cy="[-0-9.]+" r="${board.padDiameter / 2}"`);
  assert.equal(postPads, 2, "a pad under each clamp post");
});

test("lid screw bosses are drawn as hanging above the floor, and only when there are any", () => {
  assert.equal(countOf(svgOf(demoSpec()), 'class="above"'), 0);
  const withScrews = svgOf(demoSpec({ screws: true }));
  assert.equal(countOf(withScrews, 'class="above"'), 4, "one per corner");
  assert.ok(withScrews.includes('<circle class="cut" cx="44.8" cy="-29.8" r="1.25"/>'), "with its pilot hole");
});
