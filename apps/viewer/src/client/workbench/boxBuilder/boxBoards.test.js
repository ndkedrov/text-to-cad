import assert from "node:assert/strict";
import test from "node:test";

import { fitBoxToBoard, mountBoard, newBoard, resizeBoard, rotateBoard, snapBoardToWalls } from "./boxBoards.js";
import { buildBoxPlan } from "./boxPlan.js";
import {
  boardEdgeWall,
  boardHolePoints,
  boardPortCutout,
  boxDimensions,
  boxSpecWarnings,
  defaultBoxSpec,
  normalizeBoxSpec
} from "./boxSpec.js";

// The default box: 100 x 70 outside, 2 mm walls (96 x 66 inside), 4 mm corners,
// a 2 mm floor and 30 mm walls (wall top at 32), a 4 mm lip 1.6 thick 0.25 off the wall.
function specWithBoard(presetId, mutate = () => {}) {
  const draft = normalizeBoxSpec(defaultBoxSpec());
  draft.boards.push(newBoard(draft, presetId));
  mutate(draft, draft.boards[0]);
  return normalizeBoxSpec(draft);
}

function mounted(presetId, mutate) {
  return specWithBoard(presetId, (draft, board) => {
    mutate?.(draft, board);
    mountBoard(draft, board.id);
  });
}

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

test("mounting centres the board along its port wall and pushes it against that wall", () => {
  const spec = mounted("rpiZero");
  const board = spec.boards[0];
  assert.equal(board.mounted, true);
  assert.equal(board.rotation, 0);
  assert.equal(board.x, 0);
  assert.equal(board.y, -(33 - 1 - 15));
  assert.deepEqual(boardHolePoints(board)[0], [-29, -28.5]);
  assert.deepEqual(boxSpecWarnings(spec), []);
});

test("a mounted board stands on a pad under each hole, as tall as its clearance", () => {
  const spec = mounted("rpiZero");
  const { base } = buildBoxPlan(spec);
  const pads = findNodes(base, (node) => node.type === "cyl" && node.r === 2.75);
  const bores = findNodes(base, (node) => node.type === "cyl" && node.r === 1.1);
  assert.equal(pads.length, 4);
  assert.equal(bores.length, 4);
  assert.ok(pads.every((pad) => pad.pos[2] === 1.99 && pad.h === 4.01));
});

test("each port cuts its wall where the connector meets it", () => {
  const spec = mounted("rpiZero");
  const board = spec.boards[0];
  const dims = boxDimensions(spec);
  const hdmi = boardPortCutout(dims, board, board.ports[0]);
  assert.equal(hdmi.face, "front");
  assert.equal(hdmi.u, -20.1);
  assert.equal(hdmi.v, 9.3);
  assert.equal(hdmi.width, 12.2);
  assert.equal(hdmi.gap, 1);
  const { base } = buildBoxPlan(spec);
  const cutters = findNodes(base, (node) => Array.isArray(node.rot) && node.rot.join() === "90,0,0");
  assert.equal(cutters.length, 3);
  assert.deepEqual(cutters[0].pos, [-20.1, -35, 9.3]);
});

test("ports on two edges push the board into that corner", () => {
  const spec = mounted("rpi4");
  const board = spec.boards[0];
  assert.equal(board.x, 48 - 1 - 42.5);
  assert.equal(board.y, -(33 - 1 - 28));
  assert.deepEqual(boxSpecWarnings(spec), []);
  const walls = new Set(board.ports.map((port) => boardEdgeWall(board, port.edge)));
  assert.deepEqual([...walls].sort(), ["front", "right"]);
});

test("turning a board sends its ports to another wall", () => {
  // 90 mm deep (86 inside), so the Uno's 68.6 mm also fits across.
  const spec = mounted("arduinoUno", (draft) => {
    draft.base.depth = 90;
  });
  assert.equal(boardEdgeWall(spec.boards[0], "left"), "left");
  const draft = JSON.parse(JSON.stringify(spec));
  rotateBoard(draft, draft.boards[0].id, 90);
  const turned = normalizeBoxSpec(draft).boards[0];
  assert.equal(boardEdgeWall(turned, "left"), "front");
  // The USB-B sticks out 6.3 mm, so the board stops where it ends flush with the outside.
  assert.equal(turned.y, -4.4);
  const usb = boardPortCutout(boxDimensions(normalizeBoxSpec(draft)), turned, turned.ports[0]);
  assert.equal(usb.gap, -2);
});

test("a port far from its wall is reported, and snapping brings the board back", () => {
  const spec = mounted("rpiZero", () => {});
  spec.boards[0].y = 0;
  const far = boxSpecWarnings(spec);
  assert.equal(far.length, 3);
  assert.deepEqual(far[0], {
    key: "warning.portFar",
    params: { n: 1, port: 1, gap: 18 },
    target: { kind: "board", id: spec.boards[0].id }
  });
  snapBoardToWalls(spec, spec.boards[0].id);
  assert.deepEqual(boxSpecWarnings(normalizeBoxSpec(spec)), []);
});

test("fitting the box grows it around the board and its tallest part, lip included", () => {
  const spec = specWithBoard("rpi4", (draft, board) => {
    draft.base.width = 40;
    draft.base.depth = 30;
    mountBoard(draft, board.id);
  });
  assert.ok(boxSpecWarnings(spec).some((warning) => warning.key === "warning.boardOutside"));
  const draft = JSON.parse(JSON.stringify(spec));
  fitBoxToBoard(draft, draft.boards[0].id);
  const fitted = normalizeBoxSpec(draft);
  assert.equal(fitted.base.width, 85 + 1 + 1 + 4);
  assert.equal(fitted.base.depth, 56 + 1 + 1 + 4);
  assert.equal(fitted.walls.height, 30);
  assert.deepEqual([fitted.boards[0].x, fitted.boards[0].y], [0, 0]);
  assert.deepEqual(boxSpecWarnings(fitted), []);

  const tall = JSON.parse(JSON.stringify(fitted));
  tall.boards[0].componentHeight = 40;
  fitBoxToBoard(tall, tall.boards[0].id);
  assert.equal(tall.walls.height, Math.ceil((5 + 1.6 + 40 + 1 + 4) * 2) / 2);
});

test("a port reaching into the lip's band cuts the lip too", () => {
  const spec = mounted("rpi4", (draft, board) => {
    board.clearance = 11;
  });
  const { lid } = buildBoxPlan(spec);
  const lipCutters = findNodes(lid, (node) => Array.isArray(node.rot) && node.rot[0] === 90);
  assert.ok(lipCutters.length >= 2);
  const through = findNodes(lid, (node) => Array.isArray(node.pos) && node.pos[2] === -(2 + 0.25 + 1.6 + 1));
  assert.ok(through.length >= 2, "the cutter reaches through wall, clearance and lip");
});

test("resizing a board keeps holes and ports at their distance from the nearer edge", () => {
  const spec = mounted("custom", (draft, board) => {
    board.ports.push({ id: "port-1", type: "usbC", edge: "front", offset: 40, width: 9, height: 3.3 });
  });
  const draft = JSON.parse(JSON.stringify(spec));
  resizeBoard(draft, draft.boards[0].id, { width: 30 });
  resizeBoard(draft, draft.boards[0].id, { length: 20 });
  const board = normalizeBoxSpec(draft).boards[0];
  assert.deepEqual(board.holes.map((hole) => [hole.x, hole.y]), [[3.5, 3.5], [26.5, 3.5], [3.5, 16.5], [26.5, 16.5]]);
  assert.equal(board.ports[0].offset, 20);
});

test("shrinking a board to its minimum and growing it back returns every hole", () => {
  const spec = mounted("custom");
  const draft = JSON.parse(JSON.stringify(spec));
  const id = draft.boards[0].id;
  resizeBoard(draft, id, { width: 5 });
  resizeBoard(draft, id, { length: 5 });
  // Each corner hole keeps its half: 2 x (3.5 inset + 1.6 radius).
  assert.deepEqual([draft.boards[0].width, draft.boards[0].length], [10.2, 10.2]);
  assert.deepEqual(draft.boards[0].holes.map((hole) => [hole.x, hole.y]), [[3.5, 3.5], [6.7, 3.5], [3.5, 6.7], [6.7, 6.7]]);
  resizeBoard(draft, id, { width: 50 });
  resizeBoard(draft, id, { length: 30 });
  const board = normalizeBoxSpec(draft).boards[0];
  assert.deepEqual(board.holes.map((hole) => [hole.x, hole.y]), [[3.5, 3.5], [46.5, 3.5], [3.5, 26.5], [46.5, 26.5]]);
});

test("normalizing keeps boards buildable", () => {
  const spec = normalizeBoxSpec({
    boards: [
      { id: "board-1", rotation: 100, width: 20, length: 10, holes: [{ x: 99, y: -5 }], ports: [{ edge: "left", offset: 50, type: "nope" }] },
      {}, {}, {}, {}
    ]
  });
  assert.equal(spec.boards.length, 4);
  const [board] = spec.boards;
  assert.equal(board.rotation, 90);
  // Kept a radius inside the board (3.2 mm hole on a 20 x 10 board).
  assert.deepEqual([board.holes[0].x, board.holes[0].y], [18.4, 1.6]);
  assert.equal(board.ports[0].offset, 10);
  assert.equal(board.ports[0].type, "custom");
  assert.equal(spec.boards[1].mounted, false);
});
