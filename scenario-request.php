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
if (strlen($raw) > 4000) { http_response_code(413); echo json_encode(['error' => 'too large']); exit; }
$rec = json_decode($raw, true);
if (!is_array($rec)) { http_response_code(400); echo json_encode(['error' => 'bad json']); exit; }

// ---- normalise + validate the DOI ---------------------------------------------------------------
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

// ---- derive the scenario id ----------------------------------------------------------------------
// Must match doiScenarioId() in scripts/doi-id.mjs exactly, including the double slug (the outer one
// re-applies the 60-char cap once the "doi-" prefix is on). The game polls for this id to tell the
// player when their level is ready, so a mismatch here just means the poll never resolves.
function sc_slug($s) {
  $s = strtolower((string)$s);
  $s = preg_replace('/[^a-z0-9]+/', '-', $s);
  $s = preg_replace('/^-+|-+$/', '', $s);
  $s = substr($s, 0, 60);
  return $s === '' ? 'scenario' : $s;
}
$id = sc_slug('doi-' . sc_slug($doi));

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
$already = false;
foreach ($requests as $r) {
  if (is_array($r) && strcasecmp((string)($r['doi'] ?? ''), $doi) === 0) { $already = true; break; }
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
  $requests[] = ['doi' => $doi, 'ts' => $now];
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

echo json_encode(['ok' => true, 'id' => $id, 'doi' => $doi, 'queued' => !$already]);
