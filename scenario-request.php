<?php
// Turn a player's paper into a playable level — without a GitHub account.
//
//   POST scenario-request.php  {doi}  -> appends one DOI to scenario-queue.json
//
// The old path sent players to GitHub's new-issue form, which asks someone who just wanted to see
// their favourite paper as a level to go create an account first. That is the same trade feedback.php
// already refused to make for bug reports, and the answer here is the same: a JSON file on disk, no
// accounts, no third party.
//
// The direction of travel matters. This endpoint does NOT call GitHub — it only appends to a file.
// A workflow in the scenarios repo polls that file every 15 minutes and builds whatever is new, so
// the credential that can write to the repo stays on GitHub where it already lives. Nothing secret
// is stored on this server, nothing has to be installed by hand outside deploy.sh, and there is no
// token here to leak or rotate. Dedup is derived over there from whether the scenario file exists,
// so this side needs no callback and no "done" flag.
//
// scenario-queue.json is deliberately PUBLIC — GitHub Actions has to fetch it, and it holds nothing
// but DOIs and timestamps. Rate-limit state lives in a SEPARATE file that .htaccess blocks, because
// that one keeps (hashed) addresses and those are nobody's business.
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');

$QUEUE = __DIR__ . '/scenario-queue.json';
$RATE  = __DIR__ . '/scenario-ratelimit.json';   // blocked from the web in .htaccess

$MAX_QUEUE      = 200;  // entries kept; oldest dropped past this
$MAX_PER_IP_DAY = 3;    // one enthusiast should not be able to spend the whole day's budget
// The real budget control. Every accepted DOI costs one Anthropic API call over in the scenarios
// repo, and that repo has no way to push back on us — the poller builds what it finds. So the
// ceiling has to be enforced HERE, at the only point where a request can still be refused.
$MAX_PER_DAY    = 20;
$DAY            = 86400;

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
  header('Access-Control-Allow-Methods: POST, OPTIONS');
  header('Access-Control-Allow-Headers: Content-Type');
  exit;
}
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
  http_response_code(405);
  echo json_encode(['error' => 'post only']);
  exit;
}

$raw = file_get_contents('php://input');
// A designed terrain is bigger than a DOI (up to four layers with labels), but still small.
if (strlen($raw) > 8000) { http_response_code(413); echo json_encode(['error' => 'too large']); exit; }
$rec = json_decode($raw, true);
if (!is_array($rec)) { http_response_code(400); echo json_encode(['error' => 'bad json']); exit; }

// A scenario id: lowercase alphanumerics and dashes only. The game polls for this id to tell the
// submitter when their level is ready, so it must be a valid slug and match nothing surprising.
function sc_slug($s) {
  $s = strtolower((string)$s);
  $s = preg_replace('/[^a-z0-9]+/', '-', $s);
  $s = preg_replace('/^-+|-+$/', '', $s);
  $s = substr($s, 0, 60);
  return $s === '' ? 'scenario' : $s;
}

// Clean an untrusted terrain payload, mirroring the terrain rules in game.js's SCENARIO_VALIDATOR.
// Returns a normalised array (only known keys, values rounded and in range) or null if anything is
// off — one bad layer rejects the whole thing, exactly like the game validator.
function sc_clean_terrain($t) {
  if (!is_array($t) || count($t) < 1 || count($t) > 4) return null;
  // reject an associative array masquerading as a list (json_decode turns {} into an array in PHP)
  if (array_keys($t) !== range(0, count($t) - 1)) return null;
  $allowed = ['at', 'thickness', 'color', 'label', 'roughness', 'porosity', 'poreSize', 'featureSize', 'spires', 'spireHeight', 'spireWidth'];
  $num = static function ($v, $lo, $hi) { return is_numeric($v) && $v >= $lo && $v <= $hi; };
  $out = [];
  foreach ($t as $layer) {
    if (!is_array($layer)) return null;
    foreach (array_keys($layer) as $k) { if (!in_array($k, $allowed, true)) return null; }
    if (($layer['at'] ?? null) !== 'top' && ($layer['at'] ?? null) !== 'bottom') return null;
    if (!$num($layer['thickness'] ?? null, 20, 800)) return null;
    $clean = ['at' => $layer['at'], 'thickness' => (int)round($layer['thickness'])];
    if (isset($layer['color'])) {
      if (!preg_match('/^#[0-9a-fA-F]{6}$/', (string)$layer['color'])) return null;
      $clean['color'] = strtolower((string)$layer['color']);
    }
    if (isset($layer['label'])) {
      $lbl = preg_replace('/[\x00-\x1F\x7F<>]/u', '', (string)$layer['label']);
      $clean['label'] = mb_substr(trim($lbl), 0, 40);
    }
    foreach (['roughness', 'porosity', 'spires'] as $f) {
      if (isset($layer[$f])) { if (!$num($layer[$f], 0, 1)) return null; $clean[$f] = 0 + $layer[$f]; }
    }
    foreach ([['poreSize', 6, 200], ['featureSize', 40, 2000], ['spireHeight', 0, 800], ['spireWidth', 10, 400]] as $r) {
      [$f, $lo, $hi] = $r;
      if (isset($layer[$f])) { if (!$num($layer[$f], $lo, $hi)) return null; $clean[$f] = (int)round($layer[$f]); }
    }
    $out[] = $clean;
  }
  return $out;
}

// Two kinds of request reach here: a paper (a DOI to seed a level from) or a terrain designed in the
// lab (a sea floor / ice ceiling for the generator to build a community around). Same queue, same
// rate limits — they differ only in what the workflow does with them.
$type = isset($rec['terrain']) ? 'terrain' : 'doi';
$doi = '';
$terrain = null;
$id = '';

if ($type === 'terrain') {
  // Validate shape and bounds here so garbage never reaches the queue; the game's own scenario
  // validator is still the authoritative gate when the level is generated. Mirrors the terrain rules
  // in game.js's SCENARIO_VALIDATOR block.
  $terrain = sc_clean_terrain($rec['terrain']);
  if ($terrain === null) {
    http_response_code(400);
    echo json_encode(['error' => "That terrain isn't valid — design it in the lab and use its Seed button."]);
    exit;
  }
  // A fresh id per submission: a designed terrain becomes a newly-invented scenario every time, so
  // there is nothing to dedup against. Hash includes the clock and a random draw so a double-click
  // can't collide.
  $id = 'terrain-' . substr(hash('sha256', json_encode($terrain) . microtime(true) . random_int(0, PHP_INT_MAX)), 0, 12);
} else {
  // ---- normalise + validate the DOI -------------------------------------------------------------
  // Mirrors cleanDoi()/DOI_RE in the scenarios repo's scripts/doi-id.mjs. Accept what people actually
  // paste: a bare DOI, a doi.org URL, with stray whitespace.
  $doi = trim((string)($rec['doi'] ?? ''));
  $doi = preg_replace('#^https?://(dx\.)?doi\.org/#i', '', $doi);
  if ($doi === '' || strlen($doi) > 300) {
    http_response_code(400);
    echo json_encode(['error' => 'Paste a DOI — it looks like 10.1126/science.1261359.']);
    exit;
  }
  // ASCII only, and not just for tidiness: the id below has to come out byte-identical to the one
  // JavaScript derives in the scenarios repo, and PHP's strtolower is byte-based where JS toLowerCase
  // is Unicode-aware. DOIs are ASCII by spec, so requiring it here removes the whole class of drift.
  if (!preg_match('/^[\x21-\x7E]+$/', $doi) || !preg_match('#^10\.[0-9]{4,9}/\S+$#', $doi)) {
    http_response_code(400);
    echo json_encode(['error' => "That does not look like a DOI. They start with 10. — for example 10.1126/science.1261359."]);
    exit;
  }
  $id = sc_slug('doi-' . sc_slug($doi));
}

// ---- optional credit name -------------------------------------------------------------------------
// Goes on a public page next to the level, so it is scrubbed here and again by the game's scenario
// validator, and rendered with textContent. Strip anything that could be read as markup, collapse
// whitespace, and cap it hard. Blank is the default and stays blank.
$name = (string)($rec['name'] ?? '');
$name = preg_replace('/[\x00-\x1F\x7F<>]/u', '', $name);   // control chars and angle brackets
$name = trim(preg_replace('/\s+/u', ' ', $name));
$name = mb_substr($name, 0, 40);

$now = (int)(microtime(true) * 1000);
$cutoff = $now - $DAY * 1000;

// ---- rate limit, on a hash so the stored file never holds a raw address --------------------------
$ip = (string)($_SERVER['REMOTE_ADDR'] ?? '');
$key = hash('sha256', 'bacteria-scenario-request|' . $ip);

// Closures rather than arrow functions, and no other modern syntax: this runs on whatever PHP a
// shared host happens to offer, and feedback.php next door is written the same way.
$fresh = static function ($ts) use ($cutoff) {
  if (!is_array($ts)) return [];
  $keep = [];
  foreach ($ts as $t) { if ((int)$t > $cutoff) $keep[] = (int)$t; }
  return $keep;
};

// COUNT now, RECORD later. Recording the attempt here would charge someone one of their three tries
// for a request we then turn away as a duplicate or over the daily cap — punishing them for asking
// about a paper that was already coming.
$mine = [];
$rfp = @fopen($RATE, 'r');
if ($rfp) {
  flock($rfp, LOCK_SH);
  $rl = json_decode(stream_get_contents($rfp), true);
  flock($rfp, LOCK_UN); fclose($rfp);
  if (is_array($rl) && isset($rl[$key])) $mine = $fresh($rl[$key]);
}
// If the file cannot be read at all we let the request through rather than failing shut: the daily
// ceiling below lives in the queue file and still bounds what any number of people can spend, so a
// permissions slip degrades fairness, not the budget.
if (count($mine) >= $MAX_PER_IP_DAY) {
  http_response_code(429);
  echo json_encode(['error' => "You've queued a few papers today already — try again tomorrow, and thank you."]);
  exit;
}

// ---- append to the queue -------------------------------------------------------------------------
$fp = @fopen($QUEUE, 'c+');
if (!$fp) { http_response_code(500); echo json_encode(['error' => 'queue unavailable']); exit; }
flock($fp, LOCK_EX);
$data = json_decode(stream_get_contents($fp), true);
$requests = (is_array($data) && isset($data['requests']) && is_array($data['requests'])) ? $data['requests'] : [];

// Already asked for? Say so plainly instead of queueing it twice — the poller would dedup it anyway,
// but the player deserves to know their paper is already on its way rather than think nothing happened.
// Only DOIs dedup: a designed terrain becomes a fresh scenario each time, so it is never "already" here.
$already = false;
if ($type === 'doi') {
  foreach ($requests as $r) {
    if (is_array($r) && strcasecmp((string)($r['doi'] ?? ''), $doi) === 0) { $already = true; break; }
  }
}

if (!$already) {
  $recent = 0;
  foreach ($requests as $r) { if (is_array($r) && (int)($r['ts'] ?? 0) > $cutoff) $recent++; }
  if ($recent >= $MAX_PER_DAY) {
    flock($fp, LOCK_UN); fclose($fp);
    http_response_code(429);
    echo json_encode(['error' => "The level factory is at its limit for today — please try again tomorrow."]);
    exit;
  }
  $entry = ['ts' => $now];
  if ($type === 'terrain') { $entry['terrain'] = $terrain; $entry['id'] = $id; }
  else { $entry['doi'] = $doi; }
  if ($name !== '') $entry['name'] = $name;   // omitted entirely when anonymous
  $requests[] = $entry;
  if (count($requests) > $MAX_QUEUE) $requests = array_slice($requests, -$MAX_QUEUE);

  $out = ['schema' => 'bacteria-scenario-queue', 'version' => 1, 'requests' => array_values($requests)];
  ftruncate($fp, 0); rewind($fp);
  fwrite($fp, json_encode($out, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE));
  fflush($fp);
}
flock($fp, LOCK_UN);
fclose($fp);

// Now that the paper is genuinely queued, charge it against this visitor's daily allowance. A repeat
// ask for something already queued costs nothing, which is what makes "already on its way" a safe
// thing to tell people.
if (!$already) {
  $rfp = @fopen($RATE, 'c+');
  if ($rfp) {
    flock($rfp, LOCK_EX);
    $rl = json_decode(stream_get_contents($rfp), true);
    if (!is_array($rl)) $rl = [];
    $mine = isset($rl[$key]) ? $fresh($rl[$key]) : [];
    $mine[] = $now;
    $rl[$key] = $mine;
    // drop everyone whose window has fully expired, so this file cannot grow without bound
    foreach ($rl as $k => $ts) {
      $keep = $fresh($ts);
      if ($keep) { $rl[$k] = $keep; } else { unset($rl[$k]); }
    }
    ftruncate($rfp, 0); rewind($rfp);
    fwrite($rfp, json_encode($rl));
    fflush($rfp); flock($rfp, LOCK_UN); fclose($rfp);
  }
}

echo json_encode(['ok' => true, 'id' => $id, 'type' => $type, 'doi' => $doi, 'queued' => !$already]);
