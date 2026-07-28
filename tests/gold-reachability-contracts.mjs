// Gold phages must land somewhere a player can actually get to.
//
// Gold is the ONLY source of adaptations in the game, and an unreachable one is worse than none at
// all: it still draws a star on the minimap, so it reads as an objective and spends the player's
// attention before it spends their run. Two ways it used to become unreachable, both confined to
// COLUMN scenarios and both invisible from the source:
//
//   * Pinned to y=0 / y=WORLD_H. Y does not wrap in a column -- wrapY CLAMPS -- so the old
//     single-angle "walk 700-1200px" put a large share of gold exactly on the ceiling and floor.
//   * Buried in terrain. A phage inside a PARTICLE is the intended puzzle; you dig it out. Terrain
//     cannot be digested at all.
//
// These run the real goldSpawnPoint against a stub world and MEASURE where it puts things, rather
// than asserting the source mentions a guard. The old code passes every source-shaped test you could
// write about it and still fails the first assertion here.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const game = readFileSync(new URL("../game.js", import.meta.url), "utf8");

const grab = (name) => {
  const i = game.indexOf(`function ${name}(`);
  assert.ok(i >= 0, `${name} must exist`);
  let d = 0, j = game.indexOf("{", i), started = false;
  for (; j < game.length; j++) {
    if (game[j] === "{") { d++; started = true; }
    else if (game[j] === "}") { d--; if (started && d === 0) { j++; break; } }
  }
  return game.slice(i, j);
};

const WORLD_W = 2600, WORLD_H = 2000;

// A stub world: no substrates (so every call takes the open-water path, which is the one that was
// broken), a seabed occupying the bottom 250px and an ice ceiling occupying the top 150px.
function harness({ worldYWrap, terrainBands }) {
  const src = [grab("goldSpawnPoint"), grab("founderSpawn")].join("\n");
  return new Function(`
    const WORLD_W = ${WORLD_W}, WORLD_H = ${WORLD_H};
    const worldYWrap = ${worldYWrap};
    const CFG = { cell: { radius: 4, maxHalf: 9 }, grid: { cs: 7 } };
    const columnState = ${worldYWrap ? "null" : "{}"};
    const terrain = ${JSON.stringify(terrainBands)};
    const substrates = [];
    const clamp = (v,a,b) => v<a?a:v>b?b:v;
    const rand = (a,b) => a + Math.random()*(b-a);
    const wrapX = (v) => ((v % WORLD_W) + WORLD_W) % WORLD_W;
    const wrapY = (v) => worldYWrap ? ((v % WORLD_H) + WORLD_H) % WORLD_H
                                    : (v < 0 ? 0 : v > WORLD_H ? WORLD_H : v);
    const dWrap = (a,b,size) => { let d = a-b; if (d > size/2) d -= size; else if (d < -size/2) d += size; return d; };
    const dx = (a,b) => dWrap(a,b,WORLD_W);
    const dy = (a,b) => worldYWrap ? dWrap(a,b,WORLD_H) : (a-b);
    const toroDist2 = (ax,ay,bx,by) => { const x = dx(ax,bx), y = dy(ay,by); return x*x + y*y; };
    const ownedEnzymes = () => [2];
    // terrain as horizontal bands: solid iff the point (plus its radius) intrudes into one
    const clearOfTerrain = (wx, wy, r) =>
      !terrain.some((b) => wy + r > b.y0 && wy - r < b.y1);
    ${src}
    return goldSpawnPoint;`)();
}

const SEABED = { y0: 1750, y1: WORLD_H }, ICE = { y0: 0, y1: 150 };
const N = 4000;

// ---- a column world: nothing on the edges, nothing in the rock ------------------------------------
{
  const spawn = harness({ worldYWrap: false, terrainBands: [ICE, SEABED] });
  const cell = { x: WORLD_W / 2, y: 900 };
  let onEdge = 0, inTerrain = 0;
  const ys = [];
  for (let i = 0; i < N; i++) {
    const s = spawn(cell, 300);
    ys.push(s.y);
    if (s.y <= 1e-9 || s.y >= WORLD_H - 1e-9) onEdge++;
    if (s.y < ICE.y1 || s.y > SEABED.y0) inTerrain++;
  }
  assert.equal(onEdge, 0, `gold must never be pinned to the ceiling or floor (got ${onEdge}/${N})`);
  assert.equal(inTerrain, 0, `gold must never be inside terrain (got ${inTerrain}/${N})`);

  // and it must still be SPREAD through the water, not all bunched at one safe depth -- a guard that
  // collapses every phage onto a single reachable spot passes the two assertions above and is useless
  const lo = Math.min(...ys), hi = Math.max(...ys);
  assert.ok(hi - lo > 400, `gold must be spread through the water column, saw a ${(hi-lo).toFixed(0)}px band`);
}

// ---- the same world, with the old single-angle formula, to prove the test can fail ----------------
// This is the arithmetic the fix replaced. If this does NOT pile up on the edges then the harness is
// not reproducing the bug and the assertions above are not testing anything.
{
  let onEdge = 0;
  const cell = { x: WORLD_W / 2, y: 900 };
  const wrapY = (v) => (v < 0 ? 0 : v > WORLD_H ? WORLD_H : v);
  for (let i = 0; i < N; i++) {
    const a = Math.random() * 6.28, d = 700 + Math.random() * 500;
    const y = wrapY(cell.y + Math.sin(a) * d);
    if (y <= 1e-9 || y >= WORLD_H - 1e-9) onEdge++;
  }
  assert.ok(onEdge / N > 0.05,
    `the old formula must demonstrably pin gold to the edges, else this harness proves nothing (got ${(100*onEdge/N).toFixed(1)}%)`);
  console.log(`  (old formula pinned ${(100*onEdge/N).toFixed(1)}% of gold phages to an edge)`);
}

// ---- a wrapping world must be untouched -----------------------------------------------------------
// No column: Y wraps, there is no terrain, and every candidate should be accepted on the first try.
{
  const spawn = harness({ worldYWrap: true, terrainBands: [] });
  const cell = { x: 100, y: 100 };
  const ys = [];
  for (let i = 0; i < N; i++) ys.push(spawn(cell, 300).y);
  assert.ok(Math.min(...ys) < 200 && Math.max(...ys) > WORLD_H - 200,
    "in a wrapping world gold must still be able to land anywhere, including across the seam");
}

// ---- terrain that fills almost the whole column must still yield a point ---------------------------
// The founder search is the backstop. It must not return an edge or a buried point either.
{
  const tight = [{ y0: 0, y1: 900 }, { y0: 1100, y1: WORLD_H }];
  const spawn = harness({ worldYWrap: false, terrainBands: tight });
  for (let i = 0; i < 200; i++) {
    const s = spawn({ x: 500, y: 1000 }, 300);
    assert.ok(Number.isFinite(s.x) && Number.isFinite(s.y), "a spawn point must always be produced");
    assert.ok(s.y > 900 && s.y < 1100, `the backstop must find the open water, got y=${s.y.toFixed(0)}`);
  }
}

console.log("Gold reachability contracts OK: never on an edge, never in terrain, still spread, wrap untouched.");
