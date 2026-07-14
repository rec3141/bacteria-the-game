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
assert.match(game, /Math\.ceil\(cells\.length\/2000\)/,
  "the whole-world minimap has a bounded cell-dot budget");

console.log("Spatial index contracts OK: torus seams, resizing, hot paths, and rendering are indexed.");
