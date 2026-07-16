import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const game = readFileSync(resolve(root, "game.js"), "utf8");
const block = game.match(/\/\/ SCORE_NORMALIZER_START[\s\S]*?\/\/ SCORE_NORMALIZER_END/)?.[0];
assert(block, "production score normalizer block is missing");
const { normalizeScoreList } = new Function(`${block}\nreturn { normalizeScoreList };`)();

const board = normalizeScoreList([
  {
    id: 1, date: 1, score: 100000000,
    hist: [{}], upgrades: {}, lineages: [], roleSwaps: {},
  },
  {
    id: 2, date: 2, score: 20, gen: 3, dur: 4,
    hist: [
      { eco: [1, 2, 3, 4, 5, 6, 7, 8], p: 2, v: 3, buckets: { 0: 2, 999: 5 }, sub: [1, 2, 3], mort: [4, 3, 2, 1] },
      { eco: {}, p: 0, v: 0 },
    ],
    upgrades: [
      { t: 2, label: "Lipase 1", abbr: "L1", color: "#efd98a", acquired: true },
      { t: "bad", label: {}, abbr: {}, color: "url(evil)", acquired: "yes" },
    ],
    lineages: { 64: {
      t: 2,
      ups: [{ t: 2, label: "Lipase 1", abbr: "L1", color: "#efd98a", acquired: true }],
      tree: [{ t: 2, label: "Lipase 1", abbr: "L1", color: "#efd98a", acquired: true }],
      variants: [{ t: 3, ups: [], tree: [{ t: 3, label: "Lost lipase", abbr: "xL1", color: "#efd98a" }] }],
    } },
    roleSwaps: [2, "bad", null],
  },
]);

assert.equal(board.length, 2);
assert.deepEqual(board[0].hist, [], "malformed history samples must be discarded");
assert.deepEqual(board[0].upgrades, [], "an upgrade object must not masquerade as an array");
assert.deepEqual(board[0].lineages, {}, "a lineage array must not masquerade as an object map");
assert.equal(board[1].hist.length, 1);
assert.equal(board[1].hist[0].eco.length, 8);
assert.deepEqual(board[1].hist[0].buckets, { 0: 2 });
assert.equal(board[1].upgrades.length, 1);
assert.equal(board[1].lineages[64].ups.length, 1);
assert.equal(board[1].lineages[64].tree.length, 1);
assert.equal(board[1].lineages[64].variants.length, 1);
assert.equal(board[1].lineages[64].variants[0].tree[0].abbr, "xL1");
assert.deepEqual(board[1].roleSwaps, [2]);
assert.deepEqual(normalizeScoreList({ 0: board[0] }), [], "a board object must not masquerade as a list");

const showScores = game.slice(game.indexOf("function showScores(opts)"), game.indexOf("function hideScores()"));
assert.match(showScores, /coldSharedBoard[\s\S]*?renderScoreLoading\(\)[\s\S]*?request\.then\(\(loaded\)/,
  "the first leaderboard open must wait for the shared board instead of flashing local rows");
assert.match(showScores, /if \(!loaded[\s\S]*?renderScoreList\(\)/,
  "a failed shared request must still reveal the browser-local fallback");
const fetchScores = game.slice(game.indexOf("function fetchScores()"), game.indexOf("function refreshScoreListIfOpen"));
assert.match(fetchScores, /if \(scoreFetchPromise\) return scoreFetchPromise/,
  "overlapping leaderboard opens must share one fetch rather than race UI replacements");

for (const record of board) {
  for (const sample of record.hist) assert.equal(sample.eco.length, 8);
  for (const upgrade of record.upgrades) assert.match(upgrade.color, /^#[0-9A-Fa-f]{3,8}$/);
}

console.log("Leaderboard safety OK: malformed nested arrays and objects normalize without renderer hazards.");
