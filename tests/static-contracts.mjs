import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(resolve(root, path), "utf8");
const game = read("game.js");
const help = read("index.html");
const readme = read("README.md");

const filesBlock = game.match(/const files = \{([\s\S]*?)\};/);
assert(filesBlock, "audio file map is missing");

const sounds = new Map(
  [...filesBlock[1].matchAll(/(\w+)\s*:\s*"([^"]+)"/g)].map((match) => [match[1], match[2]]),
);
for (const [, soundPath] of sounds) {
  assert(existsSync(resolve(root, soundPath)), `registered sound file is missing: ${soundPath}`);
}
for (const call of game.matchAll(/Audio\.play\(([^)]*)\)/g)) {
  for (const match of call[1].matchAll(/"([^"]+)"/g)) {
    assert(sounds.has(match[1]), `Audio.play references unregistered sound: ${match[1]}`);
  }
}

const controls = [
  {
    name: "Tab",
    readme: /\*\*Tab\*\*/,
    help: /<kbd>Tab<\/kbd>/,
    implementation: /e\.key === "Tab"\) cycleEnzyme\(\)/,
  },
];

for (const control of controls) {
  assert(control.readme.test(readme), `${control.name} is missing from README controls`);
  assert(control.help.test(help), `${control.name} is missing from in-game help`);
  assert(control.implementation.test(game), `${control.name} has no matching keyboard handler`);
}

const scoreRowStart = game.indexOf('el.scoresList.querySelectorAll("tr.srow")');
const scoreRowEnd = game.indexOf("// ------------------------------------------------------------------ circos", scoreRowStart);
assert(scoreRowStart >= 0 && scoreRowEnd > scoreRowStart, "score-row bindings are missing");
const scoreRowBindings = game.slice(scoreRowStart, scoreRowEnd);
assert.match(scoreRowBindings, /addEventListener\("click"[^\n]*openScoreDetail/,
  "high-score rows must still open the detailed run view");
assert.doesNotMatch(scoreRowBindings, /mouseenter|mousemove|mouseleave|showCircos|positionCircos|hideCircos/,
  "the main high-score table must not show a Circos map on hover");
assert.match(game, /if \(el\.detailCircos\) \{[\s\S]*?renderCircos\([^\n]*rec\.upgrades/,
  "the detailed run view must retain its Circos genome map");

console.log(`Static contracts OK: ${sounds.size} sounds and ${controls.length} control${controls.length === 1 ? "" : "s"} checked.`);
