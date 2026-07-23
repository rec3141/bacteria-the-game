import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const game = readFileSync(new URL("../game.js", import.meta.url), "utf8");
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");

const codecSource = game.match(/function checkpointSubstrate\(p\) \{[\s\S]*?\n  \}/)?.[0];
assert.ok(codecSource, "the production substrate checkpoint codec is present");
const checkpointSubstrate = new Function(`${codecSource}\nreturn checkpointSubstrate;`)();

const source = {
  kind: "chitin", n: 2, grid: new Float32Array([1, 0, 0.5, 1]),
  gtype: new Uint8Array([2, 0, 2, 1]), dissolveOrder: [3, 1],
  cache: { nodeName: "CANVAS" }, depthBuf: new Int16Array(4), spec: { shape: "shard" },
};
const encoded = checkpointSubstrate(source);
assert.equal(encoded.grid, source.grid, "typed particle grids are retained for structured cloning");
assert.equal(encoded.gtype, source.gtype);
assert.deepEqual(encoded.dissolveOrder, [3, 1]);
assert.ok(!("cache" in encoded), "canvas caches are not serialized");
assert.ok(!("depthBuf" in encoded), "derived shading buffers are not serialized");
assert.ok(!("spec" in encoded), "static particle catalog entries are not duplicated");
const cloned = structuredClone(encoded);
assert.ok(cloned.grid instanceof Float32Array && cloned.gtype instanceof Uint8Array,
  "the checkpoint round trip preserves typed particle grids");

assert.match(html, /id="savedContinueBtn"[\s\S]*?id="savedContinueTitle"[\s\S]*?id="savedContinueMeta"/,
  "the main menu exposes checkpoint summary and continuation UI");
assert.match(html, /id="saveStatus"[^>]*aria-live="polite"/,
  "day completion reports asynchronous save status accessibly");
assert.match(game, /const CHECKPOINT_SCHEMA = 1/);
assert.match(game, /indexedDB\.open\(CHECKPOINT_DB, 1\)/,
  "large checkpoints use versioned IndexedDB storage");
assert.doesNotMatch(game, /localStorage\.setItem\([^\n]*checkpoint/i,
  "large world checkpoints must not be forced into localStorage");

const snapshot = game.slice(game.indexOf("function makeCheckpoint()"), game.indexOf("function normalizedCheckpointConfig"));
for (const field of ["cells", "substrates", "enzymes", "toxins", "eps", "nutrients", "predators", "phages", "particles"])
  assert.match(snapshot, new RegExp(`\\b${field}\\b`), `checkpoint snapshot includes ${field}`);
assert.match(snapshot, /cfg: JSON\.parse\(JSON\.stringify\(CFG\)\), state/,
  "checkpoints carry the exact simulation settings and runtime state");
assert.ok(snapshot.indexOf("structuredClone(raw)") < game.indexOf("writeCheckpoint(snapshot)"),
  "the completed-day world is detached before asynchronous storage can race with Continue");

const writer = game.slice(game.indexOf("async function writeCheckpoint"), game.indexOf("function setCheckpointStatus"));
assert.match(writer, /transaction\(CHECKPOINT_STORE, "readwrite"\)/);
assert.match(writer, /CHECKPOINT_PREVIOUS[\s\S]*CHECKPOINT_CURRENT/,
  "one atomic transaction rotates current into the hidden previous generation");
const loader = game.slice(game.indexOf("async function loadBestCheckpoint"), game.indexOf("async function writeCheckpoint"));
assert.match(loader, /validCheckpoint\(current\)[\s\S]*readCheckpointSlot\(CHECKPOINT_PREVIOUS\)[\s\S]*validCheckpoint\(previous\)/,
  "a corrupt current checkpoint falls back to the previous generation");

const restore = game.slice(game.indexOf("function restoreCheckpoint"), game.indexOf("async function resumeSavedGame"));
assert.match(restore, /spec: partSet\[saved\.kind\] \|\| PARTICLES\[saved\.kind\], cache: null, depthBuf: null, dirty: true/,
  "restoration rebuilds particle render caches from the static catalog");
assert.match(restore, /updateDiel\(\); rebuildSpatialIndexes\(\); last = 0/,
  "restoration rebuilds derived environment and spatial indexes without a giant first frame");
assert.match(restore, /epsBlocks = Array\.isArray\(E\.eps\) \? E\.eps : \[\]/,
  "checkpoints from before EPS restore with an empty barrier field");

const over = game.slice(game.indexOf("function gameOver(dayComplete)"), game.indexOf("function setPlayerName"));
assert.match(over, /state\.running = false;[\s\S]*if \(dayComplete\) saveCompletedDay\(\)/,
  "only a stopped, completed day is automatically checkpointed");
const resume = game.slice(game.indexOf("async function resumeSavedGame"), game.indexOf("function controlledCell"));
assert.match(resume, /restoreCheckpoint\(found\.record\);[\s\S]*continueDay\(\)/,
  "loading a completed day begins the following day");
assert.doesNotMatch(resume, /delete|clear|remove\(/,
  "loading does not consume the retry checkpoint");
const start = game.slice(game.indexOf("function start()"), game.indexOf("function continueDay"));
assert.doesNotMatch(start, /writeCheckpoint|deleteCheckpoint|clearCheckpoint|indexedDB/,
  "starting a separate new run leaves the prior completed-day checkpoint intact");

const clearer = game.slice(game.indexOf("async function clearCheckpoints"), game.indexOf("function setCheckpointStatus"));
assert.match(clearer, /delete\(CHECKPOINT_CURRENT\)[\s\S]*delete\(CHECKPOINT_PREVIOUS\)/,
  "discarding a saved run removes both its current checkpoint and fallback");
assert.match(clearer, /checkpointWriteQueue\.catch[\s\S]*then\(\(\) => clearCheckpoints\(\)\)/,
  "checkpoint deletion waits behind any in-flight day-end save");
const endGame = game.slice(game.indexOf("function endGame()"), game.indexOf("const ANNOUNCEMENT_GAP"));
assert.match(endGame, /deleteSavedGame\(\); gameOver\(\)/,
  "the player's explicit End Game action discards their saved run");

console.log("Saved-game contracts OK: exact snapshots, retry fallback, and explicit End Game deletion checked.");
