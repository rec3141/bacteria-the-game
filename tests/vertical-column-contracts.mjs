import assert from "node:assert/strict";
// (terrain contracts are appended at the end of this file)
import { readFileSync } from "node:fs";

// Guards #30 phase 1: the world Y-mode. "wrap" is the classic torus (Y wraps like X); "column" is a
// stratified water column with a real surface (y=0) and benthos (y=WORLD_H) — Y clamps, and neighbour
// queries never wrap across that seam. Everything downstream (movement, camera, collision) derives from
// wrapY/dy/the grid's yWrap, so this checks those three plumbing points plus save/restore.
const game = readFileSync(new URL("../game.js", import.meta.url), "utf8");

// ---- behavioural: the spatial grid stops wrapping rows in column mode ----
const source = game.match(/\/\/ SPATIAL_INDEX_START[\s\S]*?\/\/ SPATIAL_INDEX_END/)?.[0];
assert.ok(source, "spatial-index block present");
const { TorusSpatialGrid } = new Function(`${source}\nreturn { TorusSpatialGrid };`)();

const top = { id: "top", x: 400, y: 2 }, bottom = { id: "bottom", x: 400, y: 678 };
const grid = new TorusSpatialGrid(800, 680, 64).rebuild([top, bottom]);
// default (torus): a query at the top seam sees the bottom item across the wrap
assert.deepEqual(new Set(grid.query(400, 0, 5).map((i) => i.id)), new Set(["top", "bottom"]),
  "torus mode still wraps top↔bottom");
// column mode: the surface must NOT see the floor as adjacent
grid.yWrap = false;
assert.deepEqual(grid.query(400, 0, 5).map((i) => i.id), ["top"],
  "column mode: a surface query must not wrap to the floor");
assert.deepEqual(grid.query(400, 680, 5).map((i) => i.id), ["bottom"],
  "column mode: a floor query must not wrap to the surface");
// and it still finds genuine vertical neighbours within range (no seam involved)
grid.rebuild([{ id: "a", x: 400, y: 300 }, { id: "b", x: 400, y: 340 }]);
assert.deepEqual(new Set(grid.query(400, 320, 40).map((i) => i.id)), new Set(["a", "b"]),
  "column mode still returns real in-range vertical neighbours");

// ---- source: the mode flag and the two functions every subsystem derives from ----
assert.match(game, /let worldYWrap = true;/, "world defaults to the classic torus");
assert.match(game, /function setWorldYMode\(wrap\) \{ worldYWrap = wrap !== false; \}/, "a setter flips the Y-mode");
assert.match(game, /function wrapY\(v\) \{ return worldYWrap \? \(\(v % WORLD_H\) \+ WORLD_H\) % WORLD_H : \(v < 0 \? 0 : v > WORLD_H \? WORLD_H : v\); \}/,
  "wrapY wraps in torus mode and clamps to [0, WORLD_H] in column mode");
assert.match(game, /function dy\(a, b\) \{ return worldYWrap \? dWrap\(a, b, WORLD_H\) : \(a - b\); \}/,
  "dy is the wrapped nearest-image in torus mode and the plain difference in column mode");

// ---- source: the grid picks up the mode every rebuild ----
assert.match(game, /this\.yWrap = true;/, "the grid defaults to wrapping Y");
assert.match(game, /grid\.resize\(WORLD_W, WORLD_H\); grid\.yWrap = worldYWrap;/,
  "the per-frame index rebuild propagates the world Y-mode to every grid");
assert.match(game, /cellSpace\.resize\(WORLD_W, WORLD_H\); cellSpace\.yWrap = worldYWrap;/,
  "the cell-only rebuild also propagates the Y-mode");

// ---- source: a fresh run is the torus; checkpoints round-trip the mode ----
assert.match(game, /setWorldYMode\(!columnState\);\s*\/\/ #30: torus by default; a column scenario clamps Y/,
  "newGame is the torus unless a column scenario is active (nothing changes for a normal run)");
assert.match(game, /world: \{ width: WORLD_W, height: WORLD_H, yWrap: worldYWrap \}/, "the checkpoint records the Y-mode");
assert.match(game, /setWorldYMode\(record\.world\.yWrap !== false\);/, "a restored checkpoint reinstates its Y-mode (older saves → torus)");

// ---- phase 2: depth fields + gradient render ----
assert.match(game, /let columnState = null;/, "column mode has a runtime stratification profile (null = uniform sea)");
assert.match(game, /const depthFrac = \(y\) => \(y < 0 \? 0 : y > WORLD_H \? 1 : y \/ WORLD_H\);/,
  "depth is the clamped fraction of the column from surface to floor");
assert.match(game, /function columnLightAt\(y\)[\s\S]*?Math\.exp\(-depthFrac\(y\) \/ Math\.max\(0\.05, columnState\.photicFrac\)\)/,
  "light attenuates exponentially with depth (a real photic zone)");
assert.match(game, /function columnTempAt\(y\)[\s\S]*?columnState\.deepTempC \+ \(columnState\.surfaceTempC - columnState\.deepTempC\)/,
  "temperature stratifies from a warm surface to a cold deep across the thermocline");
assert.match(game, /if \(sc\.column && sc\.column\.enabled\) \{ columnState = deriveColumn\(sc\.column\); setWorldYMode\(false\); \}/,
  "a scenario's column block turns the sea into a stratified, Y-clamped water column");
assert.match(game, /if \(columnState\) \{[\s\S]*?createLinearGradient\(0, 0, 0, VIEW_H\)[\s\S]*?waterColor\(clamp\(columnLightAt\(wy\)/,
  "column mode paints the sea as a vertical light gradient (bright surface → dark deep)");

// The depth math itself: extract the three pure helpers with a tiny harness and check monotonic falloff.
const depthBlock = game.slice(game.indexOf("let columnState = null;"), game.indexOf("function deriveColumn"));
const harness = new Function(`
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  let WORLD_H = 2000;
  const state = { light: 1 }, env = { tempC: 20 };
  ${depthBlock}
  columnState = { photicFrac: 0.3, thermoclineFrac: 0.35, surfaceTempC: 24, deepTempC: 6 };
  return { depthFrac, columnLightAt, columnTempAt };
`);
const { depthFrac, columnLightAt, columnTempAt } = harness();
assert.ok(depthFrac(0) === 0 && depthFrac(2000) === 1 && depthFrac(1000) === 0.5, "depthFrac spans surface→floor");
assert.ok(columnLightAt(0) > columnLightAt(1000) && columnLightAt(1000) > columnLightAt(2000), "light falls off monotonically with depth");
assert.ok(columnLightAt(2000) < 0.1, "the deep is genuinely dark");
assert.ok(columnTempAt(0) > columnTempAt(2000) && Math.abs(columnTempAt(0) - 24) < 1, "surface is warm, deep is cold");

// ---- phase 3: buoyancy ----
assert.match(game, /column: \{ sink: \d[\d.]*, buoyEps: \d[\d.]*, deadSink: \d[\d.]*, particleSink: \d[\d.]*,[\s\S]*?bufferFrac: \d[\d.]*, edgeMinSpeed: \d[\d.]*,[\s\S]*?chemRate: \d/,
  "column mode has tunable vertical-drift + soft-boundary + chemolithotrophy knobs");
// chemolithotrophy: a dissolved chemical-energy field + a cell trait that feeds on it
assert.match(game, /function chemAt\(y\)[\s\S]*?ch\.strength \* Math\.exp/, "the chemical field is a Gaussian plume at its peak depth");
assert.match(game, /if \(c\.chemolithotroph && !c\.cyst\) c\.energy \+= chemAt\(c\.y\)\*CFG\.column\.chemRate\*dt;/,
  "a chemolithotroph gains energy from the field at its depth (no particle needed)");
assert.match(game, /c\.chemolithotroph = !!g\.chemolithotroph;/, "the trait is set from a scenario genome bundle");
// the field math: peaks at peakFrac, falls off with depth distance, zero without a field
const chemBlock = game.slice(game.indexOf("function chemAt"), game.indexOf("\n  }", game.indexOf("function chemAt")) + 4);
const chh = new Function(`
  let WORLD_H = 2000, columnState = { chem: { peakFrac: 0.9, spread: 0.15, strength: 0.8 } };
  const depthFrac = (y) => (y < 0 ? 0 : y > WORLD_H ? 1 : y / WORLD_H);
  ${chemBlock}
  return { chemAt, setNoField: () => { columnState = { chem: null }; } };
`);
const { chemAt } = chh();
assert.ok(Math.abs(chemAt(1800) - 0.8) < 0.05, "the field is strongest at its peak depth");
assert.ok(chemAt(1800) > chemAt(1400) && chemAt(1400) > chemAt(600), "it falls off away from the peak");
assert.match(game, /const damp = columnEdgeDamp\(c\.y\);[\s\S]*?moveVx \* damp[\s\S]*?columnDriftVy\(c\)\) \* damp/,
  "the soft-boundary damp is applied to cell movement");
assert.match(game, /const pdamp = columnEdgeDamp\(pr\.y\);/, "grazers feel the soft boundary too");
// the damp function: 1 in open water, easing to edgeMinSpeed at the very edge
const edgeBlock = game.slice(game.indexOf("function columnEdgeDamp"), game.indexOf("\n  }", game.indexOf("function columnEdgeDamp")) + 4);
const edh = new Function(`
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  let WORLD_H = 2000, VIEW_H = 800, columnState = { photicFrac: 0.3 };
  const CFG = { column: { bufferFrac: 0.25, edgeMinSpeed: 0.12 } };
  ${edgeBlock}
  return columnEdgeDamp;
`);
const edge = edh();
assert.ok(Math.abs(edge(1000) - 1) < 1e-9, "open water is undamped");
assert.ok(edge(0) <= 0.13 && edge(0) >= 0.11, "movement eases to edgeMinSpeed at the surface");
assert.ok(edge(2000) <= 0.13, "and at the floor");
assert.ok(edge(60) < edge(150) && edge(150) < edge(1000), "the closer to the edge, the slower");
assert.match(game, /cvy = \(moveVy \+ columnDriftVy\(c\)\) \* damp/, "the column's vertical drift is added to cell movement");
assert.match(game, /s\.vy \+ \(columnState \? CFG\.column\.particleSink : 0\)/, "detritus sinks down the column");
const dvStart = game.indexOf("function columnDriftVy");
const driftBlock = game.slice(dvStart, game.indexOf("\n  }", dvStart) + 4); // just the function body (no nested braces)
const dh = new Function(`
  let WORLD_H = 2000, columnState = { photicFrac: 0.3 };
  const CFG = { column: { sink: 9, buoyEps: 7, deadSink: 22, particleSink: 6 } };
  ${driftBlock}
  return columnDriftVy;
`);
const drift = dh();
assert.ok(drift({ y: 1000, eps: 0 }) > 0, "a plain cell sinks gently");
assert.ok(drift({ y: 1000, cyst: true }) > drift({ y: 1000, eps: 0 }), "a dormant cyst sinks faster than an active cell");
assert.ok(drift({ y: 1000, eps: 3 }) < drift({ y: 1000, eps: 0 }), "EPS/biofilm adds buoyancy (less sink)");
assert.ok(drift({ y: 1, eps: 5 }) === 0 || drift({ y: 1, eps: 5 }) >= 0, "a buoyant cell at the surface is not pushed up out of the sea");
// and in the toroidal sea there is no drift at all
const dhTorus = new Function(`let WORLD_H = 2000, columnState = null; const CFG = { column: { sink: 9, buoyEps: 7, deadSink: 22, particleSink: 6 } }; ${driftBlock} return columnDriftVy;`)();
assert.equal(dhTorus({ y: 1000, eps: 0 }), 0, "no vertical drift in the classic torus");

// ---- terrain: solid, fixed scenery bounding the column --------------------------------------------
// Sea ice overhead, sediment underfoot, each with a roughness (surface relief) and a porosity (voids
// threaded through the mass — brine channels, burrows). It is scenery, not food.
{
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
  const src = ["terrainHash", "terrainNoise1", "terrainFbm1", "terrainNoise2", "terrainSpireLift", "makeTerrainChunk"].map(grab).join("\n");
  const { makeTerrainChunk } = new Function(
    `const WORLD_H = 2000, WORLD_W = 2600; const CFG = { grid: { cs: 7 } };
     const clamp = (v,a,b) => v<a?a:v>b?b:v;\n${src}\nreturn { makeTerrainChunk };`)();

  const layer = (o) => ({ at: "bottom", thickness: 200, cy: 1850, roughness: 0, porosity: 0,
                          poreSize: 26, featureSize: 260, label: "sediment", ...o });
  const solidity = (c) => (c ? c.grid.reduce((a, v) => a + (v > 0 ? 1 : 0), 0) / c.grid.length : 0);

  // roughness 0 is dead flat — every chunk identical; turning it up makes the face undulate ACROSS
  // the world, so chunks stop matching each other
  const flat = [0, 1, 2, 3].map((i) => solidity(makeTerrainChunk(layer({ roughness: 0 }), (i + 0.5) * 300, 300, [], 1)));
  assert.ok(Math.max(...flat) - Math.min(...flat) < 1e-9, "roughness 0 must give a flat, uniform layer");
  const rough = [0, 1, 2, 3].map((i) => solidity(makeTerrainChunk(layer({ roughness: 0.9 }), (i + 0.5) * 300, 300, [], 1)));
  assert.ok(Math.max(...rough) - Math.min(...rough) > 0.05, "roughness must actually vary the surface across the world");

  // porosity hollows the slab out, monotonically — this is the habitat, not decoration
  let prev = Infinity;
  for (const p of [0, 0.2, 0.4, 0.6, 0.8]) {
    const s = solidity(makeTerrainChunk(layer({ porosity: p }), 450, 300, [], 1));
    assert.ok(s <= prev + 1e-9, `porosity ${p} must not make the layer MORE solid`);
    prev = s;
  }
  assert.ok(prev < solidity(makeTerrainChunk(layer({ porosity: 0 }), 450, 300, [], 1)) * 0.75,
    "high porosity must open real voids, not just roughen the surface");

  // The shaping function is PURE — a given seed always yields the same chunk. The lab depends on that
  // to preview faithfully, and it is what lets the per-run randomization below stay honest.
  const a = makeTerrainChunk(layer({ roughness: 0.6, porosity: 0.4 }), 450, 300, [], 1);
  const b = makeTerrainChunk(layer({ roughness: 0.6, porosity: 0.4 }), 450, 300, [], 1);
  assert.ok(a.grid.every((v, i) => v === b.grid[i]), "same seed must yield the same chunk");
  assert.ok(!/Math\.random\(\)/.test(grab("makeTerrainChunk")), "the shaping function itself must stay pure");
  // a different seed genuinely rearranges the layout
  const c = makeTerrainChunk(layer({ roughness: 0.6, porosity: 0.4 }), 450, 300, [], 987654);
  assert.ok(a.grid.some((v, i) => v !== c.grid[i]), "a different seed must move the pores and spires");

  // Per-run randomization: each real run draws a fresh terrain seed, folded into every layer, so the
  // seabed is a surprise. The scenario's env is untouched, so difficulty is not — only the layout moves.
  const build = grab("buildTerrain");
  assert.match(build, /seed: \(terrainRunSeed \+ \(li \+ 1\) \* 9973\)/, "each layer must fold in the per-run seed");
  assert.match(game, /terrainRunSeed = isDemo \? 0 : /, "a real run draws a fresh seed; the demo background stays stable");

  // it is scenery: no resource content, and it collides even for a twitching cell that may crawl
  // through food particles
  assert.ok(a.terrainLayer === true, "a terrain body must be flagged as terrain");
  const collide = grab("collideCircle");   // collideRod is defined ABOVE it, so slicing between them is empty
  assert.match(collide, /for \(const p of terrain\)[\s\S]*?if \(!skipParticles\) for \(const p of substrates\)/,
    "terrain must collide unconditionally — skipParticles lets a cell crawl through FOOD, not through the sea floor");
  // and it must not be mistaken for food anywhere
  assert.ok(!/substrates\.push\(.*terrain/i.test(game), "terrain must never enter the substrate list");

  // Solid means the movement step must actually RESOLVE collisions near terrain. `near` gates that
  // entirely, and it was computed from food and EPS only — so a cell approaching the sea floor with
  // nothing else around took the cheap straight-line path and swam clean through the ice.
  const move = game.slice(game.indexOf("let near = false"), game.indexOf("const damp = columnEdgeDamp(c.y)"));
  assert.match(move, /if \(!near\) for \(const p of terrain\)/,
    "proximity to terrain must set `near`, or the step never resolves a collision against it");
  // the food check is deliberately skipped while twitching (a cell crawls through the particle it
  // grips); the terrain check must NOT inherit that exemption
  const terrainTest = move.slice(move.indexOf("for (const p of terrain)"));
  assert.ok(!/c\.twitching/.test(move.slice(move.indexOf("of terrain") - 120, move.indexOf("of terrain"))),
    "the terrain proximity check must not be gated on twitching");

  // Depth shading treats out-of-grid as open water, which is right for a particle and wrong for a
  // chunk of a much larger slab: it lit a rim around every chunk and turned a sheet of ice into a
  // visible grid of boxes.
  const depth = grab("surfaceDepth");
  assert.match(depth, /const outside = p\.terrainLayer \? INF : 0/,
    "a terrain chunk's border continues into its neighbour and must shade as buried, not exposed");
  assert.ok(!/\? d\[k-n\] : 0/.test(depth), "the hard-coded 0 for out-of-bounds must be gone");

  // solidFill still exists (it suppresses pores in fully-buried mass) and is exercised directly above;
  // it is simply no longer fed by an out-of-world row.
  assert.match(grab("makeTerrainChunk"), /layer\.porosity > 0 && !solidFill/,
    "solidFill must suppress the pore network");

  // Spires: narrow towers standing off the layer. roughness is smooth noise and can only ever make
  // rolling hills, so a vent field of chimneys needs its own term.
  {
    const spireSrc = ["terrainHash", "terrainNoise1", "terrainFbm1", "terrainSpireLift"].map(grab).join("\n");
    const { terrainSpireLift } = new Function(
      `const clamp=(v,a,b)=>v<a?a:v>b?b:v;\n${spireSrc}\nreturn { terrainSpireLift };`)();
    const L = { spires: 0.55, spireHeight: 320, spireWidth: 55, seed: 9973 };
    const profile = [];
    for (let x = 0; x < 2600; x += 4) profile.push(terrainSpireLift(L, x));

    assert.ok(Math.max(...profile) > 150, "spires must actually stand well off the layer");
    const bare = profile.filter((h) => h < 5).length / profile.length;
    assert.ok(bare > 0.4 && bare < 0.95,
      `spires must be sparse towers with floor between them, not a raised slab (bare floor ${Math.round(bare*100)}%)`);
    // off means off
    assert.equal(terrainSpireLift({ ...L, spires: 0 }, 500), 0, "spires:0 must produce nothing");
    assert.equal(terrainSpireLift({ ...L, spireHeight: 0 }, 500), 0, "spireHeight:0 must produce nothing");
    // deterministic, and identical no matter which chunk asks — a spire straddling a chunk boundary
    // must not step
    assert.equal(terrainSpireLift(L, 1234.5), terrainSpireLift(L, 1234.5), "spires must be deterministic");
    // rows have to reach the tops, or a chimney is sliced off where the slab ends
    assert.match(grab("buildTerrain"), /const reach = thickness \+ layer\.spireHeight/,
      "chunk rows must cover the spires, not just the slab");
  }

  // The camera stops at the surface and the floor rather than centring on the cell all the way to the
  // edge. That removes the void beyond the world, and makes hitting the sea floor read as ARRIVING
  // somewhere — the view stops scrolling and the cell drifts off-centre — instead of the controls
  // seeming to stop working. It also means terrain needs no rows past the world edge: nothing out
  // there is reachable or visible, so a seam row would be megabytes of canvas guarding nothing.
  assert.match(build, /for \(let r = 0; r < rows; r\+\+\)/, "terrain must not build rows outside the world");
  assert.ok(!/const beyond/.test(build), "the seam row is dead weight once the camera is clamped — remove it");
  const clampFn = grab("camClampY");
  assert.match(clampFn, /if \(worldYWrap\) return wrapY\(y\)/, "a torus has no edges and must keep centring");
  assert.match(clampFn, /VIEW_H \/ \(2 \* \(ZOOM \|\| 1\)\)/, "ZOOM decides how much world a viewport covers");
  assert.match(clampFn, /WORLD_H <= halfView \* 2/, "a world shorter than the view must be shown whole, not clamped");
  assert.match(clampFn, /clamp\(y, halfView, WORLD_H - halfView\)/, "otherwise stop the camera at both boundaries");
  // every camera assignment must go through it, or the void flashes back on a snap
  const strays = game.split("\n").filter((l) => /\bcam\.y = /.test(l) && !/camClampY|WORLD_H\/2/.test(l));
  assert.equal(strays.length, 0, `these set cam.y without clamping:\n  ${strays.map((s) => s.trim()).join("\n  ")}`);

  // and the off-world rows are gone entirely: with the camera clamped nothing out there is visible,
  // so terrain builds no seam row at all (that check lives with the terrain-build assertions above)
}

console.log("Vertical-column contract OK: Y-mode plumbing, no seam wrap, save/restore, phase-2 depth fields, phase-3 buoyancy, and solid porous terrain.");

// ---- chemolithotrophy is a metabolism, and metabolisms are heritable ------------------------------
// The trait was set on the founder from its archetype but copied nowhere, so the mechanic looked
// broken rather than wrong: the founder thrived in its plume for one division (~4s), then both
// daughters reverted to heterotrophy carrying the enzLvl [0,0,1] a chemolithotroph is authored with —
// almost no digestive ability — and the lineage starved. Three vent/Winogradsky scenarios ship it.
{
  const divide = game.slice(game.indexOf("function divide(c)"), game.indexOf("function killCell"));
  assert.match(divide, /d1\.chemolithotroph = d2\.chemolithotroph = !!c\.chemolithotroph/,
    "daughters must inherit chemosynthesis, or the lineage loses its metabolism on the first division");
  // every other heritable trait is copied right beside it; if one is added, it belongs here too
  for (const trait of ["twitching", "eps", "crispr", "antibiotic", "chemoLevel"]) {
    assert.ok(divide.includes(`d1.${trait}`), `${trait} must still be inherited`);
  }

  // the seed bank is what cysts revive from, so it carries the metabolism as well
  const bank = game.slice(game.indexOf("state.dead.push({"), game.indexOf("if (state.dead.length > 400)"));
  assert.match(bank, /chemolithotroph: !!c\.chemolithotroph/,
    "a revived cyst must come back able to feed the way it did");
  // and the bundle that reads those genomes back must apply it
  assert.match(game, /c\.chemolithotroph = !!g\.chemolithotroph/, "applyGenomeBundle must restore the trait");

  // Balance: the plume must be worth standing in but not better than the best feeding in the game,
  // or a chemolithotroph divides faster than anything can eat it and pins the cell cap.
  const chemRate = Number(game.match(/chemRate: ([\d.]+)/)[1]);
  const uptake = Number(game.match(/uptake: ([\d.]+)/)[1]);
  assert.ok(chemRate > 0, "chemosynthesis must actually pay");
  assert.ok(chemRate < uptake, `standing in a plume (${chemRate}/s) must not beat active feeding (${uptake}/s)`);
}
