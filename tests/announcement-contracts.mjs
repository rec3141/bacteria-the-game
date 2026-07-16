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

const deathTransfer = game.slice(game.indexOf("function transferControl(c)"), game.indexOf("function releaseGreenPhages"));
assert.match(deathTransfer, /if \(!others\.length\) return/,
  "a death-switch toast requires a surviving cell to receive control");
assert.match(deathTransfer, /const revived = best\.cyst;[\s\S]*best\.controlled = true;[\s\S]*best\.cyst = false/,
  "the transfer records whether its replacement had to be revived from a cyst");
assert.match(deathTransfer, /cam\.x = best\.x; cam\.y = best\.y;[\s\S]*showAnnouncement\(revived \? "You died · cyst revived" : "You died · switched cells"/,
  "the death toast is positioned at the replacement and distinguishes cyst revival");
assert.match(deathTransfer, /lineageKeyColor\(lineageKey\(best\)\), "☠"/,
  "the death toast uses the replacement lineage color and a mortality icon");
assert.match(game, /function onCellDeath\(c, cause\)[\s\S]*if \(c\.controlled\) transferControl\(c\)/,
  "every controlled-cell mortality path transfers control through the announced switch");

console.log("Announcement contracts OK: gene and lineage switches are brief, distant, colored, and counted.");
