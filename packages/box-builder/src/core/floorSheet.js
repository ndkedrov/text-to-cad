// Box builder: the floor of the box drawn 1:1 for printing. Everything that
// stands on the floor or goes through it is drawn where it lands, over a
// millimetre grid, so the sheet can be laid under the box, marked out by hand or
// kept with the print. The page is measured in millimetres, so printing it at
// 100% gives real sizes.

import {
  boardClampPostPoints,
  boardHolePoints,
  boardPoint,
  boardRailRect,
  boxDimensions,
  lidScrewPoints,
  lidScrewStepCentre,
  roundMm,
  standoffPoints
} from "./boxSpec.js";

// Room round the box for the grid labels, and the strip above it for the title.
const MARGIN = 12;
const HEADER = 16;
const RULER = 50;
// The grid has no labels along its top edge, so less room above it than round the rest.
const TOP_GAP = 4;
// Font sizes of the header text (mm) and how wide a character is on average, as a
// share of the size: generous, so a wrapped line never runs past the page.
const TITLE_SIZE = 4;
const NOTE_SIZE = 2.6;
const CHARACTER_WIDTH = 0.6;
// The print window: a popup of its own, so the page it came from stays in place.
export const FLOOR_SHEET_WINDOW_FEATURES = "width=900,height=700";

function tidy(value) {
  return roundMm(value, 3);
}

function escapeText(text) {
  return String(text ?? "").replace(/[<>&]/gu, (mark) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[mark]);
}

// One path for every line of a grid step, over the whole sheet inside the margins.
function gridPath(width, depth, step) {
  const parts = [];
  for (let x = 0; x <= width + 1e-9; x += step) {
    parts.push(`M${tidy(x)} 0V${tidy(depth)}`);
  }
  for (let y = 0; y <= depth + 1e-9; y += step) {
    parts.push(`M0 ${tidy(y)}H${tidy(width)}`);
  }
  return parts.join("");
}

function circle(x, y, diameter, className) {
  return `<circle class="${className}" cx="${tidy(x)}" cy="${tidy(-y)}" r="${tidy(diameter / 2)}"/>`;
}

function cross(x, y, size = 1.6) {
  const half = size / 2;
  return `<path class="mark" d="M${tidy(x - half)} ${tidy(-y)}H${tidy(x + half)}M${tidy(x)} ${tidy(-y - half)}V${tidy(-y + half)}"/>`;
}

function rect(x, y, width, height, { rotation = 0, radius = 0, className = "part" } = {}) {
  const turn = rotation ? ` transform="rotate(${tidy(-rotation)} ${tidy(x)} ${tidy(-y)})"` : "";
  return `<rect class="${className}" x="${tidy(x - width / 2)}" y="${tidy(-y - height / 2)}" width="${tidy(width)}" height="${tidy(height)}"`
    + ` rx="${tidy(radius)}"${turn}/>`;
}

function hexagon(x, y, acrossFlats, rotation) {
  const circumradius = acrossFlats / Math.sqrt(3);
  const points = Array.from({ length: 6 }, (_, index) => {
    const angle = (Math.PI / 3) * index;
    return `${tidy(x + circumradius * Math.cos(angle))},${tidy(-y - circumradius * Math.sin(angle))}`;
  });
  const turn = rotation ? ` transform="rotate(${tidy(-rotation)} ${tidy(x)} ${tidy(-y)})"` : "";
  return `<polygon class="cut" points="${points.join(" ")}"${turn}/>`;
}

// A hole through the floor, as it is cut.
function floorHole(hole) {
  if (hole.shape === "circle") {
    return circle(hole.u, hole.v, hole.width, "cut") + cross(hole.u, hole.v);
  }
  if (hole.shape === "hex") {
    return hexagon(hole.u, hole.v, hole.width, hole.rotation) + cross(hole.u, hole.v);
  }
  const radius = hole.shape === "slot" ? Math.min(hole.width, hole.height) / 2 : hole.radius;
  return rect(hole.u, hole.v, hole.width, hole.height, { rotation: hole.rotation, radius, className: "cut" })
    + cross(hole.u, hole.v);
}

// A standoff or post: the pad it stands on and the hole for the screw.
function pad(x, y, outerDiameter, holeDiameter) {
  return circle(x, y, outerDiameter, "part")
    + (holeDiameter > 0 ? circle(x, y, holeDiameter, "cut") : "")
    + cross(x, y);
}

function text(x, y, label, className = "label", anchor = "middle") {
  return `<text class="${className}" x="${tidy(x)}" y="${tidy(y)}" text-anchor="${anchor}">${escapeText(label)}</text>`;
}

// Breaks a label into lines that fit the width, at spaces; a word longer than a
// line stays whole on its own line.
function wrapLines(label, width, size) {
  const perLine = Math.max(8, Math.floor(width / (size * CHARACTER_WIDTH)));
  const lines = [];
  let line = "";
  for (const word of String(label || "").split(/\s+/u).filter(Boolean)) {
    if (line && line.length + 1 + word.length > perLine) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) {
    lines.push(line);
  }
  return lines;
}

function boardParts(board, dims) {
  const pieces = [];
  const [sizeX, sizeY] = board.rotation % 180 === 0
    ? [board.width, board.length]
    : [board.length, board.width];
  pieces.push(rect(board.x, board.y, sizeX, sizeY, { className: "board" }));
  for (const rail of board.rails) {
    const shape = boardRailRect(board, rail);
    pieces.push(rect(shape.x, shape.y, shape.sizeX, shape.sizeY, { rotation: board.rotation, className: "part" }));
  }
  if (board.clearance > 0) {
    for (const [x, y] of boardHolePoints(board)) {
      pieces.push(pad(x, y, board.padDiameter, board.boreDiameter));
    }
  }
  for (const [x, y] of boardClampPostPoints(board)) {
    pieces.push(pad(x, y, board.padDiameter, board.boreDiameter));
  }
  // The board's own name, under its front edge.
  const [labelX, labelY] = boardPoint(board, board.width / 2, 0);
  pieces.push(text(labelX, -labelY + 3.2, board.name || "", "board-label"));
  return pieces.join("");
}

// The sheet as one SVG element, sized in millimetres. `labels` carries the
// translated strings: { title, scale, note, ruler }.
export function floorSheetSvg(spec, labels = {}) {
  const dims = boxDimensions(spec);
  // A small box still gets a page the ruler fits on.
  const contentWidth = Math.max(dims.width, RULER);
  const sheetWidth = contentWidth + 2 * MARGIN;
  // The title sits beside the ruler when it fits there on one line; otherwise it
  // takes the whole width and the ruler gets a row of its own under the note.
  const besideRuler = wrapLines(labels.title, contentWidth - RULER - 4, TITLE_SIZE);
  const rulerBeside = besideRuler.length <= 1;
  const titleLines = rulerBeside ? besideRuler : wrapLines(labels.title, contentWidth, TITLE_SIZE);
  const noteLines = wrapLines(labels.note, contentWidth, NOTE_SIZE);
  const titleY = (index) => 6 + index * 5;
  const noteTop = titleY(Math.max(titleLines.length, 1) - 1) + 4.5;
  const noteY = (index) => noteTop + index * 3.4;
  const textBottom = noteY(Math.max(noteLines.length, 1) - 1);
  const rulerY = rulerBeside ? 7 : textBottom + 7.5;
  const rulerX = rulerBeside ? sheetWidth - MARGIN - RULER : MARGIN;
  const header = Math.max(HEADER, rulerBeside ? textBottom + 5.5 : rulerY + 2.5);
  const sheetHeight = dims.depth + TOP_GAP + MARGIN + header;
  const gridX = MARGIN + (contentWidth - dims.width) / 2;
  const originX = gridX + dims.width / 2;
  const originY = header + TOP_GAP + dims.depth / 2;

  const marks = [];
  for (let x = -Math.floor(dims.width / 2 / 10) * 10; x <= dims.width / 2; x += 10) {
    marks.push(text(x, dims.depth / 2 + 4, String(x), "tick"));
  }
  for (let y = -Math.floor(dims.depth / 2 / 10) * 10; y <= dims.depth / 2; y += 10) {
    marks.push(`<text class="tick" x="${tidy(-dims.width / 2 - 2)}" y="${tidy(-y + 1)}" text-anchor="end">${y}</text>`);
  }

  const parts = [];
  parts.push(rect(0, 0, dims.width, dims.depth, { radius: dims.radius, className: "outline" }));
  if (dims.wallsEnabled) {
    parts.push(rect(0, 0, dims.innerWidth, dims.innerDepth, { radius: dims.innerRadius, className: "inner" }));
  }
  for (const hole of spec.holes) {
    if (hole.face === "floor") {
      parts.push(floorHole(hole));
    }
  }
  for (const group of spec.standoffs) {
    for (const [x, y] of standoffPoints(group)) {
      parts.push(pad(x, y, group.outerDiameter, group.holeDiameter));
    }
  }
  for (const board of spec.boards) {
    if (board.mounted) {
      parts.push(boardParts(board, dims));
    }
  }
  // Lid screw bosses hang from the wall top; dashed, since they never touch the floor.
  for (const point of lidScrewPoints(dims)) {
    const [x, y] = lidScrewStepCentre(dims, point, dims.screwDiameter / 2);
    parts.push(circle(x, y, dims.screwDiameter, "above") + circle(x, y, dims.screwPilot, "cut") + cross(x, y));
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${tidy(sheetWidth)}mm" height="${tidy(sheetHeight)}mm"`
    + ` viewBox="0 0 ${tidy(sheetWidth)} ${tidy(sheetHeight)}">`
    + "<style>"
    + "text{font-family:system-ui,sans-serif;fill:#111}"
    + ".title{font-size:4px;font-weight:600}.note{font-size:2.6px;fill:#444}.tick{font-size:2.4px;fill:#444}"
    + ".board-label{font-size:2.6px;fill:#1c6b45}"
    + ".grid1{stroke:#c9d3dd;stroke-width:0.06;fill:none}.grid5{stroke:#9fb0bf;stroke-width:0.12;fill:none}"
    + ".grid10{stroke:#6c7f8f;stroke-width:0.2;fill:none}"
    + ".outline{stroke:#111;stroke-width:0.5;fill:none}.inner{stroke:#111;stroke-width:0.3;fill:none;stroke-dasharray:2 1.5}"
    + ".part{stroke:#111;stroke-width:0.3;fill:none}.cut{stroke:#c1341c;stroke-width:0.35;fill:none}"
    + ".board{stroke:#1c6b45;stroke-width:0.3;fill:none;stroke-dasharray:3 2}"
    + ".above{stroke:#5566aa;stroke-width:0.25;fill:none;stroke-dasharray:1.5 1}"
    + ".mark{stroke:#111;stroke-width:0.12;fill:none}.ruler{stroke:#111;stroke-width:0.3;fill:none}"
    + "</style>"
    + titleLines.map((line, index) => text(MARGIN, titleY(index), line, "title", "start")).join("")
    + noteLines.map((line, index) => text(MARGIN, noteY(index), line, "note", "start")).join("")
    + `<path class="ruler" d="M${tidy(rulerX)} ${tidy(rulerY)}h${RULER}`
    + `M${tidy(rulerX)} ${tidy(rulerY - 1.5)}v3M${tidy(rulerX + RULER)} ${tidy(rulerY - 1.5)}v3"/>`
    + text(rulerX + RULER / 2, rulerY - 2.5, labels.ruler || `${RULER} mm`, "note")
    + `<g transform="translate(${tidy(gridX)} ${tidy(header + TOP_GAP)})">`
    + `<path class="grid1" d="${gridPath(dims.width, dims.depth, 1)}"/>`
    + `<path class="grid5" d="${gridPath(dims.width, dims.depth, 5)}"/>`
    + `<path class="grid10" d="${gridPath(dims.width, dims.depth, 10)}"/>`
    + "</g>"
    + `<g transform="translate(${tidy(originX)} ${tidy(originY)})">${parts.join("")}${marks.join("")}</g>`
    + "</svg>";
}

// Opens the sheet in its own window and asks the browser to print it, where it
// can be saved as a PDF. Returns false when the window could not be opened.
// `host` is the window to open it from.
//
// Not "noopener": with it window.open returns null even though the window opens
// (HTML, window open steps), and the sheet could not be written. The window is
// cut loose from this page by clearing its opener instead.
export function printFloorSheet(svg, title, host = globalThis) {
  const sheet = host.open("", "_blank", FLOOR_SHEET_WINDOW_FEATURES);
  if (!sheet) {
    return false;
  }
  sheet.opener = null;
  sheet.document.write(
    `<!doctype html><html><head><meta charset="utf-8"><title>${escapeText(title)}</title>`
    + "<style>@page{margin:6mm}html,body{margin:0;padding:0;background:#fff}svg{display:block}</style>"
    + `</head><body>${svg}</body></html>`
  );
  sheet.document.close();
  sheet.focus();
  // Let the document lay out before the print dialog takes its picture.
  sheet.setTimeout(() => sheet.print(), 250);
  return true;
}
