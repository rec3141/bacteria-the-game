import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const game = readFileSync(new URL("../game.js", import.meta.url), "utf8");
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");

assert.match(game, /eps: \{ lifePerLevel: 4,[^}]*maxCount: 240/,
  "EPS starts at four seconds per expression level and remains globally capped");
assert.match(html, /id="enzEps">EPS<[\s\S]*id="abilTwitch">twitching</,
  "both new genes are visible in the genome bar");

const grant = game.slice(game.indexOf("function grantRandomUpgrade_(c)"), game.indexOf("function makeCell"));
assert.match(grant, /!c\.twitching[\s\S]*pool\.push\("twitching"\)/,
  "twitching motility is a one-time gold-phage upgrade");
assert.match(grant, /pool\.push\("eps"\)[\s\S]*const acquired = c\.eps === 0; c\.eps\+\+/,
  "EPS is a repeatable, countable gold-phage upgrade");
assert.match(game, /pick === "eps"\) \{ c\.eps--; locus = "Eps"/,
  "gene loss removes one EPS expression level at a time");
assert.match(game, /function upgradeTier\(c\)[\s\S]*\+ \(c\.eps \|\| 0\)/,
  "every EPS level contributes to lineage adaptation tier");
assert.match(game, /function genomeOf\(c\)[\s\S]*c\.eps \|\| 0/,
  "genetic distance preserves the countable EPS locus");
assert.match(game, /for \(let k = 1; k <= \(c\.eps \|\| 0\); k\+\+\) push\("EPS " \+ k, "Eps" \+ k/,
  "synthetic lineage histories contain one event per EPS level");

const divide = game.slice(game.indexOf("function divide(c)"), game.indexOf("function cellStrength"));
assert.match(divide, /d1\.twitching = d2\.twitching = !!c\.twitching/);
assert.match(divide, /d1\.eps = d2\.eps = c\.eps \|\| 0/,
  "both surface adaptations are inherited at division");

const movement = game.slice(game.indexOf("function updateCell(c, dt)"), game.indexOf("function nearestOrganicSub"));
assert.match(movement, /if \(!c\.twitching\) for \(const p of substrates\)/,
  "twitching cells bypass food-particle collision broad phase");
assert.match(movement, /collideRod\(c, !!c\.twitching\)/,
  "twitching skips particles in narrow-phase collision too");
assert.match(game, /twitchSpeedScale: 0\.5/,
  "twitching self-propulsion starts at half ordinary speed");
assert.match(movement, /const motilityScale = carrier \? CFG\.cell\.twitchSpeedScale : 1/,
  "half speed activates only when a particle supports the twitching cell");
assert.match(movement, /swimSpeed\(Math\.min\(1, len\), visc\)\*motilityScale/,
  "surface-only speed scaling applies to the controlled cell");
assert.match(movement, /vmax = CFG\.cell\.maxSpeed\/Math\.sqrt\(visc\)\*swimScale\(\)\*motilityScale/,
  "the velocity cap cannot preserve pre-upgrade flagellar speed");
const autonomous = game.slice(game.indexOf("function autonomousMove("), game.indexOf("function updatePredators"));
assert.match(autonomous, /function autonomousMove\(c, dt, motilityScale = 1\)[\s\S]*swimSpeed\(fedF, visc\)\*motilityScale/,
  "surface-only speed scaling applies to autonomous descendants");
assert.match(movement, /const carrier = particleUnderCell\(c\)/);
assert.match(movement, /moveVx = c\.vx \+ \(carrier \? carrier\.vx : 0\), moveVy = c\.vy \+ \(carrier \? carrier\.vy : 0\)/,
  "a surface-attached twitching cell receives its particle's drift separately from propulsion");

const solidAtSource = game.match(/function solidAt\(p, gi, gj\) \{[\s\S]*?\n  \}/)?.[0];
const solidAtWorldSource = game.match(/function solidAtWorld\(p, wx, wy\) \{[\s\S]*?\n  \}/)?.[0];
const carrierSource = game.match(/function particleUnderCell\(c\) \{[\s\S]*?\n  \}/)?.[0];
assert.ok(solidAtSource && solidAtWorldSource && carrierSource, "production surface-carrier lookup is present");
const support = { x: 100, y: 100, vx: 3, vy: -2, half: 15, cs: 10, n: 3,
  organic: 9, grid: new Float32Array(9).fill(1) };
const particleUnderCell = new Function("substrates", "cellPolesLocal", "cellHalfLen", "dx", "dy", "toroDist2",
  `${solidAtSource}\n${solidAtWorldSource}\n${carrierSource}\nreturn particleUnderCell;`)(
    [support], () => [6, 0, -6, 0], () => 8, (a, b) => a - b, (a, b) => a - b,
    (x1, y1, x2, y2) => (x1-x2)**2 + (y1-y2)**2,
  );
assert.equal(particleUnderCell({ x: 100, y: 100, twitching: true, cyst: false }), support,
  "a twitching cell detects the solid particle beneath its rod");
assert.equal(particleUnderCell({ x: 100, y: 100, twitching: false, cyst: false }), null,
  "ordinary swimming cells do not attach to particles");
assert.equal(particleUnderCell({ x: 100, y: 100, twitching: true, cyst: true }), null,
  "dormant cysts do not actively attach by twitching");

const drawCell = game.slice(game.indexOf("function drawCell(c)"), game.indexOf("function drawPredator"));
assert.match(drawCell, /for \(let i = 0; i <= 14; i\+\+\)[\s\S]*?ctx\.stroke\(\);\n    if \(c\.twitching\)/,
  "twitching cells retain the ordinary flagellum as well as their pili");

const drawEps = game.slice(game.indexOf("function drawEps(z)"), game.indexOf("function drawNutrient"));
assert.match(game, /const EPS_RENDER_PROFILE = \[[^\]]{60,}\][\s\S]*EPS_OUTLINE_PATH\.quadraticCurveTo/,
  "EPS has a rounded, tortuous bouba silhouette with alternating lobes and valleys");
assert.doesNotMatch(drawEps, /lineTo\(/,
  "EPS has no sharp-sided block outline");
assert.match(game, /const EPS_NETWORK_NODES = \[[\s\S]*const EPS_NETWORK_LINKS = \[[\s\S]*ctx\.clip\(EPS_OUTLINE_PATH\)/,
  "EPS renders a clipped filament network with stable junction nodes");
assert.match(drawEps, /rgba\(105,88,43,0\.52\)[\s\S]*ctx\.stroke\(EPS_NETWORK_PATH\)[\s\S]*rgba\(255,241,190,0\.78\)[\s\S]*ctx\.stroke\(EPS_NETWORK_PATH\)/,
  "EPS fibres reuse one path for their under-strand and bright core");
const epsProfileText = game.match(/const EPS_RENDER_PROFILE = \[([\s\S]*?)\];/)?.[1];
assert.ok(epsProfileText, "EPS radial profile is present");
const epsProfile = epsProfileText.split(",").map(Number);
const epsPoints = epsProfile.map((radius, i) => {
  const angle = i/epsProfile.length*Math.PI*2;
  return [Math.cos(angle)*radius, Math.sin(angle)*radius];
});
const epsTurns = epsPoints.map((point, i) => {
  const prev = epsPoints[(i + epsPoints.length - 1) % epsPoints.length];
  const next = epsPoints[(i + 1) % epsPoints.length];
  return Math.sign((point[0]-prev[0])*(next[1]-point[1]) - (point[1]-prev[1])*(next[0]-point[0]));
});
assert.ok(epsTurns.includes(1) && epsTurns.includes(-1),
  "EPS profile contains both convex lobes and concave valleys");

const actions = game.slice(game.indexOf("const AB = 3, EPS = 4"), game.indexOf("function lineageReps"));
assert.match(actions, /if \(c\.eps\) o\.push\(EPS\)/);
assert.match(actions, /life = E\.lifePerLevel\*level[\s\S]*life, maxLife: life, level/,
  "released EPS lifetime is four seconds times its expression level");
assert.match(actions, /state\.activeEnzyme === EPS[\s\S]*releaseEps\(c\)/,
  "EPS is selected and released through the ordinary deployable control");

const releaseEpsSource = game.match(/function releaseEps\(c, angle = c\.angle\) \{[\s\S]*?\n  \}/)?.[0];
assert.ok(releaseEpsSource, "production EPS release function is present");
const released = [];
const releaseEps = new Function("CFG", "epsBlocks", "cellHalfLen", "wrapX", "wrapY",
  `${releaseEpsSource}\nreturn releaseEps;`)(
    { eps: { lifePerLevel: 4, radius: 24, cost: 8, maxCount: 240 } }, released,
    () => 10, (v) => v, (v) => v,
  );
const producer = { x: 100, y: 100, angle: 0, energy: 100, eps: 3 };
assert.equal(releaseEps(producer), true);
assert.equal(released[0].life, 12, "EPS level 3 lasts 12 seconds");
assert.equal(released[0].level, 3, "the released block records its expression level");
assert.equal(producer.energy, 92, "EPS release still charges its ordinary energy cost");

assert.match(game, /el\.enzEps\.innerHTML = "EPS" \+ \(owned \? amp\(lvl\) : ""\)/,
  "the genome chip displays the countable EPS level");
assert.match(game, /for \(const c of cells\) c\.eps = Math\.max\(0, Math\.round\(Number\(c\.eps\) \|\| 0\)\)/,
  "old boolean EPS checkpoint values migrate to numeric level 1");

const enzymeUpdate = game.slice(game.indexOf("function updateEnzymes(dt)"), game.indexOf("function updateToxins(dt)"));
assert.doesNotMatch(enzymeUpdate, /epsBlocks|updateEps/,
  "enzymes cannot degrade EPS blocks");
const epsUpdate = game.slice(game.indexOf("function updateEps(dt)"), game.indexOf("function startDissolve"));
assert.match(epsUpdate, /z\.life -= dt[\s\S]*epsBlocks = epsBlocks\.filter\(\(z\) => z\.life > 0\)/,
  "EPS disappears only when its lifetime expires");

assert.match(game, /collideRod\(c, skipParticles\)[\s\S]*collideCircle\(probe, CFG\.cell\.radius, skipParticles\)/,
  "EPS collision applies to bacteria even when particle collision is skipped");
assert.match(game, /collideCircle\(pr, pr\.r\)/,
  "EPS collision applies to protists");
assert.match(game, /collideEpsCircle\(ph, ph\.r\)/,
  "EPS collision applies to viruses");

// Execute the production EPS collision function against a local grid fixture. The object begins
// inside a radius-24 block, moving further inward; it must be pushed to the edge and lose that
// inward velocity.
const collisionSource = game.match(/function collideEpsCircle\(obj, radius\) \{[\s\S]*?\n  \}/)?.[0];
assert.ok(collisionSource, "production EPS collision function is present");
const collideEpsCircle = new Function("epsSpace", "CFG", "epsCandidates", "dx", "dy", "wrapX", "wrapY",
  `${collisionSource}\nreturn collideEpsCircle;`)(
    { query: () => [{ x: 100, y: 100, r: 24, life: 10, angle: 0 }] },
    { eps: { radius: 24 } }, [], (a, b) => a - b, (a, b) => a - b, (v) => v, (v) => v,
  );
const object = { x: 110, y: 100, vx: -10, vy: 0 };
collideEpsCircle(object, 5);
assert.equal(object.x, 129, "the object is pushed to the EPS boundary");
assert.equal(object.vx, 0, "inward motion is removed at the EPS boundary");

console.log("Surface-upgrade contracts OK: twitching traversal and temporary EPS exclusion checked.");
