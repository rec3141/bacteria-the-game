import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const game = readFileSync(new URL("../game.js", import.meta.url), "utf8");

const media = html.match(/@media \(pointer: coarse\) and \(hover: none\) and \(orientation: landscape\) and \(max-height: 560px\) \{[\s\S]*?\n  \}/)?.[0] ?? "";
assert.ok(media, "short coarse-pointer landscape breakpoint exists");
assert.match(media, /body\.touch #wrap \{[\s\S]*?flex-direction: row/,
  "short landscape places the ocean and deck side by side");
assert.match(media, /body\.touch #stage \{[\s\S]*?width: auto; max-width: none; height: 100%/,
  "short landscape removes the 50dvh stage-width cap");
assert.match(media, /--landscape-deck: clamp\(288px, 38vw, 330px\)/,
  "the deck has a bounded side-column width");
assert.match(media, /body\.touch #stickZone \{[\s\S]*?30dvh/,
  "the thumbstick shrinks from viewport height rather than landscape width");
assert.match(media, /body\.touch #chartwrap \{[\s\S]*?position: fixed/,
  "expanded charts overlay instead of consuming playfield height");

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const playfield = (width, height) => ({
  width: width - 12 - 6 - clamp(width * 0.38, 288, 330),
  height: height - 12,
});
assert.deepEqual(playfield(667, 375), { width: 361, height: 363 },
  "667×375 retains a roughly square playfield before safe-area adjustments");
assert.ok(playfield(844, 390).width > 500 && playfield(844, 390).height > 370,
  "844×390 retains a clearly usable playfield");

assert.match(game, /matchMedia\("\(pointer: coarse\) and \(hover: none\) and \(orientation: landscape\) and \(max-height: 560px\)"\)/,
  "runtime uses the same short-landscape condition as CSS");
assert.match(game, /if \(on && !shortLandscape\) \{[\s\S]*?classList\.add\("collapsed"\)/,
  "entering short landscape defaults the chart panel to collapsed");
assert.match(game, /function start\(\) \{[\s\S]*?shortLandscapeActive\(\)[\s\S]*?classList\.add\("collapsed"\)[\s\S]*?newGame\(\)/,
  "every new short-landscape run starts with charts collapsed");
assert.match(game, /addEventListener\("change", onShortLandscapeChange\)/,
  "rotation and viewport changes re-evaluate the layout");

console.log("Short-landscape contracts OK: usable side-by-side playfield and reachable controls.");
