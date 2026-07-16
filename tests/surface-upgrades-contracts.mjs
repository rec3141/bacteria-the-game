import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const game = readFileSync(new URL("../game.js", import.meta.url), "utf8");
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");

assert.match(game, /eps: \{ life: 30,[^}]*maxCount: 240/,
  "EPS starts as a 30-second, globally capped barrier");
assert.match(html, /id="enzEps">EPS<[\s\S]*id="abilTwitch">twitching</,
  "both new genes are visible in the genome bar");

const grant = game.slice(game.indexOf("function grantRandomUpgrade_(c)"), game.indexOf("function makeCell"));
assert.match(grant, /!c\.twitching[\s\S]*pool\.push\("twitching"\)/,
  "twitching motility is a one-time gold-phage upgrade");
assert.match(grant, /!c\.eps[\s\S]*pool\.push\("eps"\)/,
  "EPS production is a one-time gold-phage upgrade");

const divide = game.slice(game.indexOf("function divide(c)"), game.indexOf("function cellStrength"));
assert.match(divide, /d1\.twitching = d2\.twitching = !!c\.twitching/);
assert.match(divide, /d1\.eps = d2\.eps = !!c\.eps/,
  "both surface adaptations are inherited at division");

const movement = game.slice(game.indexOf("function updateCell(c, dt)"), game.indexOf("function nearestOrganicSub"));
assert.match(movement, /if \(!c\.twitching\) for \(const p of substrates\)/,
  "twitching cells bypass food-particle collision broad phase");
assert.match(movement, /collideRod\(c, !!c\.twitching\)/,
  "twitching skips particles in narrow-phase collision too");

const actions = game.slice(game.indexOf("const AB = 3, EPS = 4"), game.indexOf("function lineageReps"));
assert.match(actions, /if \(c\.eps\) o\.push\(EPS\)/);
assert.match(actions, /epsBlocks\.push\(\{[\s\S]*life: E\.life/);
assert.match(actions, /state\.activeEnzyme === EPS[\s\S]*releaseEps\(c\)/,
  "EPS is selected and released through the ordinary deployable control");

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
