<?php
// Shared leaderboard for "Bacteria!" — tiny, dependency-free, file-backed.
//   GET  scores.php        → normalized JSON array of top runs
//   POST scores.php  {run} → normalize and upsert one run by id
//   POST scores.php  {op:"name", id, name} → update only that normalized run's display name

require_once __DIR__ . '/score_schema.php';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

$FILE             = __DIR__ . '/scores.json';
$MAX_ROWS         = 100;
$MAX_BODY_BYTES   = 300 * 1024;
$MAX_RECORD_BYTES = 192 * 1024;
$MAX_STORE_BYTES  = 2 * 1024 * 1024;
$MAX_READ_BYTES   = 32 * 1024 * 1024; // legacy stores could reach 100 × 300 KB; response/store stays at 2 MB

function read_scores($file, $now, $maxRows, $maxStoreBytes, $maxRecordBytes, $maxReadBytes) {
  if (!is_file($file)) return [];
  $fp = @fopen($file, 'r');
  if (!$fp) return [];
  flock($fp, LOCK_SH);
  $data = stream_get_contents($fp, $maxReadBytes + 1);
  flock($fp, LOCK_UN); fclose($fp);
  if (!is_string($data) || strlen($data) > $maxReadBytes) return [];
  return score_decode_board($data, $now, $maxRows, $maxStoreBytes, $maxRecordBytes);
}

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$now = (int)(microtime(true) * 1000);

if ($method === 'GET') {
  $board = read_scores($FILE, $now, $MAX_ROWS, $MAX_STORE_BYTES, $MAX_RECORD_BYTES, $MAX_READ_BYTES);
  echo score_json($board) ?? '[]';
  exit;
}

if ($method === 'POST') {
  $raw = file_get_contents('php://input', false, null, 0, $MAX_BODY_BYTES + 1);
  if (!is_string($raw) || strlen($raw) > $MAX_BODY_BYTES) {
    http_response_code(413); echo json_encode(['error' => 'too large']); exit;
  }
  // Preserve JSON's array/object distinction. In associative mode `{}` becomes a PHP array and
  // can masquerade as a list — the bug this endpoint must not admit.
  $submitted = json_decode($raw);
  if (json_last_error() !== JSON_ERROR_NONE || !is_object($submitted)) {
    http_response_code(400); echo json_encode(['error' => 'bad json']); exit;
  }
  $nameOnly = score_value($submitted, 'op', '') === 'name';
  if ($nameOnly && score_number(score_value($submitted, 'id'), 0, 9007199254740991, null) === null) {
    http_response_code(400); echo json_encode(['error' => 'missing id']); exit;
  }
  $clean = $nameOnly ? null : score_normalize_record($submitted, $now);
  $cleanJson = $nameOnly ? null : score_json($clean);
  if (!$nameOnly && ($clean === null || $cleanJson === null || strlen($cleanJson) > $MAX_RECORD_BYTES)) {
    http_response_code(413); echo json_encode(['error' => 'normalized run too large']); exit;
  }

  $fp = @fopen($FILE, 'c+');
  if (!$fp) { http_response_code(500); echo json_encode(['error' => 'store unavailable']); exit; }
  flock($fp, LOCK_EX);
  $data = stream_get_contents($fp, $MAX_READ_BYTES + 1);
  if (!is_string($data) || strlen($data) > $MAX_READ_BYTES) {
    flock($fp, LOCK_UN); fclose($fp);
    http_response_code(507); echo json_encode(['error' => 'store exceeds recovery limit']); exit;
  }
  $board = score_decode_board($data, $now, $MAX_ROWS, $MAX_STORE_BYTES, $MAX_RECORD_BYTES);

  if ($nameOnly) {
    $id = score_integer(score_value($submitted, 'id'), 0, 9007199254740991, 0);
    $name = score_text(score_value($submitted, 'name', ''), 18); $found = false;
    foreach ($board as &$row) {
      if ((int)($row['id'] ?? 0) === $id) { $row['name'] = $name; $found = true; break; }
    }
    unset($row);
    if (!$found) {
      flock($fp, LOCK_UN); fclose($fp);
      http_response_code(404); echo json_encode(['error' => 'run not found']); exit;
    }
  } else {
    $board = array_values(array_filter($board, function ($row) use ($clean) {
      return (int)($row['id'] ?? 0) !== $clean['id'];
    }));
    $board[] = $clean;
  }

  $board = score_fit_board($board, $MAX_ROWS, $MAX_STORE_BYTES, $MAX_RECORD_BYTES);
  $encoded = score_json($board);
  if ($encoded === null || strlen($encoded) > $MAX_STORE_BYTES) {
    flock($fp, LOCK_UN); fclose($fp);
    http_response_code(500); echo json_encode(['error' => 'could not encode store']); exit;
  }
  rewind($fp); ftruncate($fp, 0); fwrite($fp, $encoded);
  fflush($fp); flock($fp, LOCK_UN); fclose($fp);

  echo $encoded;
  exit;
}

http_response_code(405);
echo json_encode(['error' => 'method not allowed']);
