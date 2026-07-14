<?php
// Beta feedback sink for Bacteria!
//
//   POST feedback.php  {text, name, context}  -> appends one entry to feedback.json
//
// Deliberately dumb: a JSON array on disk, same shape as scores.php, no accounts, no email, no
// third party. Testers don't all have GitHub, and asking someone to open an account to tell you the
// protists are too fast is how you get no feedback at all.
//
// feedback.json is BLOCKED from the web in .htaccess — it holds whatever people typed, which is
// theirs, not the internet's. Read it over ssh:  cat ~/<site>/feedback.json | python3 -m json.tool
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');

$FILE = __DIR__ . '/feedback.json';
$MAX  = 2000;   // entries kept; oldest dropped past this

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
if (strlen($raw) > 20000) { http_response_code(413); echo json_encode(['error' => 'too large']); exit; }
$rec = json_decode($raw, true);
if (!is_array($rec)) { http_response_code(400); echo json_encode(['error' => 'bad json']); exit; }

// strip control characters, cap every field — never trust the client
$clean = static function ($v, $len) {
  $s = preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F]/u', '', (string)$v);
  return mb_substr($s, 0, $len);
};
$text = trim($clean($rec['text'] ?? '', 4000));
if ($text === '') { http_response_code(400); echo json_encode(['error' => 'empty']); exit; }

$entry = [
  'ts'      => (int)(microtime(true) * 1000),
  'name'    => $clean($rec['name'] ?? '', 40),
  'text'    => $text,
  'context' => $clean($rec['context'] ?? '', 2000),   // build, device, run state — filled by game.js
];

$fp = @fopen($FILE, 'c+');
if (!$fp) { http_response_code(500); echo json_encode(['error' => 'store unavailable']); exit; }
flock($fp, LOCK_EX);
$data = stream_get_contents($fp);
$arr  = json_decode($data, true);
if (!is_array($arr)) $arr = [];
$arr[] = $entry;
if (count($arr) > $MAX) $arr = array_slice($arr, -$MAX);
ftruncate($fp, 0);
rewind($fp);
fwrite($fp, json_encode($arr, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE));
fflush($fp);
flock($fp, LOCK_UN);
fclose($fp);

echo json_encode(['ok' => true, 'count' => count($arr)]);
