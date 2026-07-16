import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { readFileSync } from "node:fs";

const game = readFileSync(new URL("../game.js", import.meta.url), "utf8");
const source = game.match(/\/\/ SPATIAL_INDEX_START[\s\S]*?\/\/ SPATIAL_INDEX_END/)?.[0];
assert.ok(source, "production spatial-index block is present");
const { TorusSpatialGrid } = new Function(`${source}\nreturn { TorusSpatialGrid };`)();

const WORLD_W = 2600, WORLD_H = 2000;
const CELL_COUNT = 10000, PREDATOR_COUNT = 300, PHAGE_COUNT = 2500, EPS_COUNT = 240;
let seed = 0x5eed1234;
function random() {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 0x100000000;
}
function entities(count) {
  return Array.from({ length: count }, () => ({ x: random()*WORLD_W, y: random()*WORLD_H }));
}
function wrappedDelta(a, b, size) {
  let delta = a - b;
  if (delta > size/2) delta -= size;
  else if (delta < -size/2) delta += size;
  return delta;
}
function within(a, b, radius) {
  const x = wrappedDelta(a.x, b.x, WORLD_W), y = wrappedDelta(a.y, b.y, WORLD_H);
  return x*x + y*y <= radius*radius;
}

const cells = entities(CELL_COUNT), predators = entities(PREDATOR_COUNT), phages = entities(PHAGE_COUNT), eps = entities(EPS_COUNT);
const cellGrid = new TorusSpatialGrid(WORLD_W, WORLD_H, 64);
const phageGrid = new TorusSpatialGrid(WORLD_W, WORLD_H, 64);
const epsGrid = new TorusSpatialGrid(WORLD_W, WORLD_H, 64);
const scratch = [];

function indexedFrame() {
  cellGrid.rebuild(cells); phageGrid.rebuild(phages); epsGrid.rebuild(eps);
  let candidates = 0, hits = 0;
  for (const predator of predators) {
    const nearbyCells = cellGrid.query(predator.x, predator.y, 170, scratch);
    candidates += nearbyCells.length;
    for (const cell of nearbyCells) if (within(predator, cell, 170)) hits++;
  }
  for (const cell of cells) {
    const nearbyEps = epsGrid.query(cell.x, cell.y, 60, scratch);
    candidates += nearbyEps.length;
    for (const block of nearbyEps) if (within(cell, block, 60)) hits++;
  }
  for (const predator of predators) {
    const nearbyEps = epsGrid.query(predator.x, predator.y, 50, scratch);
    candidates += nearbyEps.length;
    for (const block of nearbyEps) if (within(predator, block, 50)) hits++;
  }
  for (const phage of phages) {
    const nearbyEps = epsGrid.query(phage.x, phage.y, 30, scratch);
    candidates += nearbyEps.length;
    for (const block of nearbyEps) if (within(phage, block, 30)) hits++;
  }
  for (const phage of phages) {
    const nearbyCells = cellGrid.query(phage.x, phage.y, 40, scratch);
    candidates += nearbyCells.length;
    for (const cell of nearbyCells) if (within(phage, cell, 40)) hits++;
  }
  for (const predator of predators) {
    const nearbyPhages = phageGrid.query(predator.x, predator.y, 30, scratch);
    candidates += nearbyPhages.length;
    for (const phage of nearbyPhages) if (within(predator, phage, 30)) hits++;
  }
  // One representative 800×680 viewport query (the renderer still performs exact on-screen culling).
  candidates += cellGrid.query(WORLD_W/2, WORLD_H/2, Math.hypot(400, 340) + 40, scratch).length;
  return { candidates, hits };
}

for (let i = 0; i < 5; i++) indexedFrame();
const samples = [];
let result;
for (let i = 0; i < 25; i++) {
  const start = performance.now(); result = indexedFrame(); samples.push(performance.now() - start);
}
samples.sort((a, b) => a - b);
const medianMs = samples[Math.floor(samples.length/2)];
const fullPairs = PREDATOR_COUNT*CELL_COUNT + PHAGE_COUNT*CELL_COUNT + PREDATOR_COUNT*PHAGE_COUNT +
  EPS_COUNT*(CELL_COUNT + PREDATOR_COUNT + PHAGE_COUNT);
const ratio = result.candidates/fullPairs;
const budgetMs = Number(process.env.SPATIAL_BENCH_BUDGET_MS || 30);

assert.ok(ratio < 0.03, `candidate ratio ${ratio.toFixed(4)} should stay below 3% of full scans`);
assert.ok(medianMs < budgetMs, `median ${medianMs.toFixed(2)}ms exceeded ${budgetMs}ms broad-phase budget`);

console.log([
  `Spatial benchmark: ${CELL_COUNT.toLocaleString()} cells, ${PREDATOR_COUNT} protists, ${PHAGE_COUNT.toLocaleString()} phages, ${EPS_COUNT} EPS blocks`,
  `median indexed broad phase: ${medianMs.toFixed(2)} ms (${samples.length} runs)`,
  `candidate checks: ${result.candidates.toLocaleString()} / ${fullPairs.toLocaleString()} full-scan pairs (${(ratio*100).toFixed(2)}%)`,
  `exact-radius hits: ${result.hits.toLocaleString()}`,
].join("\n"));
