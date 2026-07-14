<?php
// Shared leaderboard for "Bacteria!" — tiny, dependency-free, file-backed.
//   GET  scores.php        → JSON array of the top runs (highest score first)
//   POST scores.php  {run} → upsert one run by its id, return the updated top list
//   POST scores.php  {op:"name", id, name} → update only that run's display name
// Storage is a single JSON file next to this script, guarded with flock().
// Deliberately minimal server-side surface: no DB, no auth (a friends leaderboard),
// strict input caps + sanitization, and it never executes anything from the payload.

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

$FILE     = __DIR__ . '/scores.json';
$MAX      = 100;             // keep the top N
$MAX_BODY = 300 * 1024;      // reject submissions larger than this (bytes)

function read_scores($FILE) {
  if (!is_file($FILE)) return [];
  $fp = @fopen($FILE, 'r');
  if (!$fp) return [];
  flock($fp, LOCK_SH);
  $data = stream_get_contents($fp);
  flock($fp, LOCK_UN);
  fclose($fp);
  $arr = json_decode($data, true);
  return is_array($arr) ? $arr : [];
}

function clean_name($value) {
  return mb_substr(preg_replace('/[\x00-\x1F<>]/u', '', (string)$value), 0, 18);
}

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

if ($method === 'GET') {
  echo json_encode(read_scores($FILE));
  exit;
}

if ($method === 'POST') {
  $raw = file_get_contents('php://input', false, null, 0, $MAX_BODY + 1);
  if ($raw === false || strlen($raw) > $MAX_BODY) {
    http_response_code(413); echo json_encode(['error' => 'too large']); exit;
  }
  $rec = json_decode($raw, true);
  if (!is_array($rec)) { http_response_code(400); echo json_encode(['error' => 'bad json']); exit; }

  $nameOnly = (($rec['op'] ?? '') === 'name');
  if ($nameOnly && !isset($rec['id'])) {
    http_response_code(400); echo json_encode(['error' => 'missing id']); exit;
  }

  $now = (int)(microtime(true) * 1000);
  // sanitize & clamp every field — never trust the client
  $clean = [
    'id'       => isset($rec['id']) ? (int)$rec['id'] : $now,
    'name'     => clean_name($rec['name'] ?? ''),
    'score'    => max(0, min(100000000, (int)($rec['score'] ?? 0))),
    'gen'      => max(0, min(1000000, (int)($rec['gen'] ?? 0))),
    'dur'      => max(0, min(86400, (int)($rec['dur'] ?? 0))),
    'date'     => isset($rec['date']) ? (int)$rec['date'] : $now,
    'hist'     => is_array($rec['hist'] ?? null) ? array_slice($rec['hist'], 0, 800) : [],
    'upgrades' => is_array($rec['upgrades'] ?? null) ? array_slice($rec['upgrades'], 0, 200) : [],
    // Which board this run belongs on. Touch and desktop are not the same game (different swim
    // speed, zoom and gold-phage capture radius), so they are ranked separately. Whitelisted to two
    // values — this decides a leaderboard, so it must not be a free-text field the client picks.
    // Legacy rows have no device at all; the client reads those as desktop, which is what they were.
    'device'   => (($rec['device'] ?? '') === 'touch') ? 'touch' : 'desktop',
    // 'day' was being dropped on the floor: the client has always sent it, but it was never in this
    // whitelist, so the shared board silently lost how many days a run survived.
    'day'      => max(1, min(3650, (int)($rec['day'] ?? 1))),
    // Per-lineage genomes: bucket key (one colored band on the run chart) -> that lineage's adaptations.
    // Small by construction (capped at 64 lineages client-side), and needed to draw a band's circos.
    'lineages' => is_array($rec['lineages'] ?? null) ? array_slice($rec['lineages'], 0, 64, true) : new stdClass(),
    // Where the run flipped trophic level (bacteria <-> protist). Drawn as a divider on the run chart.
    'roleSwaps' => is_array($rec['roleSwaps'] ?? null) ? array_slice($rec['roleSwaps'], 0, 32) : [],
  ];

  $fp = @fopen($FILE, 'c+');
  if (!$fp) { http_response_code(500); echo json_encode(['error' => 'store unavailable']); exit; }
  flock($fp, LOCK_EX);
  $data = stream_get_contents($fp);
  $arr = json_decode($data, true);
  if (!is_array($arr)) $arr = [];
  if ($nameOnly) {
    // A name edit must not resend or replace the run's history. Mutate only the matching field
    // while holding the same lock as full submissions, so queued writes remain strictly ordered.
    $id = (int)$rec['id']; $found = false;
    foreach ($arr as &$row) {
      if ((int)($row['id'] ?? 0) === $id) { $row['name'] = clean_name($rec['name'] ?? ''); $found = true; break; }
    }
    unset($row);
    if (!$found) {
      flock($fp, LOCK_UN); fclose($fp);
      http_response_code(404); echo json_encode(['error' => 'run not found']); exit;
    }
  } else {
    // upsert by id (continuing into another day updates the same run, not a duplicate)
    $arr = array_values(array_filter($arr, function ($r) use ($clean) { return ($r['id'] ?? null) !== $clean['id']; }));
    $arr[] = $clean;
    usort($arr, function ($a, $b) { return ($b['score'] ?? 0) <=> ($a['score'] ?? 0); });
    $arr = array_slice($arr, 0, $MAX);
  }
  rewind($fp); ftruncate($fp, 0); fwrite($fp, json_encode($arr));
  fflush($fp); flock($fp, LOCK_UN); fclose($fp);

  echo json_encode($arr);
  exit;
}

http_response_code(405);
echo json_encode(['error' => 'method not allowed']);
