import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(resolve(root, path), "utf8");
const game = read("game.js");
const help = read("index.html");
const readme = read("README.md");

const filesBlock = game.match(/const files = \{([\s\S]*?)\};/);
assert(filesBlock, "audio file map is missing");

const sounds = new Map(
  [...filesBlock[1].matchAll(/(\w+)\s*:\s*"([^"]+)"/g)].map((match) => [match[1], match[2]]),
);
for (const [, soundPath] of sounds) {
  assert(existsSync(resolve(root, soundPath)), `registered sound file is missing: ${soundPath}`);
}
for (const call of game.matchAll(/Audio\.play\(([^)]*)\)/g)) {
  for (const match of call[1].matchAll(/"([^"]+)"/g)) {
    assert(sounds.has(match[1]), `Audio.play references unregistered sound: ${match[1]}`);
  }
}

const controls = [
  {
    name: "Tab",
    readme: /\*\*Tab\*\*/,
    help: /<kbd>Tab<\/kbd>/,
    implementation: /e\.key === "Tab"\) cycleEnzyme\(\)/,
  },
];

for (const control of controls) {
  assert(control.readme.test(readme), `${control.name} is missing from README controls`);
  assert(control.help.test(help), `${control.name} is missing from in-game help`);
  assert(control.implementation.test(game), `${control.name} has no matching keyboard handler`);
}

const scoreRowStart = game.indexOf('el.scoresList.querySelectorAll("tr.srow")');
const scoreRowEnd = game.indexOf("// ------------------------------------------------------------------ circos", scoreRowStart);
assert(scoreRowStart >= 0 && scoreRowEnd > scoreRowStart, "score-row bindings are missing");
const scoreRowBindings = game.slice(scoreRowStart, scoreRowEnd);
assert.match(scoreRowBindings, /addEventListener\("click"[^\n]*openScoreDetail/,
  "high-score rows must still open the detailed run view");
assert.doesNotMatch(scoreRowBindings, /mouseenter|mousemove|mouseleave|showCircos|positionCircos|hideCircos/,
  "the main high-score table must not show a Circos map on hover");
assert.match(game, /if \(el\.detailCircos\) \{[\s\S]*?renderCircos\([^\n]*rec\.upgrades/,
  "the detailed run view must retain its Circos genome map");

const tutorialStart = game.indexOf("const TUT_STEPS = [");
const tutorialEnd = game.indexOf("function startTutorial()", tutorialStart);
assert(tutorialStart >= 0 && tutorialEnd > tutorialStart, "interactive tutorial steps are missing");
const tutorial = game.slice(tutorialStart, tutorialEnd);
assert.equal((tutorial.match(/\n    \{ capDesktop:/g) || []).length, 7,
  "the interactive tutorial must retain the revised seven-step sequence");
assert.equal((tutorial.match(/\n      capTouch:/g) || []).length, 7,
  "every tutorial step must have touch-specific explanatory copy");
assert.equal((tutorial.match(/\n      goalDesktop:/g) || []).length, 7);
assert.equal((tutorial.match(/\n      goalTouch:/g) || []).length, 7,
  "every tutorial step must name only the controls available on that device");
assert.doesNotMatch(tutorial, /tap\/swipe|— or tap|or tap\/swipe/,
  "desktop and touch controls must not be combined into one tutorial instruction");
assert.doesNotMatch(tutorial, /Get infected|Red<\/b> phages can infect/,
  "the standalone red-phage infection event must not remain in the seven-step tutorial");
const tutorialPalette = {
  "c-lip": "#efd98a", "c-pro": "#ef8b3c", "c-carb": "#6fa8ff", "c-gold": "#ffd24a",
  "c-crispr": "#c39bff", "c-ab": "#f05ad0", "c-vir": "#8bf06a", "c-prot": "#ff9ec0",
};
for (const [className, color] of Object.entries(tutorialPalette))
  assert.match(help, new RegExp(`#demoCap \\.${className} \\{ color: ${color}; \\}`),
    `${className} tutorial labels must match their gene-bar or world-object color`);
assert.match(game, /abilCrispr[^\n]*setProperty\("--gc", "#c39bff"\)/,
  "the CRISPR bar locus must use the audited violet color");
assert.match(game, /enzTox[^\n]*setProperty\("--gc", "#f05ad0"\)/,
  "the antibiotic bar locus must use the audited magenta color");
assert.match(game, /key: "lipid"[^\n]*color: "#efd98a"/,
  "lipid labels must match the lipase bar locus and lipid blocks");
assert.match(game, /key: "protein"[^\n]*color: "#ef8b3c"/,
  "protein labels must match the protease bar locus and protein blocks");
assert.match(game, /key: "carb"[^\n]*color: "#6fa8ff"/,
  "carbohydrate labels must match the carbohydrase bar locus and carbohydrate blocks");
assert.match(game, /PROTIST_COLOR = "#ff9ec0", VIRUS_COLOR = "#8bf06a"[^\n]*CRISPR_COLOR = "#c39bff", TOXIN_COLOR = "#f05ad0"/,
  "world objects and non-enzyme gene loci must retain the audited semantic palette");
assert.match(tutorial, /class='c-crispr'>CRISPR<\/b>/,
  "CRISPR tutorial labels must use the violet gene-bar color class");
assert.doesNotMatch(tutorial, /style='color:#[0-9a-fA-F]+'/,
  "tutorial biological colors must use the audited semantic palette rather than inline values");
assert.match(tutorial, /goalDesktop: "Approach the particle and press <b>Space<\/b>/,
  "the digestion step must tell the player to approach rather than face the particle");
assert.match(tutorial, /goalTouch: "Approach with the <b>joystick<\/b>, then tap the large <b>enzyme button<\/b>/,
  "the touch digestion step must identify the joystick and enzyme button directly");
assert.match(tutorial,
  /avoid getting eaten for <b>4 seconds<\/b>[\s\S]*?tut\.surviveT = 0[\s\S]*?pr\.tutorialGrace <= 0 && \(pr\.vx !== 0 \|\| pr\.vy !== 0\)\) tut\.surviveT \+= dt;[\s\S]*?done: \(\) => tut\.surviveT >= 4/,
  "the protist challenge must count four seconds of survival only after the grazer starts moving");
const crisprStep = tutorial.indexOf("CRISPR</b> is a bacterial immune system");
const swapStep = tutorial.indexOf("multiple adaptive genes");
const antibioticStep = tutorial.indexOf("chemical weapons");
assert(crisprStep >= 0 && swapStep > crisprStep && antibioticStep > swapStep,
  "antibiotic swap and release must be the final two tutorial events");
assert.match(tutorial.slice(swapStep, antibioticStep),
  /c\.antibiotic = Math\.max\(1,[^\n]*state\.activeEnzyme = 2[\s\S]*?maintain:[\s\S]*?done: \(\) => state\.activeEnzyme === AB/,
  "the swap step must preserve the antibiotic, load carbohydrase, and wait for antibiotic selection");
assert.match(tutorial.slice(antibioticStep),
  /state\.activeEnzyme = AB[\s\S]*?placeTutorial\(c, -maxR\*0\.7\)[\s\S]*?makePredator\(0, 0, Math\.max\(1, CFG\.toxin\.dose\*0\.9\)[\s\S]*?focusTutorial\(pr, maxR\*0\.7\)[\s\S]*?maintain:[\s\S]*?done: \(\) => !!\(tut\.target && tut\.target\.dead && tut\.target\.toxT > 0\)/,
  "the final step must separate the bacterium and protist, preserve a vulnerable target, and require its antibiotic death");
assert.doesNotMatch(tutorial, /usedAntibiotic/,
  "releasing an antibiotic without killing the protist must not complete the tutorial");
assert.equal((tutorial.match(/pr\.tutorialGrace = TUTORIAL_PROTIST_GRACE/g) || []).length, 3,
  "both protist encounters and a failed survival retry must pause the grazer before it hunts");
assert.match(game,
  /const tutorialWaiting = pr\.tutorialGrace > 0;[\s\S]*?const hunting = !tutorialWaiting && pr\.satiated <= 0;[\s\S]*?if \(tutorialWaiting\) \{[\s\S]*?pr\.vx = pr\.vy = 0/,
  "a tutorial grace period must stop movement and grazing without changing normal protists");
assert.match(game, /const st = TUT_STEPS\[tut\.i\];[\s\S]*?st\.maintain\(ctrlCell\(\), dt\)/,
  "tutorial-maintained genes must be restored after the controlled cell is replaced");
assert.match(game, /function tutorialPoint[\s\S]*?isTouch \? r\*0\.20 : -r\*0\.32/,
  "tutorial highlights must stay opposite the top touch caption and bottom desktop caption");
assert.match(game, /function spawnCarbParticle[\s\S]*?placeTutorial\(s\)/,
  "the tutorial's ringed food particle must use upper-dish staging");
const tutorialParticle = game.slice(game.indexOf("function spawnCarbParticle"), game.indexOf("const TUT_STEPS"));
assert.doesNotMatch(tutorialParticle, /s\.vx\s*=|s\.vy\s*=/,
  "the initial tutorial particle must retain its natural drift instead of lingering in place");
assert.doesNotMatch(tutorial, /demo\.focus = (?:ph|pr)/,
  "ringed tutorial phages and protists must use upper-dish staging rather than raw spawn positions");
assert.match(game,
  /function showTutorialComplete\(\)[\s\S]*?completeT = 5[\s\S]*?Congratulations![\s\S]*?Just watch[\s\S]*?Enter the real world/,
  "finishing step seven must show a brief congratulations page before entering the real world");
assert.match(game, /if \(tut\.complete\) \{ start\(\); return; \}[\s\S]*?showTutorialComplete\(\)/,
  "Enter the real world must start a fresh playable game");
assert.match(game, /function tutPrev\(\) \{ if \(tut && tut\.complete\) finishTutorial\(\)/,
  "Just watch must open the autonomous simulation");
assert.match(game, /if \(tut\.complete\) \{[\s\S]*?tut\.completeT -= dt;[\s\S]*?if \(tut\.completeT <= 0\) finishTutorial\(\)/,
  "the completion page must default to the autonomous simulation after five seconds");
assert.match(game, /const cap = isTouch \? st\.capTouch : st\.capDesktop;[\s\S]*?const goal = isTouch \? st\.goalTouch : st\.goalDesktop/,
  "tutorial rendering must switch the full instruction set with the active input mode");
assert.match(game, /document\.body\.classList\.add\("tutorial-active"\)[\s\S]*?document\.body\.classList\.remove\("tutorial-active"\)/,
  "the touch tutorial layout must be scoped to the interactive lesson");
assert.match(help, /body\.touch\.tutorial-active #demoCap\.tut:not\(\.complete\) \{[\s\S]*?position: absolute; top: 6px; bottom: auto/,
  "touch tutorial instructions must be anchored at the top of the stage, not over the control deck");
assert.match(help, /body\.touch\.tutorial-active #hud \{ padding: var\(--tutorial-caption-space\)/,
  "the touch health row must reserve space below the top tutorial instructions");
assert.match(help, /body\.touch\.tutorial-active \.topline \.stats-inline,[\s\S]*?display: none/,
  "nonessential colony statistics must get out of the compact touch tutorial header");

assert.match(game, /if \(!pool\.length\) \{[\s\S]*?state\.pendingDrift = Math\.min\(8/,
  "a gold-phage mutation must be deferred when the founder has no other cell yet");
assert.match(game, /if \(!u\) \{ gain = true; u = grantRandomUpgrade\(c\); \}/,
  "an impossible gene-loss roll must fall back to a real mutation");
assert.match(game, /function applyPendingDrift\(\)[\s\S]*?driftAnotherCell\(source, false\)[\s\S]*?applyPendingDrift\(\);/,
  "the deferred mutation must be applied once a sister cell exists");
assert.match(game, /function rememberLineage\(c\)[\s\S]*?entry\.variants = variants\.concat\(\[snapshot\]\)/,
  "distinct genomes that share a chart band must remain distinct phylogenetic terminals");
assert.match(game, /const paths = \[lin\[k\]\]\.concat\([\s\S]*?path\.tree \|\| path\.ups/,
  "the phylogenetic tree must render recorded variants and gene-loss ancestry");
assert.doesNotMatch(game, /DEMO_BEATS|nextDemoBeat/,
  "the obsolete scripted tutorial must not play behind the main menu");
assert.match(game,
  /function startDemo\(\) \{[\s\S]*?newGame\(true\)[\s\S]*?idle: true[\s\S]*?openDemoWorld\(\)[\s\S]*?demoCap\) el\.demoCap\.classList\.add\("hidden"\)/,
  "the main menu must start directly in an uncaptioned autonomous ocean simulation");
assert.match(help,
  /<p class="lede"><b>One tiny cell\. One living ocean\.<\/b> Chase food, capture new genes, evade hungry protists/,
  "the main menu must lead with a concise, player-first gameplay hook");
assert.doesNotMatch(help, /A drop of seawater is a world/,
  "the old explanatory main-menu copy must not return");

console.log(`Static contracts OK: ${sounds.size} sounds and ${controls.length} control${controls.length === 1 ? "" : "s"} checked.`);
