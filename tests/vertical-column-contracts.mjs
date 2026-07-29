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
// Autotrophy: light alone (oxygenic photosynthesis), a chemical alone (chemolithotrophy), or BOTH —
// which is anoxygenic photosynthesis and needs light for energy AND the chemical as electron donor.
// Liebig's law of the minimum makes "both" an intersection rather than a sum, so a purple sulfur
// bacterium has to find where the falling light and rising sulfide gradients overlap.
assert.match(game, /if \(!c\.cyst && \(c\.phototroph \|\| c\.chemolithotroph\)\)/,
  "either autotrophy feeds a cell, and neither feeds a dormant cyst");
assert.match(game, /const light = c\.phototroph \? clamp\(columnLightAt\(c\.y\), 0, 1\) : 1;/,
  "light limits a phototroph; an absent requirement is 1 so it never limits");
assert.match(game, /const chem = c\.chemolithotroph \? chemAt\(c\.y\) : 1;/, "and the chemical limits a chemolithotroph");
assert.match(game, /Math\.min\(light, chem\) \* rate \* \(cellHalfLen\(c\)\/CFG\.cell\.baseHalf\) \* dt/,
  "the SCARCER input sets the rate — a sum would let either gradient alone feed a photolithotroph");
// ...and the intake scales with the cell, as every other income does. Respiration scales with size AND
// genome tier, so a flat intake meant an autotroph stalled around tier 12 and starved above it —
// adaptations made your cell strictly worse, in the one mode where you cannot go and eat instead.
assert.match(game, /const gain = c\.cyst \? 0\s*\n\s*: supply \* \(c\.phototroph \? CFG\.column\.photoRate : CFG\.column\.chemRate\) \* \(cellHalfLen\(c\)\/CFG\.cell\.baseHalf\);/,
  "the HUD readout must scale the same way, or it disagrees with the sim for any grown cell");
// it is logged like any other intake, or a plume-fed bloom appears to run on nothing
assert.match(game, /state\.calLive\[CAL_AUTO\] \+= fixed; state\.calFull\[CAL_AUTO\] \+= fixed;/,
  "fixed carbon must appear in the calories-consumed chart");
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
  const src = ["terrainHash", "terrainScale", "terrainNoise1", "terrainFbm1", "terrainNoise2", "terrainSpireLift", "makeTerrainChunk"].map(grab).join("\n");
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
      `const WORLD_W = 2600; const clamp=(v,a,b)=>v<a?a:v>b?b:v;\n${spireSrc}\nreturn { terrainSpireLift };`)();
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

// ---- both autotrophies are heritable, and chemotaxis follows the gradient that feeds you ----------
{
  const divide = game.slice(game.indexOf("function divide(c)"), game.indexOf("function killCell"));
  assert.match(divide, /d1\.phototroph = d2\.phototroph = !!c\.phototroph/, "phototrophy is heritable too");
  const bank = game.slice(game.indexOf("state.dead.push({"), game.indexOf("if (state.dead.length > 400)"));
  assert.match(bank, /phototroph: !!c\.phototroph/, "and survives in the seed bank a cyst revives from");
  assert.match(game, /c\.phototroph = !!g\.phototroph;/, "a scenario genome can author it");
  assert.match(game, /"chemolithotroph", "phototroph"\]\), "genome"\)/, "the validator accepts it as a genome key");

  // Chemotaxis sensed the nearest FOOD PARTICLE, which for an autotroph is worse than no sense at
  // all: it steered a chemolithotroph out of its plume toward debris it has no enzymes to digest.
  const walk = game.slice(game.indexOf("let upGrad = false;"), game.indexOf("if (c.tumbling) {"));
  assert.match(walk, /if \(c\.phototroph \|\| c\.chemolithotroph\)/, "an autotroph must track its own gradient");
  assert.match(walk, /Math\.min\(light, chem\)/, "and track the SAME limiting factor that feeds it");
  assert.match(walk, /nearestOrganicSub/, "a heterotroph still tracks food particles");
  assert.ok(walk.indexOf("c.phototroph || c.chemolithotroph") < walk.indexOf("nearestOrganicSub"),
    "the autotroph branch must come first, or a chemolithotroph falls through to the food sense");

  // Balance: photosynthesis must not beat the best feeding in the game either.
  const photoRate = Number(game.match(/photoRate: ([\d.]+)/)[1]);
  const uptake = Number(game.match(/uptake: ([\d.]+)/)[1]);
  assert.ok(photoRate > 0 && photoRate < uptake,
    `full sunlight (${photoRate}/s) must pay, but not beat active feeding (${uptake}/s)`);
}

// ---- telling the player where the energy is -------------------------------------------------------
// Two readouts answering two different questions. The depth gauge beside the minimap says WHICH WAY to
// swim; the HUD chip says whether it is working HERE, which is what you want while already moving.
{
  const gauge = game.slice(game.indexOf("function drawDepthGauge"), game.indexOf("function drawMiniDiamond"));
  // Shown for any water column. It USED to require the cell you steer to be an autotroph, on the
  // reasoning that to a heterotroph the gradients are scenery — and that was right until diatoms
  // existed. The light profile now decides where the bloom lives, when it collapses, and therefore
  // where the food and the toxin are; in a level built around a bloom the player is usually a
  // heterotroph, so the sea's structure was hidden from exactly the person who needed to read it.
  assert.match(gauge, /if \(!columnState\) return;/,
    "the gauge appears for any water column, not only for an autotroph");
  assert.doesNotMatch(gauge, /!pc \|\| !\(pc\.phototroph \|\| pc\.chemolithotroph\)/,
    "the old metabolism gate must not come back");
  assert.match(gauge, /chans\.push\(\{ c: "#ffe9a8", f: \(y\) => clamp\(columnLightAt\(y\), 0, 1\) \}\);/,
    "light is always a channel in a column");
  assert.match(gauge, /if \(columnState\.chem\) chans\.push/,
    "the chemical channel needs a plume to describe, not a chemolithotroph to read it");
  // ...but the combined bar answers "what feeds ME", so that one stays tied to the cell
  assert.match(gauge, /pc && pc\.phototroph && pc\.chemolithotroph/,
    "the scarcer-input bar is about what feeds YOU and must stay tied to the cell");
  // it hangs off the minimap so it inherits that widget's world-Y mapping and cannot drift from it
  assert.match(game, /drawDepthGauge\(mx, my, mw, mh, vs, ps\);/, "the gauge is drawn from the minimap, sharing its geometry");
  assert.match(gauge, /my \+ clamp\(you\.y \/ WORLD_H, 0, 1\) \* mh/, "your depth marker uses the same axis as the map");

  // RUN it with no controlled cell. Relaxing the gate above left `pc.y` being dereferenced below it,
  // and as a protist -- or in the attract sim -- controlledCell() is null, so the gauge threw from
  // inside the render loop on EVERY FRAME. Every assertion in this block still passed, because they
  // all match source text and the crashing line was one I had not changed. Only calling it catches it.
  {
    const grab = (name) => {
      const i = game.indexOf(`function ${name}(`);
      let d = 0, j = game.indexOf("{", i), started = false;
      for (; j < game.length; j++) {
        if (game[j] === "{") { d++; started = true; }
        else if (game[j] === "}") { d--; if (started && d === 0) { j++; break; } }
      }
      return game.slice(i, j);
    };
    const noop = () => {};
    const run = (cell, entity, chem) => new Function(`
      const WORLD_H = 2000;
      const clamp = (v,a,b) => v<a?a:v>b?b:v;
      const isTouch = false;
      const columnState = { photicFrac: 0.3, chem: ${chem ? '{ color: "#d9c24a" }' : "null"} };
      const columnLightAt = (y) => Math.exp(-(y/WORLD_H)/0.3);
      const chemAt = () => 0.5;
      const controlledCell = () => (${cell});
      const controlledEntity = () => (${entity});
      const ctx = new Proxy({}, { get: (t, k) => (k === "canvas" ? {} : () => {}) });
      ${grab("drawDepthGauge")}
      return drawDepthGauge;`)();

    // a heterotroph bacterium: the case the relaxed gate is FOR
    run("{ y: 900 }", "{ y: 900 }", false)(0, 0, 150, 115, 1, 1);
    // playing as a protist: controlledCell() is null but you still exist
    run("null", "{ y: 900 }", true)(0, 0, 150, 115, 1, 1);
    // the attract sim: nothing is controlled at all
    run("null", "null", false)(0, 0, 150, 115, 1, 1);
    run("null", "null", true)(0, 0, 150, 115, 1, 1);
    // an autotroph with both gradients — the combined bar path
    run('{ y: 900, phototroph: true, chemolithotroph: true }', "{ y: 900 }", true)(0, 0, 150, 115, 1, 1);
    void noop;
  }
  assert.match(gauge, /Math\.min\(chans\[0\]\.f\(y\), chans\[1\]\.f\(y\)\)/,
    "with both gradients the gauge shows the limiting factor — the bar you actually swim toward");
  assert.match(gauge, /isTouch \? mx \+ mw \+ gap \* 2 : mx - totalW - gap \* 2/,
    "it sits outside the map on whichever side has room (map is right on desktop, left on a phone)");

  // The HUD chip must report the SAME numbers the simulation applies, or it teaches the wrong lesson.
  const readout = game.slice(game.indexOf("function updateAutotrophyReadout"), game.indexOf("function clockStr"));
  assert.match(readout, /Math\.min\(light, chem\)/, "it reports the limiting factor, as the intake does");
  assert.match(readout, /c\.cyst \? 0\s*:/, "a dormant cyst fixes nothing, and the chip must not claim otherwise");
  assert.match(readout, /respirationRate\(c\)/, "the burn comes from the shared helper, not a second copy of the formula");
  // and the simulation goes through that same helper
  assert.match(game, /c\.energy -= respirationRate\(c, sizeF, metab, genomeF\)\*dt;/,
    "the sim subtracts the rate the helper returns, so the displayed number cannot drift from the real one");
}

// ---- the seabed must close around the torus ---------------------------------------------------------
// The world wraps in X. Terrain noise is sampled in WORLD coordinates, which makes neighbouring CHUNKS
// meet exactly — but the lattice index just keeps counting, so x=WORLD_W and x=0 were unrelated noise
// butted together: a vertical seam through the seabed, surface height stepping ~19px and pores cut off
// mid-feature. Every field must now be periodic in WORLD_W.
assert.match(game, /function terrainHash\(a, b, seed, px\) \{\s*\n\s*if \(px > 0\) a = \(\(a % px\) \+ px\) % px;/,
  "terrainHash must wrap its x lattice index, or no terrain field can close around the wrap");
assert.match(game, /function terrainScale\(want\) \{[\s\S]*?Math\.round\(WORLD_W \/ Math\.max\(1, want\)\)[\s\S]*?scale: WORLD_W \/ cells, px: cells/,
  "sampling scales must snap to a whole number of lattice cells per world — a fractional period cannot close");
assert.match(game, /const p2 = px > 0 \? Math\.max\(1, Math\.round\(px \* 2\.3\)\)[\s\S]*?const p4 = px > 0 \? Math\.max\(1, Math\.round\(px \* 4\.7\)\)/,
  "every fbm octave needs its own whole-cell period — an octave that does not close reintroduces the " +
  "seam at a third the amplitude, which is harder to see and no less wrong");
assert.match(game, /const k = \(\(s % slots\) \+ slots\) % slots;/,
  "spire slot IDENTITY must wrap, or a chimney is sheared in half at the seam");
assert.match(game, /const centre = \(s \+ 0\.5\) \* spacing/,
  "...while spire GEOMETRY keeps the unwrapped index, so a spire straddling the seam stays continuous");
for (const [call, what] of [
  [/terrainFbm1\(wx \/ feat\.scale, seed, feat\.px\)/, "the surface profile"],
  [/terrainNoise2\(wx \/ warp\.scale, wy \/ warp\.scale, seed \+ 31, warp\.px\)/, "the organic warp"],
  [/terrainNoise2\(sx \/ pores\.scale, sy \/ pores\.scale, seed \+ 7, pores\.px\)/, "the pore network"],
]) assert.match(game, call, `${what} must sample on a snapped, periodic scale`);

// and prove it numerically, with the real functions
{
  const grab = (re) => game.match(re)[0];
  const src = ["terrainHash", "terrainScale", "terrainNoise1", "terrainFbm1", "terrainNoise2", "terrainSpireLift"]
    .map((f) => grab(new RegExp(`function ${f}\\([\\s\\S]*?\\n  \\}`))).join("\n");
  const W = 2600;
  const api = new Function("WORLD_W", `${src}\nreturn {terrainFbm1,terrainNoise2,terrainSpireLift,terrainScale};`)(W);
  const L = { thickness: 200, roughness: 0.5, featureSize: 300, poreSize: 20, warp: 0.6,
              spires: 0.4, spireHeight: 120, spireWidth: 80, seed: 12345 };
  const feat = api.terrainScale(Math.max(40, L.featureSize));
  const face = (x) => (api.terrainFbm1(x / feat.scale, L.seed, feat.px) - 0.5) * L.roughness * L.thickness
                      - api.terrainSpireLift(L, x);
  assert.ok(Math.abs(face(W) - face(0)) < 1e-9,
    `the surface must be continuous across the wrap, got a ${Math.abs(face(W) - face(0)).toFixed(2)}px step`);
  const wp = api.terrainScale(Math.max(24, L.poreSize * 3)), pr = api.terrainScale(Math.max(8, L.poreSize));
  const pore = (x, y) => {
    const dx = (api.terrainNoise2(x / wp.scale, y / wp.scale, L.seed + 31, wp.px) - 0.5) * 2 * L.warp * wp.scale;
    return api.terrainNoise2((x + dx) / pr.scale, y / pr.scale, L.seed + 7, pr.px);
  };
  for (let y = 1600; y < 1990; y += 13) assert.ok(Math.abs(pore(W, y) - pore(0, y)) < 1e-9,
    `the warped pore field must be continuous across the wrap at y=${y}`);
}
console.log("Terrain wrap contracts OK: surface, warp, pores and spires all close around the torus.");
