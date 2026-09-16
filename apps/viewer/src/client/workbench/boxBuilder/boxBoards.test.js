import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  boardNameMatches,
  boardTemplateState,
  boardTemplatesPending,
  syncBoardTemplates,
  updateBoardFromTemplate,
  fitBoxToBoard,
  flipBoard,
  mountBoard,
  newBoard,
  resizeBoard,
  rotateBoard,
  snapBoardToWalls
} from "./boxBoards.js";
import { CLAMP_DEPTH, buildBoxPlan, clampPieces } from "./boxPlan.js";
import {
  PORT_TYPES,
  boardEdgeWall,
  boardHolePoints,
  boardLevels,
  boardPortCutout,
  boxDimensions,
  boxSpecWarnings,
  defaultBoxSpec,
  normalizeBoxSpec
} from "./boxSpec.js";

// The board templates the server ships (GET /__cad/boxes/presets).
const SHIPPED = JSON.parse(readFileSync(
  new URL("../../../../../../packages/cadgen/src/cadgen/viewer/board_presets.json", import.meta.url),
  "utf8"
));

function presetFor(id) {
  return id === "custom" ? null : SHIPPED.boards.find((board) => board.id === id);
}

// The default box: 100 x 70 outside, 2 mm walls (96 x 66 inside), 4 mm corners,
// a 2 mm floor and 30 mm walls (wall top at 32), a 4 mm lip 1.6 thick 0.25 off the wall.
function specWithBoard(presetId, mutate = () => {}) {
  const draft = normalizeBoxSpec(defaultBoxSpec());
  draft.boards.push(newBoard(draft, presetFor(presetId)));
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

test("the shipped templates use the builder's connector sizes and survive normalizing", () => {
  assert.deepEqual(SHIPPED.portTypes, JSON.parse(JSON.stringify(PORT_TYPES)));
  assert.ok(SHIPPED.boards.length >= 10);
  for (const preset of SHIPPED.boards) {
    const spec = normalizeBoxSpec(defaultBoxSpec());
    spec.boards.push(newBoard(spec, preset));
    const board = normalizeBoxSpec(spec).boards[0];
    assert.deepEqual([board.preset, board.name], [preset.id, preset.name]);
    assert.deepEqual(board.holes.map(({ x, y, diameter }) => [x, y, diameter]), preset.holes.map(({ x, y, diameter }) => [x, y, diameter]), preset.id);
    assert.equal(board.ports.length, preset.ports.length, preset.id);
  }
});

test("board search matches the starts of words, not fragments inside them", () => {
  const found = (query) => SHIPPED.boards.filter((board) => boardNameMatches(board.name, query)).map((board) => board.name);
  const es = found("es");
  assert.ok(es.length > 0);
  assert.ok(es.every((name) => /\bes/iu.test(name)), es.join(", "));
  assert.ok(!es.some((name) => /Pressure|EYESPI/u.test(name)));
  assert.ok(boardNameMatches("ESP32-S3-DevKitC-1 (N16R8)", "esp32s3"));
  assert.ok(boardNameMatches("ESP32-S3-DevKitC-1 (N16R8)", "s3 n16"));
  assert.ok(boardNameMatches("Raspberry Pi 4 B", "pi 4"));
  assert.ok(!boardNameMatches("Raspberry Pi 4 B", "berry"));
  assert.ok(boardNameMatches("TTL-RS485 auto-direction module", "485"));
  assert.ok(boardNameMatches("TTL-RS485 auto-direction module", "rs485 auto"));
  assert.ok(boardNameMatches("SN65HVD230 CAN transceiver module", "230"));
  assert.ok(!boardNameMatches("SN65HVD230 CAN transceiver module", "ceiver"));
  assert.ok(found("485").some((name) => name.startsWith("TTL-RS485")));
  assert.equal(found("").length, SHIPPED.boards.length);
});

test("the dual USB-C ESP32-S3 rests on two ribs and a T piece next to the box clamps it down", () => {
  const spec = mounted("esp32S3DevkitC", (draft) => {
    draft.base.width = 120;
    draft.base.depth = 100;
  });
  const board = spec.boards[0];
  assert.deepEqual([board.clearance, board.clamp, board.clampHeight, board.rails.length], [2, true, 14, 2]);
  // Against the front wall: inside half-depth 48, 1 mm gap, half the 69 mm length.
  assert.deepEqual([board.x, board.y], [0, -12.5]);
  const { base } = buildBoxPlan(spec);
  const ribs = findNodes(base, (node) => node.type === "rrect" && node.w === 22 && node.d === 4);
  assert.deepEqual(ribs.map((rib) => [rib.pos, rib.h]), [[[0, -37, 1.99], 2.01], [[0, 20, 1.99], 2.01]]);
  const posts = findNodes(base, (node) => node.type === "cyl" && node.r === 2.5 && node.h === 14.01);
  // Beside the board's long sides: half its 25.4 width, the 1 mm gap and half a 5 mm post.
  assert.deepEqual(posts.map((post) => post.pos), [[-16.2, -12.5, 1.99], [16.2, -12.5, 1.99]]);
  // The posts slide along the board: 20 mm from the USB end instead of halfway.
  const moved = mounted("esp32S3DevkitC", (draft) => {
    draft.base.width = 120;
    draft.base.depth = 100;
  });
  moved.boards[0].clampOffset = 20;
  const movedPosts = findNodes(buildBoxPlan(moved).base, (node) => node.type === "cyl" && node.r === 2.5 && node.h === 14.01);
  assert.deepEqual(movedPosts.map((post) => post.pos), [[-16.2, -27, 1.99], [16.2, -27, 1.99]]);
  const tee = findNodes(base, (node) => node.type === "poly" && node.h === CLAMP_DEPTH);
  assert.equal(tee.length, 1);
  // Bar 3 mm plus a stem from the 14 mm post tops down to the board top at 3.6 mm.
  assert.equal(Math.max(...tee[0].points.map(([x]) => x)), 13.4);
  assert.deepEqual(tee[0].points.map(([, y]) => y).filter((y) => y > 0).sort((a, b) => a - b), [2, 2, 18.7, 18.7]);
  const screwHoles = findNodes(base, (node) => node.type === "cyl" && node.r === 1.4);
  assert.deepEqual(screwHoles.map((hole) => hole.pos), [[-1, -16.2, 5], [-1, 16.2, 5]]);
  assert.deepEqual(clampPieces(spec, boxDimensions(spec)).map((piece) => piece.x), [65]);
  assert.deepEqual(boxSpecWarnings(spec), []);
});

test("a clamped board is reported when nothing holds it up or its posts are too low or too tall", () => {
  assert.equal(specWithBoard("custom").boards[0].clamp, false, "a board with holes is screwed down instead");
  const spec = mounted("rs485AutoDirSlimGeneric", (draft) => {
    draft.base.width = 120;
    draft.base.depth = 100;
  });
  const keys = () => boxSpecWarnings(spec).map((warning) => warning.key);
  assert.equal(spec.boards[0].clamp, true);
  assert.deepEqual(keys(), []);
  spec.boards[0].rails = [];
  assert.ok(keys().includes("warning.boardUnsupported"));
  spec.boards[0].clampHeight = 5;
  assert.ok(keys().includes("warning.clampLow"));
  spec.boards[0].clampHeight = 30;
  assert.ok(keys().includes("warning.clampTall"));
});

test("a board in a box follows its changed template unless it was edited since", () => {
  const current = presetFor("microSdSpiMini33v");
  // The template as it was when the board went into the box: no mounting holes.
  const old = { ...current, holes: [], padDiameter: 5, boreDiameter: 2 };
  const boxWith = (mutate) => {
    const draft = normalizeBoxSpec(defaultBoxSpec());
    draft.boards.push(newBoard(draft, old));
    mountBoard(draft, draft.boards[0].id);
    mutate?.(draft.boards[0]);
    return normalizeBoxSpec(draft);
  };
  const shipped = SHIPPED.boards;

  const untouched = boxWith();
  assert.deepEqual([untouched.boards[0].clamp, untouched.boards[0].holes.length], [true, 0]);
  assert.equal(boardTemplateState(untouched.boards[0], shipped).state, "update");
  assert.ok(boardTemplatesPending(untouched, shipped));
  assert.equal(syncBoardTemplates(untouched, shipped), true);
  const synced = normalizeBoxSpec(untouched).boards[0];
  assert.deepEqual([synced.clamp, synced.holes.map(({ x, y }) => [x, y]), synced.mounted], [false, [[1.5, 4.5], [16.5, 4.5]], true]);
  assert.equal(boardTemplateState(synced, shipped).state, "current");

  const legacy = boxWith((board) => {
    board.template = "";
  });
  assert.equal(boardTemplateState(legacy.boards[0], shipped).state, "update", "a board from before fingerprints follows too");

  const edited = boxWith((board) => {
    board.clearance = 7;
  });
  assert.equal(boardTemplateState(edited.boards[0], shipped).state, "edited");
  assert.equal(syncBoardTemplates(edited, shipped), false, "an edited board is left alone");
  updateBoardFromTemplate(edited, edited.boards[0].id, shipped);
  assert.equal(normalizeBoxSpec(edited).boards[0].holes.length, 2);

  const fresh = mounted("microSdSpiMini33v", (draft, board) => {
    board.clearance = 4;
  });
  assert.equal(boardTemplateState(fresh.boards[0], shipped).state, "current", "editing a board with an unchanged template asks nothing");
});

test("a board without a template is the custom one", () => {
  const spec = normalizeBoxSpec(defaultBoxSpec());
  const board = newBoard(spec);
  assert.deepEqual([board.preset, board.name, board.width, board.length, board.holes.length], ["custom", "", 50, 30, 4]);
});

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
  // The board edge stops 1 mm off the wall; the mini HDMI sticks out 0.5 mm past it.
  assert.equal(hdmi.gap, 0.5);
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
  assert.equal(turned.y, -4.41);
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
    params: { n: 1, port: 1, gap: 17.5 },
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

test("an upside-down board mirrors its holes and ports and hangs its parts below", () => {
  const spec = mounted("arduinoUno");
  const draft = JSON.parse(JSON.stringify(spec));
  flipBoard(draft, draft.boards[0].id, true);
  const flipped = normalizeBoxSpec(draft);
  const board = flipped.boards[0];
  assert.equal(board.flipped, true);
  assert.equal(board.clearance, 12, "raised so its 12 mm parts clear the floor");
  assert.equal(boardEdgeWall(board, "left"), "right");
  const dims = boxDimensions(flipped);
  const usb = boardPortCutout(dims, board, board.ports[0]);
  assert.equal(usb.face, "right");
  assert.equal(usb.v, boardLevels(dims, board).bottom - 11 / 2);
  // The hole 13.97 mm from the left edge is now 13.97 mm from the right one.
  const [holeX] = boardHolePoints(board)[0];
  assert.ok(Math.abs(holeX - (board.x + 68.58 / 2 - 13.97)) < 1e-3);
  const partsBelow = () => boxSpecWarnings(flipped).some((warning) => warning.key === "warning.boardPartsBelow");
  assert.equal(partsBelow(), false);
  board.clearance = 4;
  assert.equal(partsBelow(), true);
});

test("a board with no clearance lies on the floor without standoffs", () => {
  const spec = mounted("custom", (draft, board) => {
    board.clearance = 0;
  });
  assert.equal(spec.boards[0].clearance, 0);
  const { base } = buildBoxPlan(spec);
  assert.equal(findNodes(base, (node) => node.type === "cyl" && node.r === 3).length, 0);
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
