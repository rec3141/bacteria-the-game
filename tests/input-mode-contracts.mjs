import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const game = readFileSync(resolve(root, "game.js"), "utf8");

assert.doesNotMatch(
  game,
  /["']ontouchstart["']\s+in\s+window/,
  "touch-event support must not force touch-first mode",
);
assert.match(
  game,
  /matchMedia\("\(pointer: coarse\) and \(hover: none\)"\)/,
  "touch-first mode must require a coarse, non-hovering primary pointer",
);
assert.match(game, /touchModeQuery\.addEventListener\("change"/, "input mode must react to primary-pointer changes");
assert.match(game, /classList\.toggle\("touch", on\)/, "layout class must follow touch-first mode");
assert.match(game, /ZOOM = on \? touchZoom\(\) \* viewScale\(\) : 1/, "desktop zoom must be restored");
assert.match(game, /insertBefore\(genomeRow, genomeHome\.nextSibling\)/, "desktop genome controls must be restored");

console.log("Input mode contracts OK: hybrid pointers stay desktop and mode changes are reversible.");
