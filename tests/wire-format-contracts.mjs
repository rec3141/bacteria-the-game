// Wire-format widths: the client, the server and the in-game constants must agree.
//
// This suite exists because of a bug that shipped: the per-interval calorie tally was reset with a
// hand-written `[0, 0, 0, 0, 0]` that was never widened when autotrophy became the sixth source. The
// first sample of every run charted correctly, then `undefined + fixed` = NaN poisoned the rest, so
// autotrophy silently vanished from the calorie chart. Charting fine exactly once is what made it hard
// to see.
//
// There are two distinct hazards here and they want opposite fixes:
//
//   1. INTERNAL widths (resets, fallbacks) must be DERIVED from the label arrays, so growing a list
//      cannot leave a stale literal behind. Guarded in diversity-phylogeny-contracts.mjs.
//
//   2. WIRE widths must NOT be derived. They are a versioned contract with score_schema.php and with
//      every record already on the leaderboard. If the client derived its width from CAL_LABELS, adding
//      a seventh source would make it start posting 7 elements while PHP still validated 6 — and
//      score_vector returns null on a length mismatch, so the whole calorie breakdown would be dropped
//      server-side, silently, for every run. So instead of deriving them, we pin them: the literals must
//      match on both sides AND match the constants they represent, which turns adding a source into a
//      deliberate, three-file change rather than an accident.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const game = readFileSync(new URL("../game.js", import.meta.url), "utf8");
const php = readFileSync(new URL("../score_schema.php", import.meta.url), "utf8");

// --- 1. client and server must declare the same width for every vector on the wire -------------------
const clientWidths = new Map();
for (const m of game.matchAll(/scoreClientVector\(value\.(\w+), (\d+), /g)) {
  // cin is deliberately tried at two widths (current, then legacy); keep the widest as the current one
  const [, key, width] = m;
  clientWidths.set(key, Math.max(clientWidths.get(key) ?? 0, Number(width)));
}
const serverWidths = new Map();
for (const m of php.matchAll(/score_vector\(score_value\(\$value, '(\w+)'\), (\d+), /g)) {
  const [, key, width] = m;
  serverWidths.set(key, Math.max(serverWidths.get(key) ?? 0, Number(width)));
}

assert.ok(clientWidths.size >= 6, `expected the client to declare several wire vectors, saw ${clientWidths.size}`);
assert.deepEqual([...clientWidths.keys()].sort(), [...serverWidths.keys()].sort(),
  "client and server must validate the same set of wire vectors — one side knowing about a key the " +
  "other does not means that field is either never sent or never accepted");
for (const [key, width] of clientWidths) {
  assert.equal(serverWidths.get(key), width,
    `wire vector "${key}": client posts ${width} elements, score_schema.php validates ` +
    `${serverWidths.get(key)}. A mismatch is silent — score_vector returns null on the wrong length, ` +
    `so the field is dropped from every uploaded run rather than erroring.`);
}

// --- 2. those pinned widths must match the constants they actually represent -------------------------
const count = (re) => game.match(re)[1].split(",").length;
const CAL = count(/const CAL_LABELS = \[(.*)\];/);
const MORT = count(/const MORT_LABELS = \[(.*)\];/);
const LIFE_BINS = Number(game.match(/const LIFE_BINS = (\d+)/)[1]);
const RES = (game.slice(game.indexOf("const RESOURCES = [")).split("];")[0].match(/\{ *(?:id|key|name):/g) || []).length;

assert.ok(RES > 0, "could not count RESOURCES — this test needs to be taught the new shape");
assert.equal(clientWidths.get("cin"), CAL,
  `the calorie wire vector is ${clientWidths.get("cin")} wide but there are ${CAL} calorie sources. ` +
  "Adding a source means bumping BOTH the client literal and score_schema.php, and keeping a legacy " +
  "fallback at the old width so records already on the leaderboard still validate.");
assert.equal(clientWidths.get("mort"), MORT, "the mortality wire vector must be one slot per cause of death");
assert.equal(clientWidths.get("lsp"), LIFE_BINS, "the lifespan wire vector must be one slot per log2 age bin");
assert.equal(clientWidths.get("sub"), RES, "the substrate wire vector must be one slot per resource");

// --- 3. widening a vector must keep a legacy fallback, or existing records lose the field ------------
assert.match(game, /scoreClientVector\(value\.cin, 6, 100000000\) \|\| scoreClientVector\(value\.cin, 5, 100000000\)/,
  "the client must still accept the legacy 5-source calorie vector from records saved before autotrophy");
assert.match(php, /score_vector\(score_value\(\$value, 'cin'\), 5, 100000000\)[\s\S]*?\$cin\[\] = 0;/,
  "the server must still accept the legacy 5-source vector and pad it, not reject it");
assert.match(game, /while \(cin\.length < 6\) cin\.push\(0\)/,
  "a legacy vector must be padded to the current width before it reaches the chart, or the renderer " +
  "reads undefined for the missing source");

console.log(
  `Wire-format contracts OK: ${clientWidths.size} vectors agree client↔server ` +
  `(cin=${CAL}, mort=${MORT}, lsp=${LIFE_BINS}, sub=${RES}), legacy calorie records still accepted.`);
