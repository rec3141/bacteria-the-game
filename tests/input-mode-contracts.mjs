import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const game = readFileSync(resolve(root, "game.js"), "utf8");
const html = readFileSync(resolve(root, "index.html"), "utf8");

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

const keyboard = game.slice(game.indexOf("const RESERVED_GAME_KEYS"), game.indexOf('addEventListener("keyup"'));
for (const key of ["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright", " ", "tab", "shift"])
  assert.ok(keyboard.includes(`"${key}"`), `${JSON.stringify(key)} must remain reserved for gameplay`);
assert.match(keyboard, /pauseCandidate = e\.key\.length === 1 \|\| e\.key === "Enter" \|\| e\.key === "Pause"/,
  "printable unused keys pause without hijacking browser function keys");
assert.match(keyboard, /unusedPauseKey = pauseCandidate && !gameplayKey && !e\.repeat &&[\s\S]*!e\.ctrlKey && !e\.metaKey && !e\.altKey/,
  "unused keys pause once without hijacking modified browser or OS shortcuts");
assert.match(keyboard, /if \(paused\) \{[\s\S]*unusedPauseKey[\s\S]*togglePause\(\)/,
  "an unused key must also resume a paused run");
assert.match(keyboard, /unusedPauseKey && state && state\.running && !state\.demo[\s\S]*togglePause\(\)/,
  "unused keys pause only a live player run, never the menu simulation");
assert.match(html, /<kbd>Esc<\/kbd> or any unused key — pause and high scores/,
  "in-game help documents the generous pause binding");

console.log("Input mode contracts OK: hybrid pointers stay desktop and mode changes are reversible.");
