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
      { eco: [1, 2, 3, 4, 5, 6, 7, 8], p: 2, v: 3, buckets: { 0: 2, 999: 5, 5000: 9 }, sub: [1, 2, 3], mort: [4, 3, 2, 1] },
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
    roleSwaps: [{ t: 5, to: "protist" }, 2, "bad", null],
  },
]);

assert.equal(board.length, 2);
assert.deepEqual(board[0].hist, [], "malformed history samples must be discarded");
assert.deepEqual(board[0].upgrades, [], "an upgrade object must not masquerade as an array");
assert.deepEqual(board[0].lineages, {}, "a lineage array must not masquerade as an object map");
assert.equal(board[1].hist.length, 1);
assert.equal(board[1].hist[0].eco.length, 8);
assert.deepEqual(board[1].hist[0].buckets, { 0: 2, 999: 5 }, "widened lineage buckets keep keys 0-4095; 5000 is out of range and dropped");
assert.equal(board[1].upgrades.length, 1);
assert.equal(board[1].lineages[64].ups.length, 1);
assert.equal(board[1].lineages[64].tree.length, 1);
assert.equal(board[1].lineages[64].variants.length, 1);
assert.equal(board[1].lineages[64].variants[0].tree[0].abbr, "xL1");
assert.deepEqual(board[1].roleSwaps, [{ t: 5, to: "protist" }], "role swaps are {t,to} objects now; bare numbers/nulls are dropped");
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

// ---- the scenario chip -----------------------------------------------------------------------
// A row now says which ocean the score was set in, and links to it. The id reaches an href, so it is
// constrained to the same slug shape the game demands before it will fetch a scenario — and anything
// else is DROPPED rather than cleaned, because a malformed id has no meaning worth preserving.
{
  const normalizer = game.slice(game.indexOf("function normalizeScoreRecord"), game.indexOf("// SCORE_NORMALIZER_END"));
  assert.match(normalizer, /scenario: typeof value\.scenario === "string" && \/\^\[a-z0-9-\]\{1,64\}\$\/\.test/,
    "an incoming scenario id must be slug-checked, not trusted");

  const chip = game.slice(game.indexOf("const chipHtml ="), game.indexOf("let h = `<table id=\"scoresTable\">"));
  assert.match(chip, /escapeHtml\(label\)/, "a scenario title is authored elsewhere and must be escaped");
  assert.match(chip, /encodeURIComponent\(id\)/, "the id must be encoded into the link");
  assert.ok(!/innerHTML\s*=/.test(chip), "the chip must be built as escaped markup, not assigned raw");
  // the paper belongs with the lesson on the scenario card, not repeated down a table of numbers
  assert.ok(!/doi\.org/.test(chip), "the leaderboard must not carry a DOI link");

  // ...and on that card it is built from DOM nodes, because the citation is authored text that
  // happens to contain a DOI — only the matched DOI may become a link.
  const cite = game.slice(game.indexOf("function renderCitation"), game.indexOf("// Swap the title screen's lede"));
  assert.match(cite, /node\.textContent = ""/, "the citation node must be cleared, not appended to");
  assert.match(cite, /createTextNode/, "the non-DOI remainder must stay text");
  assert.match(cite, /a\.href = "https:\/\/doi\.org\/" \+ encodeURI\(doi\)/,
    "the link must be built from the matched DOI only — never from the raw citation");
  assert.match(cite, /rel = "noopener noreferrer"/, "an outbound paper link must not hand over window.opener");
  assert.ok(!/innerHTML/.test(cite), "the citation must never be assigned as markup");

  // and the PHP side must keep the field, or it never survives a round trip through the board
  const schema = readFileSync(resolve(root, "score_schema.php"), "utf8");
  assert.match(schema, /'scenario' => score_slug\(/, "the server must normalize the scenario id");
  assert.match(schema, /function score_slug/, "score_slug must exist");
  assert.match(schema, /preg_match\('\/\^\[a-z0-9-\]\{1,' \. \(int\)\$max \. '\}\$\/'/,
    "the server must apply the same slug shape as the client");
}

console.log("Leaderboard safety OK: malformed nested arrays and objects normalize without renderer hazards.");
