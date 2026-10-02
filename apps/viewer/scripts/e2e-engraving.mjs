#!/usr/bin/env node
// Against a running Vite viewer: node apps/viewer/scripts/e2e-engraving.mjs [url] [optional.svg]
// No production accounts or source artwork are embedded in this regression.
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
const require = createRequire(new URL("../../../packages/cadgen-js/package.json", import.meta.url));
const { chromium } = require("playwright");
const root = fileURLToPath(new URL("../../../", import.meta.url)).replace(/\/$/u, "");
const colors = ["#001a4e", "#0140ab", "#fdd202", "#f6f8fc", "#07e7fc", "#089af8", "#03f6b2", "#041120"];
const synthetic = `<svg xmlns="http://www.w3.org/2000/svg" width="800mm" height="200mm" viewBox="20 30 800 200"><defs><clipPath id="c"><rect x="20" y="30" width="800" height="180"/></clipPath></defs><g clip-path="url(#c)">${colors.map((color, index) => `<path fill="${color}" d="M${20 + index * 100} 30h100v200h-100z"/>`).join("")}</g></svg>`;
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || "chrome", args: ["--use-angle=metal"] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(process.argv[2] || "http://127.0.0.1:5173");
  const result = await page.evaluate(async ({ root, svg }) => {
    const { drawingFromSvg } = await import(`/@fs${root}/packages/box-builder/src/browser/engravingImport.js`);
    const { contourArea } = await import(`/@fs${root}/packages/box-builder/src/core/engraving.js`);
    const d = await drawingFromSvg(svg);
    return { colors: d.colorGroups.map((g) => g.color), area: d.contours.reduce((s, r) => s + contourArea(r), 0) };
  }, { root, svg: synthetic });
  assert.deepEqual(result.colors, colors);
  assert.equal(result.area, 800 * 180, "clip definition is not a visible layer; clipping and nonzero fills are respected");
  const strokeEdit = await page.evaluate(async ({ root }) => {
    const { drawingFromSvg, redrawnDrawing } = await import(`/@fs${root}/packages/box-builder/src/browser/engravingImport.js`);
    const { engravingFromDrawing, contourArea } = await import(`/@fs${root}/packages/box-builder/src/core/engraving.js`);
    const d = await drawingFromSvg('<svg xmlns="http://www.w3.org/2000/svg" width="30" height="30"><line x1="5" y1="5" x2="25" y2="5" stroke="red" stroke-width="2"/><line x1="5" y1="20" x2="25" y2="20" stroke="blue" stroke-width="2"/></svg>');
    const edited = await redrawnDrawing(engravingFromDrawing(d), { lineWidth: 4, gapWidth: 0 });
    return {
      before: d.contours.reduce((sum, ring) => sum + contourArea(ring), 0),
      after: edited.contours.reduce((sum, ring) => sum + contourArea(ring), 0),
      colors: edited.colorGroups.map((g) => g.color)
    };
  }, { root });
  assert.deepEqual(strokeEdit.colors, ["#ff0000", "#0000ff"]);
  assert.ok(strokeEdit.after > strokeEdit.before * 1.9, "stroke width editing retains both colours");
  if (process.argv[3]) {
    const difference = await page.evaluate(async ({ root, svg }) => {
      const { drawingFromSvg } = await import(`/@fs${root}/packages/box-builder/src/browser/engravingImport.js`);
      const d = await drawingFromSvg(svg);
      const width = 800, height = Math.round(width * d.height / d.width);
      const canvas = () => Object.assign(document.createElement("canvas"), { width, height });
      const original = canvas().getContext("2d"), imported = canvas().getContext("2d");
      const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
      try {
        const image = new Image(); image.src = url; await image.decode();
        original.drawImage(image, 0, 0, width, height);
      } finally { URL.revokeObjectURL(url); }
      imported.scale(width / d.width, height / d.height);
      for (const group of d.colorGroups) {
        imported.beginPath();
        for (const ring of group.contours) {
          imported.moveTo(...ring[0]);
          ring.slice(1).forEach((p) => imported.lineTo(...p));
          imported.closePath();
        }
        imported.fillStyle = group.color; imported.fill("nonzero");
      }
      const a = original.getImageData(0, 0, width, height).data;
      const b = imported.getImageData(0, 0, width, height).data;
      let different = 0, painted = 0;
      for (let i = 0; i < a.length; i += 4) {
        if (a[i + 3] > 0 || b[i + 3] > 0) {
          painted++;
          if (Math.max(...[0, 1, 2, 3].map((j) => Math.abs(a[i + j] - b[i + j]))) > 40) different++;
        }
      }
      return different / painted;
    }, { root, svg: fs.readFileSync(process.argv[3], "utf8") });
    assert.ok(difference < 0.02, `raster difference ${difference} must remain below 2%`);
    console.log(JSON.stringify({ rasterDifference: difference }));
  }
  await page.getByRole("tab", { name: "Кришка", exact: true }).click();
  await page.locator('input[accept=".svg,image/svg+xml"]').setInputFiles({
    name: "eight-colors.svg", mimeType: "image/svg+xml", buffer: process.argv[3] ? fs.readFileSync(process.argv[3]) : Buffer.from(synthetic)
  });
  await page.getByText("Кольорові контури (8)", { exact: true }).click();
  const palette = page.getByRole("button", { name: /^Група \d+ ·/u });
  assert.equal(await palette.count(), 8);
  await palette.nth(2).click();
  await page.getByRole("textbox", { name: "Hex color", exact: true }).fill("#ff00ff");
  await page.getByRole("textbox", { name: "Hex color", exact: true }).press("Enter");
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => JSON.parse(localStorage.getItem("cad-viewer:box-builder:draft:v1"))?.spec?.lid?.engraving?.colorGroups?.[2]?.color === "#ff00ff");
  await page.reload();
  await page.getByRole("tab", { name: "Кришка", exact: true }).click();
  await page.getByText("Кольорові контури (8)", { exact: true }).click();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("cad-viewer:box-builder:draft:v1")).spec);
  const e = saved.lid.engraving;
  assert.equal(e.colorGroups[2].color, "#ff00ff");
  assert.equal(e.colorGroups[2].sourceColor, colors[2]);
  assert.ok(e.sizeX <= saved.base.width * 0.9 + 0.001 && e.sizeY <= saved.base.depth * 0.9 + 0.001);
  assert.equal(e.colorGroups.length, 8);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ groups: e.colorGroups.length, size: [e.sizeX, e.sizeY], recolorAndReload: true, errors }));
} finally {
  await browser.close();
}
