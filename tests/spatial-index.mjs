import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const game = readFileSync(new URL("../game.js", import.meta.url), "utf8");
const source = game.match(/\/\/ SPATIAL_INDEX_START[\s\S]*?\/\/ SPATIAL_INDEX_END/)?.[0];
assert.ok(source, "production spatial-index block is present");
const { TorusSpatialGrid } = new Function(`${source}\nreturn { TorusSpatialGrid };`)();

const edgeWest = { id: "west", x: 5, y: 100 };
const edgeEast = { id: "east", x: 2595, y: 100 };
const middle = { id: "middle", x: 1300, y: 1000 };
const dead = { id: "dead", x: 0, y: 100, dead: true };
const grid = new TorusSpatialGrid(2600, 2000, 64).rebuild(
  [edgeWest, edgeEast, middle, dead],
  (item) => !item.dead,
);

assert.deepEqual(new Set(grid.query(0, 100, 12).map((item) => item.id)), new Set(["west", "east"]),
  "queries cross the horizontal torus seam");
assert.deepEqual(grid.query(1300, 1000, 10), [middle], "local query excludes distant buckets");
assert.equal(grid.query(0, 0, 5000).length, 3, "large wrapped queries never duplicate a bucket");

grid.resize(800, 680);
grid.rebuild([{ id: "top", x: 400, y: 2 }, { id: "bottom", x: 400, y: 678 }]);
assert.deepEqual(new Set(grid.query(400, 0, 5).map((item) => item.id)), new Set(["top", "bottom"]),
  "resizing for the tutorial dish preserves vertical wrapping");

assert.match(game, /rebuildSpatialIndexes\(\); \/\/ pre-move positions/,
  "indexes are available before interaction updates");
assert.match(game, /rebuildCellSpace\(\); \/\/ predators, toxins and phages/,
  "cell positions are refreshed before cross-species queries");
assert.match(game, /rebuildSpatialIndexes\(\); \/\/ final positions feed rendering/,
  "rendering uses final-frame positions");
assert.match(game, /visibleSpatial\(cellSpace, cellCandidates/,
  "cell rendering queries the visible spatial neighborhood");
assert.match(game, /const MINIMAP_CELL_DOT_LIMIT = 500, MINIMAP_SAMPLE_INTERVAL = 0\.5/,
  "the whole-world minimap has a conservative, throttled cell-dot budget");
assert.match(game, /function sampledMinimapCells\(\)[\s\S]*?minimapCellSample\.filter\(\(c\) => current\.has\(c\)[\s\S]*?minimapCellSample\.push\(\.\.\.additions\)/,
  "the minimap must preserve surviving sampled cells and replenish only vacancies");
const minimapDraw = game.slice(game.indexOf("function drawMinimap()"), game.indexOf("function drawMiniDiamond"));
assert.match(minimapDraw, /const used = \[\][\s\S]*?minimapPointBuckets\[key\][\s\S]*?ctx\.rect\([\s\S]*?ctx\.fill\(\)/,
  "minimap colony dots must be batched by lineage color rather than painted one call at a time");
assert.doesNotMatch(minimapDraw, /fillRect\(MX\(c\.x\)/,
  "the minimap must not issue one fillRect call per sampled cell");

// ---- column mode: the floor is an edge, not a seam ------------------------------------------------
// In a water column Y is CLAMPED, so an organism can rest at exactly y === WORLD_H. rebuild() applied
// the torus modulo regardless, and WORLD_H % WORLD_H === 0 filed it in row 0 — the SURFACE — while
// query() clamped rows and scanned the floor. Nothing found it. In play that meant holding yourself
// against the bottom made your own cell vanish: undrawn, unhuntable, uninfectable, until you let go.
{
  const W = 2600, H = 2000;
  const floorGrid = new TorusSpatialGrid(W, H, 64);
  floorGrid.yWrap = false;
  const onFloor = { x: 1300, y: H };          // resting exactly on the bottom
  const nearFloor = { x: 1300, y: H - 3 };    // a whisker above it
  const atSurface = { x: 1300, y: 0 };
  floorGrid.rebuild([onFloor, nearFloor, atSurface]);

  const atBottom = floorGrid.query(1300, H, 40, []);
  assert.ok(atBottom.includes(onFloor), "an organism resting on the floor must be found at the floor");
  assert.ok(atBottom.includes(nearFloor), "its neighbour a few px up must be found with it");
  assert.ok(!atBottom.includes(atSurface), "the surface must not answer a query about the floor");

  const atTop = floorGrid.query(1300, 0, 40, []);
  assert.ok(!atTop.includes(onFloor), "the floor must not be mis-filed at the surface");
  assert.ok(atTop.includes(atSurface), "the surface organism belongs at the surface");

  // and the torus must keep wrapping: the same two coordinates ARE neighbours when Y is a seam
  const torusGrid = new TorusSpatialGrid(W, H, 64);
  torusGrid.yWrap = true;
  const top = { x: 1300, y: 1 }, bottom = { x: 1300, y: H - 1 };
  torusGrid.rebuild([top, bottom]);
  assert.ok(torusGrid.query(1300, 0, 40, []).includes(bottom),
    "on a torus the bottom edge is still a neighbour of the top");
}

console.log("Spatial index contracts OK: torus seams, resizing, hot paths, and rendering are indexed.");
