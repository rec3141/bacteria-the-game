import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const game = readFileSync(new URL("../game.js", import.meta.url), "utf8");
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");

assert.match(game, /const ANNOUNCEMENT_GAP = 86, ANNOUNCEMENT_MS = 1350/,
  "announcements must sit farther from the controlled organism and clear quickly");
assert.match(game, /function positionToast\(\)[\s\S]*?controlledEntity\(\)[\s\S]*?- ANNOUNCEMENT_GAP/,
  "the shared announcement must follow either a bacterium or a protist at the larger gap");
assert.match(html, /#toast::before \{ content: attr\(data-icon\)/,
  "one announcement component must support adaptation, deployable, and lineage icons");

const enzymeActions = game.slice(game.indexOf("function cycleEnzyme"), game.indexOf("function lineageReps"));
assert.match(enzymeActions, /state\.activeEnzyme = owned\[[^;]+;\s*announceDeployable\(state\.activeEnzyme\)/,
  "cycling the loaded deployable must announce its name and color");
assert.match(enzymeActions, /state\.activeEnzyme = id; announceDeployable\(id\)/,
  "selecting a gene chip must use the same announcement");

const lineageActions = game.slice(game.indexOf("const lineageKey ="), game.indexOf("function divide"));
assert.match(lineageActions, /population = cells\.reduce\([\s\S]*?lineageKey\(x\) === key/,
  "lineage announcements must count the currently living population of the selected color");
assert.match(lineageActions, /showAnnouncement\(`Lineage · \$\{population\.toLocaleString\(\)\}[\s\S]*?lineageKeyColor\(key\), "●"\)/,
  "lineage announcements must use the newly selected lineage color");
assert.match(lineageActions, /target\.controlled = true;[\s\S]*?announceLineage\(target\)/,
  "control changes must announce the new lineage after selection");

console.log("Announcement contracts OK: gene and lineage switches are brief, distant, colored, and counted.");
