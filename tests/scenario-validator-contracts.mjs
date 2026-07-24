import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Guards #28: the scenario validator is a pure, data-only gate on UNTRUSTED scenario JSON. It may set
// whitelisted environment/organism parameters but can never introduce code or a new game verb, and any
// violation rejects the WHOLE scenario (atomic → the caller falls back to the stock ocean). We run the
// real production validator (the TUNE + SCENARIO blocks, sliced out of game.js) against a representative
// defaults tree.
const game = readFileSync(new URL("../game.js", import.meta.url), "utf8");
const tune = game.match(/\/\/ TUNE_VALIDATOR_START[\s\S]*?\/\/ TUNE_VALIDATOR_END/)?.[0];
const scen = game.match(/\/\/ SCENARIO_VALIDATOR_START[\s\S]*?\/\/ SCENARIO_VALIDATOR_END/)?.[0];
assert.ok(tune && scen, "both validator blocks must be extractable");
const { validateScenario } = new Function(`${tune}\n${scen}\nreturn { validateScenario };`)();

// The defaults come out of game.js's own CFG rather than being restated here. A hand-written copy
// drifts: this one had substrate at count 80 / size 20-60 when the game actually uses 60 / 30-200,
// so every assertion below was measured against an ocean that does not exist. The identical copy in
// the scenario repo's defaults.json had drifted in 17 values and was being quoted to the generator
// as ground truth, which is how scenarios ended up with a fraction of the intended food.
const cfgStart = game.indexOf("const CFG = {");
assert.ok(cfgStart >= 0, "CFG must be findable in game.js");
const defaults = (() => {
  const open = game.indexOf("{", cfgStart);
  let depth = 0, i = open, inLine = false, inBlock = false, quote = null;
  for (; i < game.length; i++) {
    const c = game[i], n = game[i + 1];
    if (inLine) { if (c === "\n") inLine = false; continue; }
    if (inBlock) { if (c === "*" && n === "/") { inBlock = false; i++; } continue; }
    if (quote) { if (c === "\\") { i++; continue; } if (c === quote) quote = null; continue; }
    if (c === "/" && n === "/") { inLine = true; i++; continue; }
    if (c === "/" && n === "*") { inBlock = true; i++; continue; }
    if (c === '"' || c === "'" || c === "`") { quote = c; continue; }
    if (c === "{") depth++;
    else if (c === "}") { depth--; if (depth === 0) { i++; break; } }
  }
  return new Function(`return ${game.slice(open, i)};`)();
})();
// a guard on the guard: if the shape ever changes, fail loudly rather than test a partial object
for (const k of ["substrate", "diel", "cell", "predator", "phage", "day"]) {
  assert.ok(defaults[k] && typeof defaults[k] === "object", `extracted CFG is missing ${k}`);
}

// A scenario must leave enough food to be survivable. Generated scenarios kept writing real microbial
// dimensions into substrate.sizeMin/sizeMax — 3-9, 0.4-1.2 — which are RADII IN SCREEN PIXELS
// (default 20-60), leaving boards with under 3% of the default food. Every one was unplayable.
{
  const mk = (env) => ({ schema: "bacteria-scenario", version: 1,
    meta: { title: "T", date: "2026-07-23", lesson: "L" }, env });
  const food = (s) => {
    const p = 1.6, a = s.sizeMin, b = s.sizeMax;
    return ((Math.pow(b, 3 - p) - Math.pow(a, 3 - p)) / (3 - p)) /
           ((Math.pow(b, 1 - p) - Math.pow(a, 1 - p)) / (1 - p)) * s.count;
  };
  const D = defaults.substrate;
  const want = food(D) * 0.5;

  // micrometre-scale sizes must be rescued, not passed through
  for (const env of [
    { "substrate.sizeMin": 3, "substrate.sizeMax": 9, "substrate.count": 95 },
    { "substrate.sizeMin": 0.4, "substrate.sizeMax": 1.2, "substrate.count": 40 },
    { "substrate.sizeMin": 2, "substrate.sizeMax": 8, "substrate.count": 30 },
  ]) {
    const r = validateScenario(mk(env), defaults);
    assert.ok(r.ok, `a mis-scaled scenario must be repaired, not rejected: ${r.reason}`);
    assert.ok(food(r.scenario.cfg.substrate) >= want * 0.999,
      `scenario left only ${Math.round(food(r.scenario.cfg.substrate) / food(D) * 100)}% of the default food`);
  }

  // and a legitimately authored board must come through untouched — including a deliberately
  // coarse one, which must not be "corrected" toward the default
  for (const env of [{ "substrate.count": 80 }, { "substrate.count": 55 },
                     { "substrate.sizeMin": 40, "substrate.sizeMax": 120, "substrate.count": 60 }]) {
    const r = validateScenario(mk(env), defaults);
    assert.ok(r.ok, "a legitimate scenario must validate");
    const s = r.scenario.cfg.substrate;
    assert.equal(s.sizeMin, env["substrate.sizeMin"] ?? D.sizeMin, "a healthy board must not be rescaled");
    assert.equal(s.sizeMax, env["substrate.sizeMax"] ?? D.sizeMax, "a healthy board must not be rescaled");
  }
}

// What a scenario may set is now a deny-rule over CFG rather than a hand-kept allow-list. The list
// had gone stale in the way lists do — it reached 45 of 195 tuning paths, so generated levels could
// only ever differ in the same handful of knobs. Opening it up is only safe because the rule still
// resolves each path against the real defaults tree, so nothing invented gets through, and because
// the ceilings that bound memory and frame time stay closed.
{
  const mk = (env) => ({ schema: "bacteria-scenario", version: 1,
    meta: { title: "T", date: "2026-07-23", lesson: "L" }, env });
  const accepts = (path, v) => validateScenario(mk({ [path]: v }), defaults).ok;

  for (const [path, v] of [["diel.waterNight.0", 3], ["diel.waterDay.2", 120], ["predator.chaseSpeed", 60],
                           ["phage.burst.1", 12], ["cell.uptake", 18], ["cycle.protistThrust", 300],
                           ["enzyme.maxRadius", 30]]) {
    assert.ok(accepts(path, v), `${path} should be settable — it is expressive and safely bounded`);
  }
  // ceilings exist to bound memory and frame time; a scenario raising one is a dead tab, not a level
  for (const path of ["cell.maxCells", "phage.maxCount", "predator.safetyMax", "predator.immigrateCap",
                      "phage.greenFloorMax", "phage.seedPerCell"]) {
    assert.ok(!accepts(path, 999999), `${path} is a hard ceiling and must stay closed to scenarios`);
  }
  // device/input knobs and the attract-mode dish are not ecology
  for (const path of ["touchSpeedScale", "cell.touchRunSecs", "phage.goldCountTouch", "demo.foodScale", "grid.cs"]) {
    assert.ok(!accepts(path, 2), `${path} is a device/rendering knob, not a scenario's business`);
  }
  // the column has its own authored block; setting it twice two ways lets a scenario contradict itself
  assert.ok(!accepts("column.enabled", 1), "column.* must be set through the column block, not env");
  // and an invented path must still reject rather than be silently dropped — it is a hallucination signal
  assert.ok(!accepts("nonsense.invented", 1), "an unknown path must reject");
  assert.ok(!accepts("substrate.__proto__", 1), "a prototype-shaped path must not resolve");
}

const base = () => ({
  schema: "bacteria-scenario", version: 1,
  meta: { title: "Deepwater Horizon", date: "2026-07-18", lesson: "Oil-degrading bacteria bloomed on the 2010 plume.", realWorldBasis: "Deepwater Horizon (2010)" },
  env: { day: { latitude: 28 }, diel: { tempBase: 12 }, substrate: { count: 60 }, phage: { greenCount: 30 } },
  resources: [{ index: 0, label: "crude oil", enzymeLabel: "alkane hydroxylase (alkB)", color: "#3a2f28" }],
  actions: { enzyme0: { label: "alkB expression", weight: 3 }, antibiotic: { weight: 0 } },
  particles: { oilDroplet: { label: "oil droplet", mix: [0.95, 0.03, 0.02], rMin: 30, rMax: 55, shape: "aggregate", weight: 1.4 } },
  organisms: { cells: [{ id: "alcanivorax", label: "Alcanivorax-like", color: "#d8b25a", genome: { enzLvl: [2, 0, 1], chemoLevel: 1 }, immigrateWeight: 1.5 }] },
  column: { enabled: false, layers: [{ depth: 0, tempC: 24, light: 1 }, { depth: 20, tempC: 12, light: 0.1, nutrient: 1 }] },
});

// ---- the happy path ----
const ok = validateScenario(base(), defaults);
assert.equal(ok.ok, true, "a well-formed scenario validates: " + (ok.reason || ""));
assert.equal(ok.scenario.cfg.day.latitude, 28, "a whitelisted env override is applied");
assert.equal(ok.scenario.cfg.phage.greenCount, 30, "env integer override applied");
assert.equal(ok.scenario.cfg.substrate.count, 60, "env override applied");
assert.equal(ok.scenario.resources[0].enzymeLabel, "alkane hydroxylase (alkB)", "resource re-skin kept");
assert.ok(Math.abs(ok.scenario.particles.oilDroplet.mix.reduce((a, b) => a + b, 0) - 1) < 1e-9, "particle mix renormalized to 1");
assert.equal(ok.scenario.organisms.cells[0].genome.enzLvl[0], 2, "organism genome kept");
assert.equal(ok.scenario.column.enabled, false, "column parsed but disabled in v1");

// ---- chemolithotrophy: a chemosynthesizer trait + a dissolved chemical-energy field ----
const chemo = base();
chemo.organisms.cells[0].genome.chemolithotroph = true;
chemo.column.chemical = { peakDepth: 0.9, spread: 0.15, strength: 0.8, color: "#d9c24a" };
const cres2 = validateScenario(chemo, defaults);
assert.equal(cres2.ok, true, "a chemolithotroph scenario validates: " + (cres2.reason || ""));
assert.equal(cres2.scenario.organisms.cells[0].genome.chemolithotroph, true, "the chemolithotroph trait is kept");
assert.equal(cres2.scenario.column.chemical.strength, 0.8, "the chemical field is kept");
{
  const bad = base(); bad.column.chemical = { peakDepth: 0.9, spread: 0.15, strength: 5 };
  assert.equal(validateScenario(bad, defaults).ok, false, "an out-of-range chemical strength rejects");
  const bad2 = base(); bad2.organisms.cells[0].genome.photosynthesis = true;
  assert.equal(validateScenario(bad2, defaults).ok, false, "an unknown genome trait still rejects (no smuggled verbs)");
}

// ---- clamping: an out-of-range env number is pinned into range, not rejected ----
const clamped = base(); clamped.env.day.latitude = 999;
const cres = validateScenario(clamped, defaults);
assert.equal(cres.ok, true, "an out-of-range env value is clamped, not rejected");
assert.equal(cres.scenario.cfg.day.latitude, 90, "latitude clamped to its max");

// ---- rejections (each must reject the WHOLE scenario) ----
const reject = (mutate, why) => {
  const s = base(); mutate(s);
  const r = validateScenario(s, defaults);
  assert.equal(r.ok, false, `must reject: ${why}`);
};
reject((s) => { s.schema = "nope"; }, "wrong schema tag");
reject((s) => { s.version = 2; }, "unsupported version");
reject((s) => { s.surprise = 1; }, "unknown top-level key");
reject((s) => { delete s.meta.title; }, "missing meta.title");
reject((s) => { s.meta.date = "July 18"; }, "bad date format");
reject((s) => { s.env.nutrient = { maxCount: 99999 }; }, "off-whitelist env path (a hard safety cap)");
reject((s) => { s.env.phage = { maxCount: 99999 }; }, "off-whitelist env path (phage cap)");
reject((s) => { s.actions.photosynthesis = { weight: 5 }; }, "unknown action primitive (no new verbs)");
reject((s) => { s.actions = { enzyme0: { weight: 0 }, antibiotic: { weight: 0 } }; }, "no obtainable adaptation");
reject((s) => { s.particles.oilDroplet.mix = [1, 0]; }, "particle mix wrong length");
reject((s) => { s.particles.oilDroplet.mix = [0, 0, 0]; }, "particle mix all zero");
reject((s) => { s.organisms.cells[0].genome.photosystem = 3; }, "unknown genome field (no smuggled fields)");
reject((s) => { s.organisms.cells[0].genome.enzLvl = [2, 0]; }, "genome.enzLvl wrong length");
reject((s) => { s.resources.push({ index: 0, label: "dup" }); }, "duplicate resource index");
reject((s) => { s.column.layers = [{ depth: 20 }, { depth: 5 }]; }, "column depths not ascending");
reject((s) => { s.env.day.latitude = "north"; }, "non-numeric env value");

console.log("Scenario validator contract OK: whitelisted env applied+clamped, re-skins kept, and every structural/unknown-key/new-verb violation rejects atomically.");
