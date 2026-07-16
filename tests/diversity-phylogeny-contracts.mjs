import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const game = readFileSync(new URL("../game.js", import.meta.url), "utf8");
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");

assert.match(html,
  /id="analysisSubChart"[\s\S]*?id="analysisMortChart"[\s\S]*?Ecotype diversity[\s\S]*?id="analysisDiversityChart"/,
  "the end screen must show food, mortality, then a dedicated diversity chart");
assert.match(html,
  /id="detailSubChart"[\s\S]*?id="detailMortChart"[\s\S]*?Ecotype diversity[\s\S]*?id="detailDiversityChart"/,
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
const sameEcotypeTiers = diversityIndices({ buckets: { 0: 5, 1: 5 } });
assert.deepEqual(sameEcotypeTiers, { richness: 1, shannon: 0 },
  "adaptation tiers within one ecotype must not inflate ecological diversity");

const diversityRenderer = game.slice(game.indexOf("function renderDiversityChart"), game.indexOf("function drawHelix"));
assert.match(diversityRenderer, /const yRichness = [\s\S]*const yShannon = /,
  "richness and Shannon H′ must each have a legible scale");
assert.match(diversityRenderer, /g\.strokeStyle = RICHNESS_COLOR[\s\S]*g\.strokeStyle = SHANNON_COLOR/,
  "both diversity indices must be drawn simultaneously with stable colors");
assert.match(game, /function drawAnalysis\(\)[\s\S]*annotateDiversity\([^;]+state\.fullHist/,
  "the end screen must render run diversity");
assert.match(game, /function openScoreDetail\([^)]*\)[\s\S]*annotateDiversity\([^;]+rec\.hist/,
  "high-score detail must render saved-run diversity");

const clado = game.slice(game.indexOf("function drawClado"), game.indexOf("function showLineageCircos"));
assert.match(clado, /maxDepth\*48 \+ labelBand/,
  "a down-facing phylogeny must size its height from adaptation depth");
assert.match(clado, /tips\.forEach\(\(tip, i\) => \{ tip\.x =/,
  "terminal lineages must spread horizontally along the bottom");
assert.match(clado, /const yAt = \(depth\) => padT \+ \(maxDepth \? depth\/maxDepth/,
  "adaptation depth must increase down the vertical axis");
assert.match(clado, /const x0 = xOf\.get\(n\), y0 = yAt\(n\.depth\)[\s\S]*const x1 = xOf\.get\(c\), y1 = yAt\(c\.depth\)/,
  "ancestral branches must descend from parent depth to child depth");
assert.match(clado, /g\.moveTo\(xn, yn\); g\.lineTo\(x, tipY\)/,
  "each terminal lineage must connect down to the shared tip row");
assert.doesNotMatch(clado, /const xAt = \(d\)/,
  "the old right-facing depth axis must not return");

console.log("Diversity and phylogeny contracts OK: S/H′ are correct and ancestry runs top-to-bottom.");
