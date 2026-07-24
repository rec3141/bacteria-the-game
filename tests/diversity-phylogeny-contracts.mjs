import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const game = readFileSync(new URL("../game.js", import.meta.url), "utf8");
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");

assert.match(html,
  /id="analysisSubChart"[\s\S]*?id="analysisMortChart"[\s\S]*?Lineage diversity[\s\S]*?id="analysisDiversityChart"/,
  "the end screen must show food, mortality, then a dedicated diversity chart");
assert.match(html,
  /id="detailSubChart"[\s\S]*?id="detailMortChart"[\s\S]*?Lineage diversity[\s\S]*?id="detailDiversityChart"/,
  "high-score details must show the same three companion charts");

const sampleBucketsSource = game.match(/function sampleBuckets\(s\) \{[\s\S]*?\n  \}/)?.[0];
const diversitySource = game.match(/function diversityIndices\(s\) \{[\s\S]*?\n  \}/)?.[0];
assert.ok(sampleBucketsSource && diversitySource, "production diversity helpers must be extractable");
const diversityIndices = new Function(`${sampleBucketsSource}\n${diversitySource}\nreturn diversityIndices;`)();
const even = diversityIndices({ eco: [5, 5, 0, 0, 0, 0, 0, 0] });
assert.equal(even.richness, 2);
assert.ok(Math.abs(even.shannon - Math.log(2)) < 1e-12, "two even lineages must have Shannon H′ = ln(2)");
const uneven = diversityIndices({ eco: [9, 1, 0, 0, 0, 0, 0, 0] });
assert.equal(uneven.richness, 2);
assert.ok(Math.abs(uneven.shannon - (-(0.9*Math.log(0.9) + 0.1*Math.log(0.1)))) < 1e-12,
  "Shannon H′ must include lineage evenness");
assert.deepEqual(diversityIndices({ eco: [] }), { richness: 0, shannon: 0 });
const legacy = diversityIndices({ eco: [5, 0, 5, 0, 0, 0, 0, 0] });
assert.equal(legacy.richness, 2, "legacy scores must derive richness through eco[] fallback buckets");
assert.ok(Math.abs(legacy.shannon - Math.log(2)) < 1e-12, "legacy scores must derive Shannon H′ too");
const distinctTierBands = diversityIndices({ buckets: { 0: 5, 1: 5 } });
assert.equal(distinctTierBands.richness, 2,
  "lineage diversity counts each coexisting generation band (mask+tier): two tiers are two lineages");
assert.ok(Math.abs(distinctTierBands.shannon - Math.log(2)) < 1e-12,
  "two evenly-populated tier bands give Shannon H′ = ln(2)");

const diversityRenderer = game.slice(game.indexOf("function renderDiversityChart"), game.indexOf("function drawHelix"));
assert.match(diversityRenderer, /const yRichness = [\s\S]*const yShannon = /,
  "richness and Shannon H′ must each have a legible scale");
assert.match(diversityRenderer, /g\.strokeStyle = RICHNESS_COLOR[\s\S]*g\.strokeStyle = SHANNON_COLOR/,
  "both diversity indices must be drawn simultaneously with stable colors");
assert.match(game, /function drawAnalysis\(\)[\s\S]*annotateDiversity\([^;]+state\.fullHist/,
  "the end screen must render run diversity");
assert.match(game, /function openScoreDetail\([^)]*\)[\s\S]*annotateDiversity\([^;]+rec\.hist/,
  "high-score detail must render saved-run diversity");
assert.match(game, /function toggleSubMode\(\) \{ subMode = \(subMode \+ 1\) % 5; updateSubLegend\(\); \}/,
  "the compact gameplay chart must cycle through all five companion views (food, mortality, diversity, calories, lifespan)");
assert.match(game, /function renderSubChart\([^)]*\) \{\s*if \(mode === 2\) \{ renderDiversityChart\(g, W, H, hist, denom\); return; \}/,
  "the third compact gameplay view must reuse the diversity renderer");
assert.match(game, /richness S[\s\S]*Shannon H′[\s\S]*title = "lineage diversity"/,
  "the live diversity view must identify both indices with the analysis-chart colors");

const clado = game.slice(game.indexOf("function drawClado"), game.indexOf("function showLineageCircos"));
assert.match(clado, /timeMode \? days\*180 : maxDepth\*48/,
  "the phylogeny must size its height per DAY when timed, falling back to adaptation depth");
assert.match(clado, /tips\.forEach\(\(tip, i\) => \{ tip\.x =/,
  "terminal lineages must spread horizontally along the bottom");
assert.match(clado, /const yTime = \(t\) => padT \+ \(tMax \? clamp\(t\/tMax/,
  "the vertical axis must map run-clock time downward (day by day)");
assert.match(clado, /const yAt = \(depth\) => padT \+ \(maxDepth \? depth\/maxDepth/,
  "a record without timestamps must still fall back to an adaptation-depth axis");
assert.match(clado, /const yNode = \(n\) => timeMode \? yTime\(nodeT\.get\(n\)\) : yAt\(n\.depth\)/,
  "node vertical position must be time when timed, depth otherwise");
assert.match(clado, /const x0 = xOf\.get\(n\), y0 = yNode\(n\)[\s\S]*const x1 = xOf\.get\(c\), y1 = yNode\(c\)/,
  "ancestral branches must descend from parent time to child time");
assert.match(clado, /g\.moveTo\(xn, yn\); g\.lineTo\(x, yn\); g\.lineTo\(x, endY\)/,
  "each terminal lineage must elbow down to its demise day (planar, no crossing diagonals)");
assert.match(clado, /const extinct = timeMode && seen != null && seen < present - 1e-6/,
  "a lineage absent from the final sample must be marked extinct");
assert.match(clado, /fillText\("Day " \+ \(d \+ 1\)/,
  "the vertical axis must be labelled by day");
assert.doesNotMatch(clado, /const xAt = \(d\)/,
  "the old right-facing depth axis must not return");

// Calories-consumed-by-source tracker (mode 3): accumulated at the eating sites, sampled into history
// alongside mort, and shown as its own companion chart on the end screen and saved-run detail.
assert.match(html, /id="analysisCalChart"/, "the end screen must show a calories-consumed chart");
assert.match(html, /id="detailCalChart"/, "the saved-run detail must show the same calories chart");
assert.match(html,
  /id="analysisMortChart"[\s\S]*?Calories consumed[\s\S]*?id="analysisCalChart"[\s\S]*?id="analysisDiversityChart"/,
  "calories sits between mortality and diversity on the end screen");
assert.match(game, /state\.calLive\[src\] \+= cal; state\.calFull\[src\] \+= cal;/,
  "eating a mote credits calories to its source bucket (lipid/protein/carb/protist-biomass)");
assert.match(game, /state\.calLive\[CAL_PHAGE\] \+= CFG\.cell\.crisprEnergy; state\.calFull\[CAL_PHAGE\]/,
  "CRISPR-harvesting a phage credits the phage calorie bucket — the source to watch for a runaway");
assert.match(game, /mort: state\.mortLive, cin: state\.calLive/,
  "each live sample records calorie intake by source");
assert.match(game, /if \(mode === 3\) return \(s && s\.cin\) \? s\.cin : new Array\(CAL_LABELS\.length\)\.fill\(0\);/,
  "the sub-chart reads the calorie vector in mode 3, falling back to a full-width zero vector — a " +
  "fallback narrower than the real vector renders a truncated chart on any sample missing the key");
// the vector, its colours and its labels must stay the same width, or the legend mislabels the chart
{
  // to end of line, not to the first "]" — CAL_COLORS contains RESOURCES[0] and friends
  const items = (re) => game.match(re)[1].split(",").length;
  const labels = items(/const CAL_LABELS = \[(.*)\];/);
  const colors = items(/const CAL_COLORS = \[(.*)\];/);
  const live = items(/calLive: \[(.*?)\], calFull/);
  assert.equal(labels, colors, "every calorie source needs a colour");
  assert.equal(labels, live, "every calorie source needs a slot in the per-interval vector");
}
// ...and the per-interval RESET must be the same width as the vector it resets. A hand-written literal
// here was left at 5 when autotrophy became the 6th source: the first sample charted correctly, then
// every later interval wrote `undefined + fixed` = NaN into calLive[5] and autotrophy vanished from the
// chart. Derive the width from the label arrays so the two cannot drift apart again.
assert.match(game, /state\.mortLive = new Array\(MORT_LABELS\.length\)\.fill\(0\);/,
  "the mortality tally must reset to exactly as many slots as there are causes of death");
assert.match(game, /state\.calLive = new Array\(CAL_LABELS\.length\)\.fill\(0\);/,
  "the calorie tally must reset to exactly as many slots as there are calorie sources");
assert.doesNotMatch(game, /state\.(mortLive|calLive) = \[0(, ?0)*\];/,
  "no hand-counted reset literals — that is the bug that hid autotrophy");
// Records already on the leaderboard carry the old 5-source vector; both normalizers must still take
// them and pad, or every existing run silently loses its calorie breakdown the day this ships.
assert.match(game, /scoreClientVector\(value\.cin, 6, 100000000\) \|\| scoreClientVector\(value\.cin, 5, 100000000\)/,
  "the client must accept a legacy 5-source calorie vector as well as the current 6");
{
  const php = readFileSync(new URL("../score_schema.php", import.meta.url), "utf8");
  assert.match(php, /score_vector\(score_value\(\$value, 'cin'\), 6, 100000000\)/, "the server takes the 6-source vector");
  assert.match(php, /score_vector\(score_value\(\$value, 'cin'\), 5, 100000000\)[\s\S]*?\$cin\[\] = 0;/,
    "and falls back to the legacy 5, padding the missing source");
}

// The shared log/linear toggle (chartLog) drives EVERY companion chart, not just community-vs-time:
// the stacked sub-charts use the same geometric-sum bandVal stacking, and richness follows too.
const subRenderer = game.slice(game.indexOf("function renderSubChart"), game.indexOf("function renderDiversityChart"));
assert.match(subRenderer, /cum\[i\] \+ bandVal\(vals\[i\]\[k\] \|\| 0\)/,
  "stacked sub-charts (food/mortality/calories) stack bandVal so they follow chartLog like the community chart");
assert.match(subRenderer, /maxY = chartLog \?/, "the sub-chart axis switches with the shared log toggle");
const divRenderer = game.slice(game.indexOf("function renderDiversityChart"), game.indexOf("function drawHelix"));
assert.match(divRenderer, /const yRichness = chartLog \?/,
  "richness follows the shared log toggle (Shannon H′ stays linear — it is already an entropy)");

// Cell-lifespan turnover spectrogram (sub-chart mode 4): birth time on cells, age-at-death binned into
// log2 buckets, sampled as `lsp`, drawn as a heatmap on the end screen and saved-run detail.
assert.match(html, /id="analysisLifeChart"/, "the end screen must show the lifespan spectrogram");
assert.match(html, /id="detailLifeChart"/, "the saved-run detail must show the same spectrogram");
assert.match(html,
  /id="analysisDiversityChart"[\s\S]*?Cell lifespan[\s\S]*?id="analysisLifeChart"/,
  "the lifespan spectrogram sits after diversity on the end screen");
assert.match(game, /born: state \? state\.elapsed : 0/, "cells record a birth time for age-at-death");
assert.match(game, /const b = lifeBin\(state\.elapsed - c\.born\); state\.lifeLive\[b\]\+\+; state\.lifeFull\[b\]\+\+;/,
  "each death is binned into the lifespan histogram by its age");
assert.match(game, /mort: state\.mortLive, cin: state\.calLive, lsp: state\.lifeLive/,
  "each live sample records the lifespan histogram");
assert.match(game, /if \(mode === 4\) \{ renderLifespanChart\(g, W, H, hist, denom\); return; \}/,
  "sub-chart mode 4 draws the lifespan spectrogram");

console.log("Diversity and phylogeny contracts OK: S/H′ correct, ancestry top-to-bottom, calorie tracker wired.");
