import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// The day-scaled phylogeny must SHOW lineage death: a lineage absent from the run's final sample stops
// on the day it vanished, capped with a dagger and an exact-clock demise label; a lineage still present
// at the end runs to the bottom with its band swatch. History samples carry no timestamp of their own —
// time is the sample index scaled by the run duration (i/(n-1)·dur), exactly how the charts place them —
// so this also guards that renderClado derives demise time from dur, not from a (non-existent) sample .t.
const game = readFileSync(new URL("../game.js", import.meta.url), "utf8");
const block = game.slice(game.indexOf("function buildClado"), game.indexOf("function showLineageCircos"));

function mockCtx() {
  const rects = [], arcs = [], texts = []; let path = []; const noop = () => {};
  return { rects, arcs, texts,
    beginPath() { path = []; }, moveTo(x, y) { path.push([x, y]); }, lineTo(x, y) { path.push([x, y]); }, stroke: noop,
    fillRect(x, y, w, h) { rects.push({ x, y, w, h }); }, arc(x, y, r) { arcs.push({ x, y, r }); }, fill: noop,
    fillText(t, x, y) { texts.push({ t, x, y }); }, clearRect: noop,
    save: noop, restore: noop, translate: noop, rotate: noop };
}
const factory = new Function(`
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v)), TAU = Math.PI * 2;
  const CFG = { day: { lengthSec: 240 } };
  const CHART = { surface: "#000" };
  const RESOURCES = [{ color: "#a" }, { color: "#b" }, { color: "#c" }];
  const levelColor = () => "#fff";
  const sampleBuckets = (s) => (s && s.buckets) || {};
  const clockAt = (sec) => "@" + Math.round(sec || 0);   // stand-in; only that a time appears matters here
  ${block}
  return { renderClado };
`);
const { renderClado } = factory();

// A 600s run (2.5 days). Two lineages die mid-run (drop out of later samples); two survive to the end.
const rec = {
  dur: 600,
  lineages: {
    10:  { tree: [] },                                          // founder — survives
    100: { tree: [{ abbr: "L1", t: 40 }] },                    // dies ~180s (day 1)
    200: { tree: [{ abbr: "C4", t: 60 }, { abbr: "Tw", t: 210 }] }, // dies ~430s (day 2)
    300: { tree: [{ abbr: "C4", t: 60 }, { abbr: "Cr", t: 250 }] }, // survives
  },
  hist: [],
};
for (let i = 0; i < 15; i++) {
  const t = i / 14 * 600, b = { 10: 5, 300: 10 };
  if (t <= 180) b[100] = 3;
  if (t <= 430) b[200] = 4;
  rec.hist.push({ buckets: b });
}

const g = mockCtx();
renderClado(g, 1100, 900, rec);

const daggers = g.texts.filter((t) => t.t === "†");
const swatches = g.rects.filter((r) => r.w === 10);            // tip swatches are 10px; day bands span the width
const dayLabels = g.texts.filter((t) => /^Day /.test(t.t)).map((t) => t.t);

assert.equal(daggers.length, 2, "the two lineages absent from the final sample must each be capped with a dagger");
assert.equal(swatches.length, 2, "the two lineages present at the end must each run to a band swatch");
assert.deepEqual(dayLabels, ["Day 1", "Day 2", "Day 3"], "the vertical axis must be banded and labelled by day");

// The dagger caps must sit ABOVE the surviving swatches — a lineage that died earlier ends higher up.
const maxDaggerY = Math.max(...daggers.map((d) => d.y)), minSwatchY = Math.min(...swatches.map((s) => s.y));
assert.ok(maxDaggerY < minSwatchY + 1, "an extinct branch must terminate no lower than a surviving one");

// And the earlier death (100, ~180s) must cap higher than the later death (200, ~430s).
const [d1, d2] = daggers.map((d) => d.y).sort((a, b) => a - b);
assert.ok(d1 < d2, "an earlier extinction must terminate higher up the day axis than a later one");

// The per-lineage BAR CHART replaces the old text labels: one bar per terminal lineage, on a shared
// baseline, height ∝ log(cumulative cells). Bars are the narrow rects (not the 10px swatches, not the
// full-width day bands). All four lineages get a bar; the biggest producer (300, cum 150) out-tops the
// rarest flicker (100, cum 15) — but only logarithmically, never linearly.
const bars = g.rects.filter((r) => r.w >= 2 && r.w <= 12 && r.w !== 10);
assert.equal(bars.length, 4, "every terminal lineage must get one cumulative-abundance bar");
const heights = bars.map((b) => b.h);
const tall = Math.max(...heights), short = Math.min(...heights);
assert.ok(tall > short, "bars must vary with cumulative abundance, not be uniform");
// log, not linear: cum 150 vs 15 is a 10× ratio, but the taller bar must be far less than 10× the shorter.
assert.ok(tall < short * 5, "the bar axis must be logarithmic (a 10× abundance gap is not a 10× bar)");
assert.ok(g.texts.some((t) => /log .* cells/i.test(t.t)), "the bar chart must label its log axis");
assert.equal(g.texts.filter((t) => /at peak/.test(t.t)).length, 0, "the old rotated per-tip text labels must be gone");

console.log("Cladogram extinction contract OK: deaths render, day axis, earlier deaths sit higher, log-cumulative bar chart replaces text.");
