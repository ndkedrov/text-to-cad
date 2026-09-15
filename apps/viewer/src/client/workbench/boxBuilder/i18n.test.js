import assert from "node:assert/strict";
import test from "node:test";

import { readFileSync } from "node:fs";

import { newBoard } from "./boxBoards.js";
import { boxSpecWarnings, defaultBoxSpec, newHole, newStandoffGroup, normalizeBoxSpec } from "./boxSpec.js";
import { BOX_MESSAGES, detectLanguage, formatWarning, translate } from "./i18n.js";

test("both languages carry exactly the same keys", () => {
  const english = Object.keys(BOX_MESSAGES.en).sort();
  const ukrainian = Object.keys(BOX_MESSAGES.uk).sort();
  assert.deepEqual(ukrainian, english);
  for (const [key, text] of Object.entries(BOX_MESSAGES.uk)) {
    assert.ok(text.trim(), `uk ${key} is empty`);
  }
});

test("every board type the server ships is named in both languages", () => {
  const shipped = JSON.parse(readFileSync(
    new URL("../../../../../../packages/cadgen/src/cadgen/viewer/board_presets.json", import.meta.url),
    "utf8"
  ));
  for (const id of shipped.categories) {
    for (const language of ["en", "uk"]) {
      assert.notEqual(translate(language, `board.category.${id}`), `board.category.${id}`, `${language} ${id}`);
    }
  }
  for (const board of shipped.boards) {
    assert.ok(shipped.categories.includes(board.category), board.id);
  }
});

test("Ukrainian only when the browser's first language is Ukrainian", () => {
  assert.equal(detectLanguage("uk"), "uk");
  assert.equal(detectLanguage("uk-UA"), "uk");
  assert.equal(detectLanguage("en-US"), "en");
  assert.equal(detectLanguage("ru-UA"), "en");
  assert.equal(detectLanguage("de"), "en");
  assert.equal(detectLanguage(""), "en");
  assert.equal(detectLanguage(undefined), "en");
});

test("placeholders are filled and unknown keys fall back", () => {
  assert.equal(translate("en", "item.hole", { n: 3 }), "Hole 3");
  assert.equal(translate("uk", "item.hole", { n: 3 }), "Отвір 3");
  assert.equal(translate("fr", "tab.lid"), "Lid");
  assert.equal(translate("uk", "no.such.key"), "no.such.key");
  assert.equal(translate("en", "quota.new", { used: 1 }), "new 1/{limit}");
});

test("every warning the spec produces has a sentence in both languages", () => {
  let spec = normalizeBoxSpec(defaultBoxSpec());
  spec.standoffs.push({ ...newStandoffGroup(spec), x: 40, height: 400 });
  spec.holes.push({ ...newHole(spec, "front"), u: 49 });
  spec.walls.enabled = false;
  spec = normalizeBoxSpec(spec);
  spec.walls.enabled = true;
  spec.lid.enabled = false;
  spec.holes.push({ ...newHole(spec, "lid") });
  const rpiZero = JSON.parse(readFileSync(
    new URL("../../../../../../packages/cadgen/src/cadgen/viewer/board_presets.json", import.meta.url),
    "utf8"
  )).boards.find((board) => board.id === "rpiZero");
  spec.boards.push({ ...newBoard(spec, rpiZero), mounted: true, componentHeight: 100, x: 60 });
  spec.boards.push({ ...newBoard(spec, rpiZero), mounted: true, clearance: 40 });
  spec.boards.push({ ...newBoard(spec, { id: "bare", name: "Bare", width: 20, length: 10, clearance: 30, holes: [], ports: [] }), mounted: true, clampHeight: 3 });
  const warnings = boxSpecWarnings(spec);
  const keys = new Set(warnings.map((warning) => warning.key));
  for (const key of ["warning.boardOutside", "warning.boardTall", "warning.portFar", "warning.portOutside", "warning.boardUnsupported", "warning.clampLow"]) {
    assert.ok(keys.has(key), key);
  }
  for (const language of ["en", "uk"]) {
    for (const warning of warnings) {
      const sentence = formatWarning(language, warning);
      assert.ok(!sentence.includes("{"), `${language}: ${sentence}`);
      assert.notEqual(sentence, warning.key);
    }
  }
  const off = warnings.find((warning) => warning.key === "warning.holeFaceOff");
  assert.equal(formatWarning("en", off), "Hole 2: the lid is off, so the hole does nothing.");
});
