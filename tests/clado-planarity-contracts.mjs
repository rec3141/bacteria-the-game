import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Guards #27: the phylogeny cladogram must be PLANAR — no two drawn edges may cross. We run the REAL
// production buildClado + renderClado (sliced out of game.js) against a mock canvas that records every
// stroked line segment, then check for proper crossings. Colour/bucket helpers are stubbed because tip
// positions don't depend on them; only the geometry matters here.
const game = readFileSync(new URL("../game.js", import.meta.url), "utf8");
const block = game.slice(game.indexOf("function buildClado"), game.indexOf("function showLineageCircos"));
assert.ok(block.includes("function renderClado"), "renderClado must be extractable for the planarity check");

// A mock 2D context that turns moveTo/lineTo/stroke into line segments and ignores everything else.
function makeMockCtx() {
  const segments = [];
  let path = [];
  const noop = () => {};
  return {
    segments,
    beginPath() { path = []; },
    moveTo(x, y) { path.push([x, y]); },
    lineTo(x, y) { path.push([x, y]); },
    stroke() { for (let i = 1; i < path.length; i++) segments.push([path[i - 1], path[i]]); },
    save: noop, restore: noop, translate: noop, rotate: noop,
    clearRect: noop, fillRect: noop, fill: noop, arc: noop, fillText: noop,
    // property setters are just plain assignments on the object
  };
}

const factory = new Function(`
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const TAU = Math.PI * 2;
  const CFG = { day: { lengthSec: 240 } };            // the time axis reads day length from here
  const CHART = { surface: "#06181d" };
  const RESOURCES = [{ color: "#efd98a" }, { color: "#ef8b3c" }, { color: "#6fa8ff" }];
  const levelColor = () => "#ffffff";                 // colour never moves a point
  const sampleBuckets = (s) => (s && s.buckets) || {}; // peak only tints/labels; geometry ignores it
  const clockAt = (sec) => String(Math.round(sec || 0)); // demise label; content is irrelevant to geometry
  ${block}
  return { buildClado, renderClado };
`);
const { renderClado } = factory();

// Proper segment intersection: true only when the interiors cross. Shared endpoints (siblings meeting at
// a parent, an elbow's own corner) and collinear overlaps (two verticals sharing a column) are NOT crossings.
function properCross([p1, p2], [p3, p4]) {
  const d = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const d1 = d(p3, p4, p1), d2 = d(p3, p4, p2), d3 = d(p1, p2, p3), d4 = d(p1, p2, p4);
  const opp = (u, v) => (u > 1e-7 && v < -1e-7) || (u < -1e-7 && v > 1e-7);
  return opp(d1, d2) && opp(d3, d4);
}
function crossings(segments) {
  let n = 0;
  for (let i = 0; i < segments.length; i++)
    for (let j = i + 1; j < segments.length; j++)
      if (properCross(segments[i], segments[j])) n++;
  return n;
}

// Adversarial runs — the exact shapes that tangle a straight-diagonal tree: founders that never adapted,
// lineages that stop at internal nodes, gene-loss (x-prefixed) branches, and convergent variants.
let seed = 987654321;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const GENES = ["L1", "P1", "T1", "C3", "C4", "C5", "Tw", "Cr", "Ab", "Eps", "xL1", "xP1", "xTw", "xCr", "xC4"];
function randomRun() {
  const lineages = {}, n = 3 + (rnd() * 20 | 0);
  for (let i = 0; i < n; i++) {
    const tree = [];
    for (let d = 0, depth = rnd() * 6 | 0; d < depth; d++) tree.push({ abbr: GENES[rnd() * GENES.length | 0] });
    const lin = { tree };
    if (rnd() < 0.25) {
      const vt = [];
      for (let d = 0, depth = rnd() * 5 | 0; d < depth; d++) vt.push({ abbr: GENES[rnd() * GENES.length | 0] });
      lin.variants = [{ tree: vt }];
    }
    lineages[rnd() * 4096 | 0] = lin;
  }
  return { lineages, hist: [] };
}

// Time-mode runs: every mutation carries an increasing run-clock `t`, and a history with per-day buckets
// makes some lineages go extinct mid-run (dropping out of later samples). This exercises the DAY axis —
// branch nodes placed by time, tips stopping at their demise day — which must ALSO stay planar.
function randomTimedRun() {
  const lineages = {}, n = 3 + (rnd() * 18 | 0);
  const keys = [];
  const dayLen = 240, spanDays = 1 + (rnd() * 3 | 0);
  for (let i = 0; i < n; i++) {
    const tree = []; let t = rnd() * 20;
    for (let d = 0, depth = rnd() * 6 | 0; d < depth; d++) { t += rnd() * dayLen * spanDays / 3; tree.push({ abbr: GENES[rnd() * GENES.length | 0], t }); }
    const key = rnd() * 4096 | 0;
    lineages[key] = { tree }; keys.push(key);
  }
  // history: a handful of samples across the run; each lineage present until a random cutoff (extinction)
  const hist = [], nSamp = 4 + (rnd() * 8 | 0);
  const cutoff = {}; for (const k of keys) cutoff[k] = rnd() * dayLen * spanDays;
  for (let s = 0; s < nSamp; s++) {
    const t = (s + 1) / nSamp * dayLen * spanDays, buckets = {};
    for (const k of keys) if (t <= cutoff[k]) buckets[k] = 1 + (rnd() * 40 | 0);
    hist.push({ t, buckets });
  }
  return { lineages, hist, dur: dayLen * spanDays };   // samples have no clock of their own; time = index/(n-1)·dur
}

// A hand-built worst case: a founder that never adapted, plus two clades — the classic tangle from #27.
const handCrafted = { hist: [], lineages: {
  10: { tree: [] },                                                       // founder, never adapted
  100: { tree: [{ abbr: "L1" }] },                                        // stops at an internal node
  101: { tree: [{ abbr: "L1" }, { abbr: "P1" }] },
  102: { tree: [{ abbr: "L1" }, { abbr: "P1" }, { abbr: "xL1" }] },       // gene loss deep in clade 1
  200: { tree: [{ abbr: "C4" }] },
  201: { tree: [{ abbr: "C4" }, { abbr: "Tw" }] },
  202: { tree: [{ abbr: "C4" }, { abbr: "Tw" }, { abbr: "C5" }] },
  203: { tree: [{ abbr: "C4" }, { abbr: "Cr" }] },
} };

let totalSegments = 0, checked = 0;
for (const rec of [handCrafted, ...Array.from({ length: 400 }, randomRun), ...Array.from({ length: 400 }, randomTimedRun)]) {
  const g = makeMockCtx();
  renderClado(g, 1000, 640, rec);
  const c = crossings(g.segments);
  totalSegments += g.segments.length;
  checked++;
  assert.equal(c, 0, `cladogram must be planar, found ${c} crossing edge(s) in a run with ${g.segments.length} segments: ${JSON.stringify(rec.lineages).slice(0, 240)}`);
}
assert.ok(totalSegments > 0, "the planarity check must actually have drawn some edges");

// And guard the drawing style so a future edit can't silently reintroduce crossing diagonals: branches
// and tip continuations must be elbows (a horizontal step then a vertical drop), not single diagonals.
assert.match(block, /moveTo\(x0, y0\); g\.lineTo\(x1, y0\); g\.lineTo\(x1, y1\)/,
  "branches must be drawn as elbows (across at the parent depth, then straight down to the child)");
assert.match(block, /moveTo\(xn, yn\); g\.lineTo\(x, yn\); g\.lineTo\(x, endY\)/,
  "tip continuations must be drawn as elbows (across at the node depth, then straight down to its demise day)");

console.log(`Cladogram planarity OK: ${checked} runs, ${totalSegments} edges, zero crossings; elbow routing enforced.`);
