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

const defaults = {
  day: { lengthSec: 240, startHour: 0, latitude: 45, dayOfYear: 172 },
  diel: { tempBase: 20, tempAmp: 6, tempLag: 0.15, foodFloor: 0.3, grazeNight: 1, twilight: 0.1, q10: 2, q10RefC: 20,
          waterNight: [5, 20, 30], waterDay: [40, 120, 150] },
  substrate: { count: 80, sizeMin: 20, sizeMax: 60, lifeMin: 30, lifeMax: 90 },
  predator: { count: 4, senseRange: 170, chaseSpeed: 42.5, wanderSpeed: 25, mealEnergy: 58, metabolism: 10,
              resistStep: 0.12, resistMax: 0.85, reproEnergy: 320, reproCooldown: 11, safetyMax: 300 },
  phage: { greenCount: 18, goldCount: 4, hostTolerance: 2, adsorbBase: 0.3, maxCount: 2500,
           life: [16, 24], latent: [9, 15], burst: [4, 8] },
  cell: { startEnergy: 100, divideThreshold: 200, maxEnergy: 260 },
  enzyme: { life: 6, maxRadius: 40 }, toxin: { life: 4.5, maxRadius: 40 }, eps: { lifePerLevel: 4, radius: 24 },
};

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
