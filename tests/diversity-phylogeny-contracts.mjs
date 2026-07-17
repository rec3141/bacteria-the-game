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
assert.match(game, /function toggleSubMode\(\) \{ subMode = \(subMode \+ 1\) % 4; updateSubLegend\(\); \}/,
  "the compact gameplay chart must cycle through all four companion views (food, mortality, diversity, calories)");
assert.match(game, /function renderSubChart\([^)]*\) \{\s*if \(mode === 2\) \{ renderDiversityChart\(g, W, H, hist, denom\); return; \}/,
  "the third compact gameplay view must reuse the diversity renderer");
assert.match(game, /richness S[\s\S]*Shannon H′[\s\S]*title = "lineage diversity"/,
  "the live diversity view must identify both indices with the analysis-chart colors");

const clado = game.slice(game.indexOf("function drawClado"), game.indexOf("function showLineageCircos"));
assert.match(clado, /maxDepth\*48 \+ labelBand/,
  "a down-facing phylogeny must size its height from adaptation depth");
assert.match(clado, /tips\.forEach\(\(tip, i\) => \{ tip\.x =/,
  "terminal lineages must spread horizontally along the bottom");
assert.match(clado, /const yAt = \(depth\) => padT \+ \(maxDepth \? depth\/maxDepth/,
  "adaptation depth must increase down the vertical axis");
assert.match(clado, /const x0 = xOf\.get\(n\), y0 = yAt\(n\.depth\)[\s\S]*const x1 = xOf\.get\(c\), y1 = yAt\(c\.depth\)/,
  "ancestral branches must descend from parent depth to child depth");
assert.match(clado, /g\.moveTo\(xn, yn\); g\.lineTo\(x, yn\); g\.lineTo\(x, tipY\)/,
  "each terminal lineage must elbow down to the shared tip row (planar, no crossing diagonals)");
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
assert.match(game, /if \(mode === 3\) return \(s && s\.cin\) \? s\.cin : \[0,0,0,0,0\];/,
  "the sub-chart reads the 5-source calorie vector in mode 3");

// The shared log/linear toggle (chartLog) drives EVERY companion chart, not just community-vs-time:
// the stacked sub-charts use the same geometric-sum bandVal stacking, and richness follows too.
const subRenderer = game.slice(game.indexOf("function renderSubChart"), game.indexOf("function renderDiversityChart"));
assert.match(subRenderer, /cum\[i\] \+ bandVal\(vals\[i\]\[k\] \|\| 0\)/,
  "stacked sub-charts (food/mortality/calories) stack bandVal so they follow chartLog like the community chart");
assert.match(subRenderer, /maxY = chartLog \?/, "the sub-chart axis switches with the shared log toggle");
const divRenderer = game.slice(game.indexOf("function renderDiversityChart"), game.indexOf("function drawHelix"));
assert.match(divRenderer, /const yRichness = chartLog \?/,
  "richness follows the shared log toggle (Shannon H′ stays linear — it is already an entropy)");

console.log("Diversity and phylogeny contracts OK: S/H′ correct, ancestry top-to-bottom, calorie tracker wired.");
