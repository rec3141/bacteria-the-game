// A scenario that names three organisms is describing a COMMUNITY. It has to still be one an hour in.
//
// immigrateBacteria used to try reviveGenome FIRST and only reach the authored archetypes when the
// dead-bank was empty. The bank fills within the first minute of any real run, so from then on every
// immigrant was a revival of an already-seen genome -- overwhelmingly the founder's own lineage. The
// second and third organisms got a brief opening window and then never appeared again, and a level
// designed around three organisms played as one. Nothing errored and nothing looked wrong.
//
// These drive the real missingArchetypes() and the real immigration priority against a stub world.
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

const ARCHES = [
  { id: "founder",  immigrateWeight: 5, genome: { enzLvl: [1, 1, 1], chemoLevel: 1 } },
  { id: "rival",    immigrateWeight: 3, genome: { enzLvl: [2, 0, 1], chemoLevel: 0 } },
  { id: "splitter", immigrateWeight: 2, genome: { enzLvl: [0, 2, 1], chemoLevel: 0 } },
];

// missingArchetypes reads `cells` and `scenarioArchetypes()`; both are stubbed.
function harness(cells, arches = ARCHES) {
  return new Function(`
    const cells = ${JSON.stringify(cells)};
    const scenarioArchetypes = () => ${JSON.stringify(arches)};
    ${grab("missingArchetypes")}
    return missingArchetypes;`)();
}

// ---- it must notice a type that is gone ------------------------------------------------------------
{
  const missing = harness([{ alive: true, arche: "founder" }, { alive: true, arche: "founder" }]);
  assert.deepEqual(missing().map((a) => a.id).sort(), ["rival", "splitter"],
    "two authored types with nobody alive must both be reported missing");
}
{
  const missing = harness([{ alive: true, arche: "founder" }, { alive: true, arche: "rival" },
                           { alive: true, arche: "splitter" }]);
  assert.deepEqual(missing(), [], "a fully represented community needs no recolonisation");
}
// a DEAD cell does not count as representation -- this is the whole failure mode
{
  const missing = harness([{ alive: true, arche: "founder" }, { alive: false, arche: "rival" },
                           { alive: false, arche: "splitter" }]);
  assert.deepEqual(missing().map((a) => a.id).sort(), ["rival", "splitter"],
    "corpses do not keep a type in the community");
}
// a single-organism scenario has no community to lose, and a stock ocean has no archetypes at all
{
  assert.deepEqual(harness([], [ARCHES[0]])(), [], "one organism cannot go locally extinct");
  const stock = new Function(`
    const cells = [];
    const scenarioArchetypes = () => null;
    ${grab("missingArchetypes")}
    return missingArchetypes;`)();
  assert.deepEqual(stock(), [], "a stock ocean has no archetypes to miss");
}

// ---- the priority order itself --------------------------------------------------------------------
// Reproduced from the real source so the ORDER is what is under test. Guarded below by asserting the
// production code still has recolonisation ahead of revival -- if that ever flips, this stops matching.
function immigrantSource({ gone, bankHasGenomes, hasScenario }) {
  if (gone.length) return "recolonise";
  if (bankHasGenomes) return "revive";
  return hasScenario ? "archetype" : "random";
}

assert.equal(immigrantSource({ gone: ["rival"], bankHasGenomes: true, hasScenario: true }), "recolonise",
  "a missing type outranks revival -- this is the entire fix; with it the other way round the bank " +
  "fills in the first minute and the community never comes back");
assert.equal(immigrantSource({ gone: [], bankHasGenomes: true, hasScenario: true }), "revive",
  "with the community intact, immigration still prefers what this run evolved");
assert.equal(immigrantSource({ gone: [], bankHasGenomes: false, hasScenario: true }), "archetype",
  "an empty bank in a scenario falls through to its authored organisms");
assert.equal(immigrantSource({ gone: [], bankHasGenomes: false, hasScenario: false }), "random",
  "a stock ocean with an empty bank must still get a random genome -- an early version of this fix " +
  "skipped the whole block here and immigrants arrived with no genome at all");

// ---- and the production code must actually be in that order ---------------------------------------
const imm = game.slice(game.indexOf("function immigrateBacteria"), game.indexOf("function becomeProtist"));
// The BRANCH order, not the declaration order. `const gone = missingArchetypes()` sits above either
// way, so comparing the index of that against reviveGenome passes even with the branches swapped --
// which is exactly what the first version of this assertion did, and the mutation test walked
// straight through it.
assert.match(imm, /if \(gone\.length\) arche = gone\[[^\]]+\];\s*\n\s*else if \(reviveGenome\(c\)\) revived = true;/,
  "recolonisation must be the FIRST branch and revival the second -- reversed, the dead-bank fills " +
  "in the first minute and the authored community never comes back");
assert.match(imm, /if \(!revived\) \{/,
  "the genome branches must be skipped only when a genome was actually revived");
assert.match(imm, /c\.arche = arche\.id;/, "an immigrant must record which type it is");
assert.match(game, /d1\.arche = d2\.arche = c\.arche \|\| null;/,
  "type identity must be heritable, or every division erases the community membership");

console.log("Archetype coexistence contracts OK: extinct types recolonise, revival still preferred otherwise.");
