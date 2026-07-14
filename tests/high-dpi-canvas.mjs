import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const game = readFileSync(new URL("../game.js", import.meta.url), "utf8");
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const helperSource = game.match(/\/\/ CANVAS_DPR_START[\s\S]*?\/\/ CANVAS_DPR_END/)?.[0];
assert.ok(helperSource, "production DPR helper block is present");

const fakeWindow = { devicePixelRatio: 2 };
const { canvasPixelRatio, logicalCanvasSize, prepareHiDpiCanvas } = new Function(
  "window",
  `${helperSource}\nreturn { canvasPixelRatio, logicalCanvasSize, prepareHiDpiCanvas };`,
)(fakeWindow);

const transforms = [];
const context = { setTransform: (...args) => transforms.push(args) };
const canvas = {
  width: 800,
  height: 680,
  dataset: {},
  clientWidth: 800,
  clientHeight: 680,
  getAttribute(name) { return String(this[name]); },
  getContext() { return context; },
};

let surface = prepareHiDpiCanvas(canvas, 800, 680, context);
assert.equal(surface.width, 800, "logical width stays in CSS pixels");
assert.equal(surface.height, 680, "logical height stays in CSS pixels");
assert.equal(canvas.width, 1600, "DPR 2 doubles backing width");
assert.equal(canvas.height, 1360, "DPR 2 doubles backing height");
assert.deepEqual(transforms.at(-1), [2, 0, 0, 2, 0, 0], "drawing coordinates are scaled to DPR 2");
assert.deepEqual(logicalCanvasSize(canvas), { width: 800, height: 680 }, "backing pixels never leak into world dimensions");

fakeWindow.devicePixelRatio = 3;
surface = prepareHiDpiCanvas(canvas, null, null, context);
assert.equal(surface.ratio, 3);
assert.equal(canvas.width, 2400, "DPR changes rebuild the backing store");
assert.deepEqual(transforms.at(-1), [3, 0, 0, 3, 0, 0]);

fakeWindow.devicePixelRatio = 4;
surface = prepareHiDpiCanvas(canvas, null, null, context);
assert.equal(surface.ratio, 3, "DPR is capped to control canvas memory");
assert.equal(surface.resized, false, "an unchanged capped backing store is not reallocated");
assert.deepEqual(transforms.at(-1), [3, 0, 0, 3, 0, 0], "transform is reapplied even without allocation");

fakeWindow.devicePixelRatio = Number.NaN;
assert.equal(canvasPixelRatio(), 1, "invalid browser DPR falls back to one");

assert.match(game, /prepareHiDpiCanvas\(canvas, w, h, ctx\);[\s\S]*?VIEW_W = w; VIEW_H = h/,
  "main canvas backing size is separate from logical world size");
assert.match(game, /const logical = logicalCanvasSize\(canvas\);[\s\S]*?ecoBandAt\([^;]*logical\.width, logical\.height/,
  "chart hover hit-testing uses logical coordinates");
assert.match(html, /#scoresTable td\.chart canvas \{[^}]*width: 132px; height: 30px/,
  "mini charts retain their CSS footprint after backing-store growth");
assert.match(html, /#circosPop canvas \{[^}]*width: 230px; height: 230px/,
  "Circos popup retains its CSS footprint after backing-store growth");

console.log("High-DPI canvas contracts OK: DPR 2/3 stay sharp without changing logical coordinates.");
