import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const game = readFileSync(new URL("../game.js", import.meta.url), "utf8");
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const validatorSource = game.match(/\/\/ TUNE_VALIDATOR_START[\s\S]*?\/\/ TUNE_VALIDATOR_END/)?.[0];
assert.ok(validatorSource, "production tuning validator block is present");

const { validateTuningConfig } = new Function(
  `${validatorSource}\nreturn { validateTuningConfig };`,
)();

const shippedCfgSource = game.match(/  const CFG = \{[\s\S]*?\n  \};/)?.[0];
assert.ok(shippedCfgSource, "shipped CFG object is present");
const shippedCfg = new Function(`${shippedCfgSource}\nreturn CFG;`)();
assert.deepEqual(validateTuningConfig(shippedCfg, shippedCfg), [], "shipped defaults satisfy every invariant");

const valid = {
  grid: { cs: 8 },
  day: { lengthSec: 240, startHour: 6, latitude: 45, dayOfYear: 180 },
  diel: {
    tempBase: 18, tempLag: 0.25, foodFloor: 0.2, twilight: 0.25, goldTint: 0.4,
    q10: 2, q10RefC: 20, waterNight: [4, 16, 28], waterDay: [14, 60, 78],
  },
  cell: {
    radius: 6, baseHalf: 1, maxHalf: 3, maxEnergy: 100, startEnergy: 50,
    divideThreshold: 80, cystBelow: 10, cystWake: 20, runMin: 1, runMax: 3,
    enzymeCooldown: [1, 2], maxCells: 500, startUpgrades: 0,
  },
  substrate: { count: 30, sizeMin: 4, sizeMax: 12, lifeMin: 5, lifeMax: 10, driftMin: 0, driftMax: 2 },
  predator: { count: 8, minCount: 2, immigrateCap: 12, safetyMax: 20 },
  phage: {
    maxCount: 100, greenCount: 20, greenFloor: 5, goldCount: 4, goldCountTouch: 2,
    life: [5, 10], burst: [2, 4], latent: [1, 2], greenSeed: [2, 3], goldLife: [3, 5],
  },
  cycle: { turboSecs: 4, turboMaxSecs: 10 },
  enzyme: { life: 2 },
};
const defaults = structuredClone(valid);

assert.deepEqual(validateTuningConfig(valid, defaults), [], "valid configuration is accepted");

function rejects(mutator, pattern) {
  const candidate = structuredClone(valid);
  mutator(candidate);
  assert.match(validateTuningConfig(candidate, defaults).join("\n"), pattern);
  assert.deepEqual(valid, defaults, "validation does not mutate the live configuration");
}

rejects((c) => { c.grid.cs = 0; }, /grid\.cs must be between/);
rejects((c) => { c.day.lengthSec = 0; }, /day\.lengthSec must be between/);
rejects((c) => { c.substrate.sizeMin = 13; }, /substrate\.sizeMin must not exceed substrate\.sizeMax/);
rejects((c) => { c.phage.life = [11, 10]; }, /phage\.life\.0 must not exceed phage\.life\.1/);
rejects((c) => { c.cell.runMin = 4; }, /cell\.runMin must not exceed cell\.runMax/);
rejects((c) => { c.enzyme.life = -1; }, /enzyme\.life must be between/);
rejects((c) => { c.touch = { autoEnzymeEvery: 0 }; }, /touch\.autoEnzymeEvery must be between/);
rejects((c) => { c.predator.count = 21; }, /protist count cannot exceed its safety cap/);
rejects((c) => { c.predator.minCount = 13; }, /protist minimum cannot exceed its immigration cap/);
rejects((c) => { c.predator.count = 2.5; }, /predator\.count must be an integer/);
rejects((c) => { c.day.lengthSec = Number.NaN; }, /day\.lengthSec must be finite/);

const adminApply = game.match(/function adminApply\(obj\) \{[\s\S]*?\n  \}/)?.[0] ?? "";
assert.ok(adminApply.indexOf("validateTuningConfig(candidate") < adminApply.indexOf("commitCfg(candidate)"),
  "preset validation happens before its atomic commit");
assert.match(game, /const candidate = cloneCfg\(CFG\); cfgSet\(candidate, leaf\.path, v\);[\s\S]*?if \(errors\.length\)[\s\S]*?return false;[\s\S]*?cfgSet\(CFG, leaf\.path, v\)/,
  "single-field edits validate a clone before changing live CFG");
assert.match(html, /id="adminStart">Start new game with these settings<\/button>/,
  "the tuning panel exposes an explicit fresh-run action");
assert.match(game, /el\.adminStart\.addEventListener\("click", \(\) => \{[\s\S]*?toggleAdmin\(false\);[\s\S]*?start\(\);/,
  "the tuning action closes the panel and starts a fresh game with the live CFG");

console.log("tuning validation contracts passed");
