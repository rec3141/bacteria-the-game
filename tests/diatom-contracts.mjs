// Diatoms: a third organism class, not a bacterium with a flag set.
//
// The claims that matter are behavioural, so these RUN the real functions against a stub world rather
// than asserting the source mentions them: a diatom only eats light, it sinks, only a pennate glides
// and only against a surface, division never changes its drawn size, and dying releases biomass.
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

const FNS = ["diatomUnit", "diatomHalfW", "diatomHalfLen", "diatomArea",
             "diatomCap", "diatomDivideAt", "diatomStartEnergy", "diatomNodes",
             "makeDiatom", "diatomSpecs", "diatomWant", "immigrateDiatoms",
             "diatomMotes", "killDiatomCell", "releaseDiatom",
             "updateDiatoms", "diatomDivide", "diatomTouchingSurface", "collideDiatom", "particleUnderDiatom"];

// A stub ocean. `light` is a fixed value so photosynthesis is testable without the diel cycle, and
// `terrainBands` are horizontal slabs so "is it touching a surface" is decidable in the test.
function world({ specs = null, light = 1, terrainBands = [], substrates = [] } = {}) {
  const src = FNS.map(grab).join("\n\n");
  return new Function(`
    const WORLD_W = 2600, WORLD_H = 2000;
    const CFG = ${JSON.stringify(cfgOf(game))};
    const clamp = (v,a,b) => v<a?a:v>b?b:v;
    const rand = (a,b) => a + Math.random()*(b-a);
    const wrapX = (v) => ((v % WORLD_W) + WORLD_W) % WORLD_W;
    const wrapY = (v) => (v < 0 ? 0 : v > WORLD_H ? WORLD_H : v);
    const columnState = { photicFrac: 0.4 };
    const columnLightAt = () => ${light};
    const env = { metabolismMult: 1 };
    const terrain = ${JSON.stringify(terrainBands)};
    let substrates = ${JSON.stringify(substrates)};
    let nutrients = [], toxins = [], diatoms = [];
    let state = { diatomT: 999, calLive: [0,0,0,0,0,0], calFull: [0,0,0,0,0,0], elapsed: 0 };
    const CAL_AUTO = 5;
    const activeScenario = ${specs ? JSON.stringify({ organisms: { diatoms: specs } }) : "null"};
    const burst = () => {};
    const spawnToxinCloud = (x, y, spec) => toxins.push({ x, y, spec });
    const solidAtWorld = (p, wx, wy) => Math.abs(wy - p.y) < p.half && Math.abs(wx - p.x) < p.half;
    const pushCircleOut = (b, wx, wy, r) =>
      (wy + r > b.y0 && wy - r < b.y1) ? { x: 0, y: (wy < (b.y0+b.y1)/2 ? -1 : 1) * 4 } : null;
    const clearOfTerrain = (wx, wy, r) => !terrain.some((b) => wy + r > b.y0 && wy - r < b.y1);
    ${src}
    return { makeDiatom, updateDiatoms, diatomDivide, killDiatomCell, diatomMotes,
             diatomNodes, diatomHalfLen, diatomHalfW, diatomArea,
             diatomCap, diatomStartEnergy, diatomUnit,
             diatomWant, immigrateDiatoms, releaseDiatom,
             get diatoms() { return diatoms; }, set diatoms(v) { diatoms = v; },
             get nutrients() { return nutrients; }, get toxins() { return toxins; }, state };`)();
}
// pull the real CFG out of game.js so the test cannot drift from the shipped tuning
function cfgOf(src) {
  const i = src.indexOf("  const CFG = {");
  let d = 0, j = src.indexOf("{", i), started = false;
  for (; j < src.length; j++) {
    if (src[j] === "{") { d++; started = true; }
    else if (src[j] === "}") { d--; if (started && d === 0) { j++; break; } }
  }
  return new Function(`return ${src.slice(src.indexOf("{", i), j)}`)();
}

const CFG = cfgOf(game);
const PENNATE = { id: "pn", form: "pennate", sizeUm: 40, chain: 1, count: 5, color: "#8fd6a8" };
const CENTRIC = { id: "cn", form: "centric", sizeUm: 40, chain: 1, count: 5, color: "#a8c8f0" };

// ---- geometry: micrometres in, pixels out, and the two forms are different objects ----------------
{
  const w = world();
  const pn = w.makeDiatom(PENNATE, 100, 100), cn = w.makeDiatom(CENTRIC, 100, 100);
  assert.equal(w.diatomHalfLen(pn), 40 * CFG.diatom.pxPerUm / 2, "a single frustule is one unit long");
  assert.ok(w.diatomHalfW(cn) > w.diatomHalfW(pn) * 2,
    "a centric is a disc and a pennate is a narrow boat — they must not be the same silhouette");
  const chain = w.makeDiatom({ ...PENNATE, chain: 5 }, 100, 100);
  assert.equal(w.diatomNodes(chain).length, 5, "a chain of five draws five frustules");
  assert.equal(w.diatomHalfLen(chain), w.diatomHalfLen(pn) * 5, "a chain is five times as long");
  // size is authored in um and clamped to the documented range
  assert.equal(w.makeDiatom({ ...PENNATE, sizeUm: 900 }, 0, 0).um, 100, "sizeUm is capped at 100");
  assert.equal(w.makeDiatom({ ...PENNATE, sizeUm: 0.2 }, 0, 0).um, 5, "sizeUm has a 5um floor");
  // area drives both income and cost, so it must actually scale with size and chain length
  assert.ok(w.diatomArea(w.makeDiatom({ ...PENNATE, sizeUm: 80 }, 0, 0)) >
            w.diatomArea(w.makeDiatom({ ...PENNATE, sizeUm: 20 }, 0, 0)) * 10,
    "area must grow with the square of size, or a big diatom is free to run");
}

// ---- light is the ONLY income ----------------------------------------------------------------------
{
  const lit = world({ light: 1 }), dark = world({ light: 0 });
  const run = (w) => {
    const d = w.makeDiatom(CENTRIC, 500, 300); d.energy = 100;
    w.diatoms = [d];
    for (let i = 0; i < 20; i++) w.updateDiatoms(0.1);
    return w.diatoms.length ? w.diatoms[0].energy : 0;
  };
  const bright = run(lit), unlit = run(dark);
  assert.ok(bright > 100, `a lit diatom must gain energy (got ${bright.toFixed(1)})`);
  assert.ok(unlit < 100, `an unlit diatom must lose energy — there is no other income (got ${unlit.toFixed(1)})`);
  // and the gain must be booked to the autotrophy bucket, or it vanishes from the calorie chart
  assert.ok(lit.state.calLive[5] > 0, "diatom photosynthesis must be credited to the autotrophy bucket");
}

// ---- it sinks --------------------------------------------------------------------------------------
{
  const w = world({ light: 1 });
  const d = w.makeDiatom(CENTRIC, 500, 300); w.diatoms = [d];
  const y0 = d.y;
  for (let i = 0; i < 20; i++) w.updateDiatoms(0.1);
  assert.ok(w.diatoms[0].y > y0, "a diatom sinks");
  // bigger sinks faster — Stokes, and the reason a bloom stratifies
  const fall = (um) => {
    const ww = world({ light: 1 });
    const dd = ww.makeDiatom({ ...CENTRIC, sizeUm: um }, 500, 300); ww.diatoms = [dd];
    const start = dd.y;
    for (let i = 0; i < 20; i++) ww.updateDiatoms(0.1);
    return ww.diatoms[0].y - start;
  };
  assert.ok(fall(80) > fall(10) * 2, "a bigger frustule must sink appreciably faster");
}

// ---- only a pennate glides, and only against a surface --------------------------------------------
{
  const FLOOR = [{ y0: 1400, y1: 2000 }];
  // Start ON the floor, not above it: a pennate only glides where its raphe has something to grip, so
  // a cell dropped in open water would spend the whole test sinking and never touch anything.
  const drift = (spec, bands) => {
    const w = world({ light: 1, terrainBands: bands });
    const d = w.makeDiatom(spec, 500, 1398); d.angle = 0; d.energy = 150;
    w.diatoms = [d];
    const x0 = d.x;
    for (let i = 0; i < 30; i++) w.updateDiatoms(0.1);
    return Math.abs(w.diatoms.length ? w.diatoms[0].x - x0 : 0);
  };
  const pennateOnFloor = drift(PENNATE, FLOOR);
  const pennateOpen = drift(PENNATE, []);
  const centricOnFloor = drift(CENTRIC, FLOOR);
  assert.ok(pennateOnFloor > pennateOpen * 3,
    `a pennate must glide against a surface and barely move in open water (floor ${pennateOnFloor.toFixed(0)}px vs open ${pennateOpen.toFixed(0)}px)`);
  assert.ok(pennateOnFloor > centricOnFloor * 3,
    `only a pennate has a raphe — a centric on the same floor must not glide (${centricOnFloor.toFixed(0)}px)`);
}

// ---- division: a chain grows ONE CELL at a time, at the end, and nothing else moves ---------------
// A chain IS the record of past divisions that stayed attached, so it has to lengthen cell by cell.
// The first version incremented n, and since the chain is drawn centred on d.x that slid every existing
// frustule half a unit sideways -- the whole chain jumped each time one cell divided. Worse, the other
// branch budded a COMPLETE copy of the chain at a random offset, so a six-cell chain appeared out of
// nowhere beside its parent. Both are what "the diatoms are jumping around" and "a whole new chain
// appears" were.
{
  const w = world({ light: 1 });
  const d = w.makeDiatom({ ...CENTRIC, chain: 4 }, 500, 300);
  d.angle = 0;                                  // along +x, so the arithmetic is checkable by hand
  d.n = 2;                                      // room to grow before it reaches chainMax
  const before = w.diatomNodes(d).map(([x, y]) => [Math.round(x), Math.round(y)]);
  d.energy = w.diatomCap(d);
  w.diatomDivide(d, []);
  assert.equal(d.n, 3, "division must add exactly one frustule");
  const after = w.diatomNodes(d).map(([x, y]) => [Math.round(x), Math.round(y)]);
  for (let i = 0; i < before.length; i++) {
    assert.deepEqual(after[i], before[i],
      `existing frustule ${i} must not move when the chain grows (was ${before[i]}, now ${after[i]})`);
  }
  const u = w.diatomUnit(d);
  assert.ok(Math.abs((after[2][0] - before[1][0]) - u) < 1.5,
    "the new cell must appear at the END of the chain, one unit along");
}

// ---- at full length the chain BREAKS, and the halves start exactly on the parent -------------------
{
  const w = world({ light: 1 });
  const d = w.makeDiatom({ ...CENTRIC, chain: 4 }, 500, 300);
  d.angle = 0.7;
  const px = d.x, py = d.y, pang = d.angle;
  d.energy = w.diatomCap(d);
  const born = [];
  w.diatomDivide(d, born);
  assert.equal(born.length, 1, "a chain at its authored length must split in two");
  const kid = born[0];
  assert.equal(kid.x, px, "the daughter starts at the parent's exact position");
  assert.equal(kid.y, py, "...both coordinates");
  assert.equal(kid.angle, pang, "...and its exact orientation");
  assert.equal(d.n + kid.n, 4, "the frustules are divided between them, not duplicated");
  assert.ok(kid.dvx !== 0 || kid.dvy !== 0, "and they must then drift apart");
  assert.ok(Math.abs(kid.dvx + d.dvx) < 1e-9 && Math.abs(kid.dvy + d.dvy) < 1e-9,
    "they part FROM EACH OTHER — equal and opposite, not one flung off on its own");
  assert.equal(kid.um, d.um, "splitting must not change cell size");
}

// ---- and the separation decays, so it is a parting rather than a swimming speed --------------------
{
  const w = world({ light: 1 });
  const d = w.makeDiatom(CENTRIC, 500, 300);
  d.dvx = 20; d.dvy = 0; d.energy = w.diatomCap(d) * 0.5;
  w.diatoms = [d];
  for (let i = 0; i < 30; i++) w.updateDiatoms(0.1);
  assert.equal(w.diatoms[0].dvx, 0, "the post-division drift must decay to nothing");
}

// ---- a big diatom must not starve faster than a small one -----------------------------------------
// Metabolism scales with area, so the energy STORE has to as well. It did not at first: a 70um chain
// burned 98/s against a flat 260 ceiling and starved 2.7 seconds into a 120-second night, so every
// large diatom in a bloom died before its first dawn. Nothing errored -- the bloom just quietly
// wasn't there in the morning, which is exactly the class of bug that only shows up by running it.
{
  const w = world({ light: 0 });
  const darkSeconds = (spec) => {
    const d = w.makeDiatom(spec, 500, 300);
    return w.diatomCap(d) / (CFG.diatom.metabolism * w.diatomArea(d));
  };
  const small = darkSeconds({ ...CENTRIC, sizeUm: 20, chain: 1 });
  for (const spec of [{ ...PENNATE, sizeUm: 70, chain: 5 }, { ...CENTRIC, sizeUm: 90 },
                      { ...CENTRIC, sizeUm: 14, chain: 8 }, { ...PENNATE, sizeUm: 100, chain: 12 }]) {
    const got = darkSeconds(spec);
    assert.ok(Math.abs(got - small) < 1e-9,
      `every size must last the same time in the dark (${spec.sizeUm}um x${spec.chain}: ${got.toFixed(1)}s vs ${small.toFixed(1)}s)`);
  }
  assert.ok(small > 120, `a diatom must survive a full night on a full tank (${small.toFixed(0)}s)`);
}

// ---- death is cell by cell, and biomass scales with the cell ---------------------------------------
// A chain starved below the photic zone comes apart one frustule at a time, which is what happens and
// is far more legible than a six-cell chain blinking out of existence.
{
  const w = world({ light: 1 });
  const d = w.makeDiatom({ ...CENTRIC, chain: 5 }, 500, 300);
  d.angle = 0;
  w.diatoms = [d];
  const before = w.diatomNodes(d).map(([x]) => Math.round(x));
  w.killDiatomCell(d);
  assert.equal(d.n, 4, "starvation takes ONE frustule, not the whole chain");
  assert.ok(!d.dead, "a chain with cells left is not dead");
  const after = w.diatomNodes(d).map(([x]) => Math.round(x));
  for (let i = 0; i < after.length; i++) {
    assert.ok(Math.abs(after[i] - before[i]) <= 1,
      "the surviving cells must stay put when the chain shortens");
  }
  assert.ok(d.energy > 0, "the rest of the chain gets a reprieve rather than unravelling in one frame");
  // ...and only the last cell ends it
  for (let i = 0; i < 8 && !d.dead; i++) w.killDiatomCell(d);
  assert.ok(d.dead, "the chain dies when its last cell does");
}
{
  // biomass follows the cell: a 90um frustule is not the same parcel of food as a 15um one
  const w = world({ light: 1 });
  const big = w.makeDiatom({ ...CENTRIC, sizeUm: 90 }, 500, 300);
  const small = w.makeDiatom({ ...CENTRIC, sizeUm: 15 }, 500, 300);
  assert.ok(w.diatomMotes(big) > w.diatomMotes(small) * 3,
    `a big frustule must release far more biomass (${w.diatomMotes(big)} vs ${w.diatomMotes(small)})`);
  assert.ok(w.diatomMotes(big) <= 60, "but never enough to empty the global mote budget on one chain");

  const ww = world({ light: 1 });
  const d = ww.makeDiatom({ ...CENTRIC, sizeUm: 90 }, 500, 300);
  ww.diatoms = [d];
  ww.killDiatomCell(d);
  assert.equal(ww.nutrients.length, ww.diatomMotes(d), "a dead frustule is a parcel of food");
  assert.equal(ww.toxins.length, 0, "a diatom with no authored toxin releases none");
}
{
  // an authored toxin is inside the CELL, so it comes out with the cell that died
  const t = world({ light: 1 });
  const toxic = t.makeDiatom({ ...CENTRIC, chain: 3, toxin: { potency: 30, radius: 90, life: 12 } }, 500, 300);
  t.diatoms = [toxic];
  t.killDiatomCell(toxic);
  assert.equal(t.toxins.length, 1, "one cell dying releases one dose");
  t.killDiatomCell(toxic);
  assert.equal(t.toxins.length, 2, "a chain coming apart poisons the water steadily, not all at once");
}

// ---- exudates: a LIVING diatom feeds the water it is in --------------------------------------------
// A healthy diatom leaks a large share of what it fixes, and that leak is why a phycosphere exists at
// all — the bacteria around a chain are living off what it gives off now, not waiting for it to die.
{
  const lit = world({ light: 1 });
  const d = lit.makeDiatom({ ...CENTRIC, sizeUm: 60 }, 500, 300);
  lit.diatoms = [d];
  for (let i = 0; i < 40; i++) lit.updateDiatoms(0.1);
  assert.ok(lit.nutrients.length > 0, "a photosynthesising diatom must leak dissolved carbon");
  assert.ok(lit.nutrients.every((n) => n.res === 2), "diatom exudate is polysaccharide — the carbohydrate class");

  const dark = world({ light: 0 });
  const d2 = dark.makeDiatom({ ...CENTRIC, sizeUm: 60 }, 500, 300);
  d2.energy = dark.diatomCap(d2);
  dark.diatoms = [d2];
  const before = dark.nutrients.length;
  for (let i = 0; i < 20; i++) dark.updateDiatoms(0.1);
  assert.equal(dark.nutrients.length, before,
    "a diatom in the dark fixes nothing, so it leaks nothing — the exudate is the fixing, not the cell");
}

// ---- starvation actually kills, and the bloom refills ---------------------------------------------
{
  const w = world({ light: 0, specs: [CENTRIC] });
  const d = w.makeDiatom(CENTRIC, 500, 300); d.energy = 1;
  w.diatoms = [d];
  for (let i = 0; i < 40; i++) w.updateDiatoms(0.2);
  assert.ok(!w.diatoms.some((x) => x.energy > 0 && !x.dead) || w.diatoms.length === 0,
    "a diatom in the dark must eventually starve");
  assert.ok(w.nutrients.length > 0, "and leave its biomass behind");
}
{
  const w = world({ light: 1, specs: [PENNATE, CENTRIC] });
  assert.equal(w.diatomWant(), 10, "the authored bloom size is the sum of the type counts");
  for (let i = 0; i < 60; i++) w.immigrateDiatoms();
  const ids = new Set(w.diatoms.map((d) => d.id));
  assert.deepEqual([...ids].sort(), ["cn", "pn"],
    "both authored types must be present — one quietly vanishing is the bug that made multi-organism levels play as one");
  assert.ok(w.diatoms.length <= 10, "immigration must stop at the authored count");
}

// ---- a stock ocean pays nothing --------------------------------------------------------------------
{
  const w = world({ light: 1 });
  assert.equal(w.diatomWant(), 0, "no authored diatoms, no bloom");
  w.updateDiatoms(0.1);
  assert.equal(w.diatoms.length, 0, "and nothing is created");
}

// ---- wiring: the engine must actually run and draw them -------------------------------------------
assert.match(game, /updateDiatoms\(dt\);/, "the game loop must update diatoms");
assert.match(game, /for \(const d of diatoms\) if \(!d\.dead\) drawDiatom\(d\);/, "and draw them");
assert.match(game, /diatoms = Array\.isArray\(E\.diatoms\) \? E\.diatoms : \[\];/,
  "a checkpoint written before diatoms existed must still load");
assert.match(game, /enzymes = \[\]; toxins = \[\]; epsBlocks = \[\]; nutrients = \[\]; particles = \[\]; diatoms = \[\];/,
  "a new run must start with an empty bloom");

console.log("Diatom contracts OK: light-only, sinking, pennate-only gliding, fixed size, biomass on death.");
