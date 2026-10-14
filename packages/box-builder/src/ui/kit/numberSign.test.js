import assert from "node:assert/strict";
import test from "node:test";

import { allowsNegative, toggleNumberSign } from "./numberSign.js";

test("the sign key turns a positive value negative and back", () => {
  assert.equal(toggleNumberSign("12.5 mm").text, "-12.5 mm");
  assert.equal(toggleNumberSign("-12.5 mm").text, "12.5 mm");
  assert.equal(toggleNumberSign("+3").text, "-3");
  // A typographic minus, as a pasted value may carry, counts as a minus.
  assert.equal(toggleNumberSign("−3").text, "3");
});

test("an empty field takes the sign first, so the digits typed next are negative", () => {
  const result = toggleNumberSign("", { start: 0, end: 0 });
  assert.deepEqual(result, { text: "-", selectionStart: 1, selectionEnd: 1 });
});

test("a value selected on focus keeps the sign when the next digit replaces it", () => {
  // Focus selects "0 mm" whole. After the sign key the selection must cover only
  // what follows the minus, or typing "20" would wipe the minus out with the rest.
  const result = toggleNumberSign("0 mm", { start: 0, end: 4 });
  assert.deepEqual(result, { text: "-0 mm", selectionStart: 1, selectionEnd: 5 });
  const typed = `${result.text.slice(0, result.selectionStart)}20${result.text.slice(result.selectionEnd)}`;
  assert.equal(typed, "-20");

  const back = toggleNumberSign("-20", { start: 0, end: 3 });
  assert.deepEqual(back, { text: "20", selectionStart: 0, selectionEnd: 2 });
});

test("a caret after typed digits stays after them", () => {
  assert.deepEqual(toggleNumberSign("20", { start: 2, end: 2 }), { text: "-20", selectionStart: 3, selectionEnd: 3 });
  assert.deepEqual(toggleNumberSign("-20", { start: 3, end: 3 }), { text: "20", selectionStart: 2, selectionEnd: 2 });
  assert.deepEqual(toggleNumberSign("-20", { start: 0, end: 0 }), { text: "20", selectionStart: 0, selectionEnd: 0 });
});

test("only a range that reaches below zero needs the sign key", () => {
  assert.equal(allowsNegative(-2000), true);
  assert.equal(allowsNegative(-Infinity), true);
  assert.equal(allowsNegative(0), false);
  assert.equal(allowsNegative(0.3), false);
  assert.equal(allowsNegative(undefined), false);
});
