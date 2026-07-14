<?php
require_once __DIR__ . '/../score_schema.php';

function check($condition, $message) {
  if (!$condition) throw new Exception($message);
}

$submitted = json_decode('[{
  "id": 1,
  "score": 100000000,
  "hist": [{}, {"eco":[1,2,3,4,5,6,7,8],"p":2,"v":3,"buckets":{"0":2,"999":5}}],
  "upgrades": {"0":{"abbr":"L1"}},
  "lineages": [],
  "roleSwaps": {}
}]');
$board = score_normalize_board($submitted, 1, 100, 2 * 1024 * 1024, 192 * 1024);

check(count($board) === 1, 'record should survive nested cleanup');
check(count($board[0]['hist']) === 1, 'malformed history sample should be discarded');
check(count($board[0]['hist'][0]['eco']) === 8, 'eco vector must have eight values');
check((array)$board[0]['hist'][0]['buckets'] === [0 => 2], 'invalid bucket keys should be discarded');
check($board[0]['upgrades'] === [], 'upgrade object must not masquerade as a list');
check((array)$board[0]['lineages'] === [], 'lineage list must not masquerade as an object map');
check($board[0]['roleSwaps'] === [], 'role-swap object must not masquerade as a list');

$oversized = score_fit_board($board, 100, 10, 192 * 1024);
check($oversized === [], 'aggregate byte budget must exclude records that do not fit');

echo "PHP score schema OK: malformed fixtures normalized and byte budget enforced.\n";
