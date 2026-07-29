// Protists must keep hunting. This is a starvation-of-behaviour bug, which nothing errors on.
//
// `hunting` is `pr.satiated <= 0`, and satiated means "just ate, resting". A failed bite at a diatom
// was setting it. In a dense bloom a grazer is in contact with a chain most frames and fails ~90% of
// bites, so satiated never reached zero: hunting stayed false, and the protists chased nothing and ate
// nothing -- not diatoms, not bacteria. Raising count, chaseSpeed and senseRange changed nothing,
// because none of those are read while hunting is false. The whole predator layer was inert and the
// only symptom was that nothing happened.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const game = readFileSync(new URL("../game.js", import.meta.url), "utf8");
const pred = game.slice(game.indexOf("function updatePredators"), game.indexOf("function updatePhages"));
assert.ok(pred.length > 500, "updatePredators must be extractable");

// ---- a failed bite must not touch `satiated` -------------------------------------------------------
const bite = pred.slice(pred.indexOf("GRAZING A DIATOM"), pred.indexOf("protists also graze free-floating"));
assert.ok(bite.length > 200, "the diatom grazing block must be extractable");
assert.doesNotMatch(bite, /Math\.random\(\)[^\n]*\{ pr\.satiated/,
  "a FAILED bite must never set satiated — satiated gates hunting, so that is a deadlock");
assert.match(bite, /if \(pr\.grazeCd > 0\) break;/,
  "attempts are limited by their own cooldown, not by suppressing the hunt");
assert.match(bite, /pr\.grazeCd = CFG\.diatom\.grazeEvery;/, "...which is set on every attempt");
assert.match(pred, /if \(pr\.grazeCd > 0\) pr\.grazeCd -= dt;/, "and that cooldown has to actually tick down");
assert.match(game, /grazeCd: 0, dead: false \};/, "a new protist starts able to bite");

// ---- and the deadlock itself, simulated ------------------------------------------------------------
// Model the two candidate rules against continuous diatom contact and check whether a grazer is still
// able to hunt. This is the shape of the bug, independent of the rest of the predator loop.
{
  const satiatedTime = 1.0, dt = 1 / 60, seconds = 20;
  const run = (failSetsSatiated) => {
    let satiated = 0, grazeCd = 0, huntingFrames = 0, frames = 0;
    for (let t = 0; t < seconds; t += dt) {
      frames++;
      if (satiated > 0) satiated -= dt;
      if (grazeCd > 0) grazeCd -= dt;
      const hunting = satiated <= 0;
      if (hunting) huntingFrames++;
      if (!hunting) continue;
      if (failSetsSatiated) {                    // the shipped bug
        if (Math.random() >= 0.105) satiated = satiatedTime * 0.3;
      } else {                                   // the fix
        if (grazeCd > 0) continue;
        grazeCd = 0.5;
        if (Math.random() >= 0.105) continue;
      }
    }
    return huntingFrames / frames;
  };
  const broken = run(true), fixed = run(false);
  assert.ok(broken < 0.25,
    `the old rule must demonstrably starve the hunt, else this proves nothing (hunting ${(100*broken).toFixed(0)}% of frames)`);
  assert.ok(fixed > 0.95,
    `with the fix a grazer in a bloom must still be hunting nearly always (got ${(100*fixed).toFixed(0)}%)`);
  console.log(`  (old rule left protists hunting ${(100*broken).toFixed(0)}% of frames; now ${(100*fixed).toFixed(0)}%)`);
}

// ---- bacteria stay the primary prey ----------------------------------------------------------------
// A bloom puts a diatom node nearer than any cell almost everywhere, so ranking them together would
// leave grazers permanently distracted by algae and the player never hunted.
assert.match(pred, /if \(hunting && !target\) for \(const dt2 of diatoms\)/,
  "diatoms are considered only when no cell is in range — otherwise the player is never hunted");
const cellScan = pred.indexOf("for (const c of sensed)"), diatomScan = pred.indexOf("for (const dt2 of diatoms)");
assert.ok(cellScan >= 0 && diatomScan > cellScan, "cells must be ranked before diatoms are considered at all");

console.log("Predator grazing contracts OK: a failed bite costs an attempt, not the hunt.");
