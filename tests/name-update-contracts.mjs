import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const game = readFileSync(resolve(root, "game.js"), "utf8");
const php = readFileSync(resolve(root, "scores.php"), "utf8");

assert.match(game, /NAME_UPDATE_DELAY = 500/, "remote name edits must be debounced");
assert.match(game, /pendingNameUpdate = \{ op: "name", id: rec\.id, name:/, "name edits must use the small payload");
assert.match(game, /scoreWriteQueue = scoreWriteQueue/, "score writes must share one serialization queue");
assert.match(game, /addEventListener\("change", flushNameUpdate\)/, "the final field value must flush on change");
assert.doesNotMatch(
  game.match(/function setPlayerName[\s\S]*?\n  \}/)?.[0] || "",
  /submitScore\(/,
  "typing a name must not resubmit the full run",
);

assert.match(php, /\$nameOnly = score_value\(\$submitted, 'op'/, "backend must recognize name-only updates");
assert.match(php, /\$row\['name'\] = \$name/, "name-only updates must mutate the name field");
assert.match(php, /run not found/, "name-only updates must not create partial leaderboard rows");

console.log("Name update contracts OK: debounced, name-only, and serialized.");
