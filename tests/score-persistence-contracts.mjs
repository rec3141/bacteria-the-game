import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const game = readFileSync(new URL("../game.js", import.meta.url), "utf8");
const source = game.match(/function scoreWorthSaving\(rec\) \{[\s\S]*?\n  \}/)?.[0];
assert.ok(source, "the production empty-run predicate is present");
const scoreWorthSaving = new Function(`${source}\nreturn scoreWorthSaving;`)();

const empty = { score: 0, gen: 1, upgrades: [], roleSwaps: [], dur: 400, hist: [{ eco: [1] }] };
assert.equal(scoreWorthSaving(empty), false,
  "elapsed time and automatic history alone must not turn an idle run into a high score");
assert.equal(scoreWorthSaving({ ...empty, score: 1 }), true, "eating calories is meaningful progress");
assert.equal(scoreWorthSaving({ ...empty, gen: 2 }), true, "division is meaningful progress");
assert.equal(scoreWorthSaving({ ...empty, upgrades: [{ abbr: "L1" }] }), true, "an adaptation is meaningful progress");
assert.equal(scoreWorthSaving({ ...empty, roleSwaps: [{ to: "protist" }] }), true, "a trophic-role change is meaningful progress");

const record = game.slice(game.indexOf("function recordGame()"), game.indexOf("function queueScoreWrite"));
const guard = record.indexOf("if (!scoreWorthSaving(rec))");
assert.ok(guard >= 0, "recordGame must guard empty runs");
assert.ok(guard < record.indexOf("localStorage.setItem(HS_KEY"), "the empty-run guard must precede local persistence");
assert.ok(guard < record.indexOf("submitScore(rec)"), "the empty-run guard must precede shared submission");
assert.match(game, /const scoreRecorded = recordGame\(\);[\s\S]*?nameRow\.classList\.toggle\("hidden", !scoreRecorded\)/,
  "an unsaved empty run must not ask for a leaderboard name");

console.log("Score persistence contracts OK: idle runs are skipped while real progress still records.");
