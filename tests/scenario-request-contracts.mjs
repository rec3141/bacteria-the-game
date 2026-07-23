import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Guards the account-free path for turning a paper into a level (#28). A player pastes a DOI in the
// game; scenario-request.php appends it to scenario-queue.json; a workflow in the scenarios repo
// polls that file and builds the level. Nothing here talks to GitHub and no credential lives on our
// server, which is what lets the whole thing deploy with the ordinary deploy.sh.
//
// Every failure mode this file guards is SILENT — no error anywhere, the submission simply never
// becomes a level — which is exactly why they need pinning.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(resolve(root, path), "utf8");
const php = read("scenario-request.php");
const game = read("game.js");
const html = read("index.html");
const htaccess = read(".htaccess");
const deploy = read("deploy.sh");
const gitignore = read(".gitignore");

// ---- nobody is sent to GitHub any more -----------------------------------------------------------
// The point of the exercise: a player who wants their paper as a level must not be asked to create
// an account first.
assert.ok(!/github\.com\/[^"']*issues\/new/.test(html),
  "index.html must not hand players off to GitHub's new-issue form");
assert.ok(!/submitDoiLink/.test(html + game), "the old GitHub link should be gone entirely");
assert.match(html, /id="submitDoiBtn"/, "the title screen needs the in-game submit button");
assert.match(html, /id="doiSubmit"/, "the submission screen must exist");
for (const id of ["doiInput", "doiSend", "doiCancel", "doiStatus", "doiPlayBtn"]) {
  assert.ok(html.includes(`id="${id}"`), `the submission screen is missing #${id}`);
  assert.match(game, new RegExp(`${id}:\\s*document\\.getElementById`), `game.js never looks up #${id}`);
}
assert.match(game, /el\.submitDoiBtn\.addEventListener\("click", showDoiSubmit\)/,
  "the submit button must open the in-game form");

// ---- the game posts to our own endpoint, not to GitHub -------------------------------------------
assert.match(game, /SCENARIO_REQUEST_URL\s*=\s*"scenario-request\.php"/,
  "submissions must go to our own endpoint");
assert.ok(!/api\.github\.com|repository_dispatch/.test(game + php),
  "neither the game nor the endpoint may call GitHub — the poller pulls, we never push");

// ---- the game must NOT derive the scenario id itself ---------------------------------------------
// It polls for <id>.json to tell the player their level is ready. The id comes back from the server,
// so there is exactly one place that derives it and the poll cannot end up watching for a filename
// the generator will never write.
assert.match(game, /if \(body\.id\) pollForScenario\(body\.id/,
  "the poll must use the id the server returned, not one derived in the client");

// ---- the endpoint's id derivation must mirror scripts/doi-id.mjs in the scenarios repo -----------
// Same rule, three languages. If PHP's version drifts, the player's "is it ready?" poll silently
// watches a filename that never appears while the level itself builds fine.
{
  const slug = php.match(/function sc_slug\([\s\S]*?\n\}/);
  assert.ok(slug, "sc_slug must exist");
  const body = slug[0];
  // the JS is: s.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"").slice(0,60) || "scenario"
  assert.match(body, /strtolower/, "sc_slug must lowercase first");
  assert.match(body, /\[\^a-z0-9\]\+/, "sc_slug must collapse non-alphanumerics to a dash");
  assert.match(body, /\^-\+\|-\+\$/, "sc_slug must trim leading/trailing dashes");
  assert.match(body, /substr\(\$s, 0, 60\)/, "sc_slug must apply the same 60-char cap");
  assert.match(body, /'scenario'/, "sc_slug must fall back to 'scenario' when empty");
  // the double slug is load-bearing: the outer pass re-applies the cap once "doi-" is prefixed
  assert.match(php, /sc_slug\('doi-' \. sc_slug\(\$doi\)\)/,
    "the id must be slug('doi-' + slug(doi)), matching doiScenarioId()");
}

// ---- DOI validation agrees on both sides ---------------------------------------------------------
{
  assert.match(php, /#\^10\\\.\[0-9\]\{4,9\}\/\\S\+\$#/, "PHP must validate the DOI shape");
  assert.match(game, /DOI_RE = \/\^10\\\.\\d\{4,9\}\\\/\\S\+\$\//, "the client must validate the same shape");
  // both strip a doi.org prefix, so a pasted URL works and yields the same id
  assert.match(php, /https\?:\/\/\(dx\\\.\)\?doi\\\.org/, "PHP must accept a pasted doi.org URL");
  assert.match(game, /https\?:\\\/\\\/\(dx\\\.\)\?doi\\\.org/, "the client must accept a pasted doi.org URL");
  // ASCII-only is what makes PHP's byte-based strtolower safe to compare against JS toLowerCase
  assert.match(php, /\[\\x21-\\x7E\]\+/, "PHP must reject non-ASCII DOIs so the id cannot drift from the JS one");
}

// ---- the queue must stay readable, the rate-limit file must not ----------------------------------
// The sharpest edge in the whole design: block scenario-queue.json by reflex, the way feedback.json
// is blocked, and every player submission stops being built with no error anywhere.
{
  const blocked = [...htaccess.matchAll(/<Files "([^"]+)">([\s\S]*?)<\/Files>/g)]
    .filter(([, , block]) => /Require all denied|Deny from all/.test(block))
    .map(([, name]) => name);
  assert.ok(blocked.includes("scenario-ratelimit.json"),
    "scenario-ratelimit.json holds hashed addresses and must be blocked from the web");
  assert.ok(!blocked.includes("scenario-queue.json"),
    "scenario-queue.json MUST stay web-readable — GitHub Actions fetches it to find new submissions");
  assert.match(htaccess, /<Files "scenario-queue\.json">[\s\S]*?no-store/,
    "the queue must not be cached, or a submission sits invisible until the cache expires");
}

// ---- the endpoint keeps addresses out of the public file ------------------------------------------
assert.match(php, /hash\('sha256'/, "rate limiting must key on a hash, never a stored raw address");
{
  const queueWrite = php.match(/\$out = \['schema' => 'bacteria-scenario-queue'[\s\S]*?\];/);
  assert.ok(queueWrite, "the queue write must exist");
  assert.ok(!/REMOTE_ADDR|\$ip|\$key/.test(queueWrite[0]),
    "the public queue must carry only DOIs and timestamps");
}

// ---- it actually ships, and its stores exist on the server -----------------------------------------
assert.match(deploy, /FILES=\([\s\S]*?scenario-request\.php/, "deploy.sh must ship the endpoint");
assert.match(deploy, /^for f in .*scenario-request\.php/m, "deploy.sh must drift-check the endpoint too");
assert.match(deploy, /scenario-queue\.json/, "deploy.sh must create the queue store");
for (const f of ["scenario-queue.json", "scenario-ratelimit.json"]) {
  assert.ok(gitignore.includes(f), `${f} is runtime data and must be gitignored`);
}

console.log("✓ scenario-request contracts: account-free path, id agreement, queue reachability");
