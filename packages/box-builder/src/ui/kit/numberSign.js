// The sign of a number being typed, flipped without the keyboard.
//
// A phone's decimal keypad has digits and a decimal separator and nothing else:
// iOS offers no keypad with a minus at all. A hole that sits left of a wall's
// centre, a board moved below the origin, a rotation the other way all need a
// negative number, so the panel puts a sign key beside the field and this is
// what it does to the text in it.
//
// The caret matters as much as the text. Focusing a field selects its whole
// value so the first digit replaces it; if the sign key kept that selection,
// the next digit would replace the minus as well and the field would be
// positive again. So a whole-value selection becomes a selection of everything
// after the sign, and any other caret or selection moves with the text.

const SIGNS = new Set(["-", "+", "−"]);

function clamp(value, low, high) {
  return Math.min(Math.max(value, low), high);
}

export function toggleNumberSign(text, selection = null) {
  const value = String(text ?? "");
  const lead = value.length - value.trimStart().length;
  const sign = SIGNS.has(value[lead]) ? value[lead] : "";
  const negative = sign === "-" || sign === "−";
  const body = value.slice(lead + sign.length);
  const nextSign = negative ? "" : "-";
  const nextText = `${value.slice(0, lead)}${nextSign}${body}`;
  const numberStart = lead + nextSign.length;

  const start = Number.isInteger(selection?.start) ? selection.start : value.length;
  const end = Number.isInteger(selection?.end) ? selection.end : start;
  const wholeValue = start <= lead && end >= value.length && value.length > 0;
  if (wholeValue) {
    return { text: nextText, selectionStart: numberStart, selectionEnd: nextText.length };
  }

  const shift = nextSign.length - sign.length;
  const oldNumberStart = lead + sign.length;
  const move = (position) => (position >= oldNumberStart
    ? position + shift
    : Math.min(position, numberStart));
  return {
    text: nextText,
    selectionStart: clamp(move(start), 0, nextText.length),
    selectionEnd: clamp(move(end), 0, nextText.length)
  };
}

// Whether a field's range reaches below zero, so it needs the sign key.
export function allowsNegative(min) {
  const lower = Number(min);
  return !Number.isNaN(lower) && lower < 0;
}
