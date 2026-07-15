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

$phylo = json_decode('[{
  "id":2,"score":20,"hist":[],"upgrades":[],
  "lineages":{"64":{"t":2,"ups":[],"tree":[{"t":2,"label":"Lipase","abbr":"L1","color":"#efd98a"}],
    "variants":[{"t":3,"ups":[],"tree":[{"t":3,"label":"Lost lipase","abbr":"xL1","color":"#efd98a"}]}]}},
  "roleSwaps":[]
}]');
$phyloBoard = score_normalize_board($phylo, 1, 100000, 2 * 1024 * 1024, 192 * 1024);
$lineage = (array)$phyloBoard[0]['lineages'];
check(count($lineage[64]['tree']) === 1, 'lineage ancestry must survive server normalization');
check(count($lineage[64]['variants']) === 1, 'same-band phylogenetic variants must survive server normalization');
check($lineage[64]['variants'][0]['tree'][0]['abbr'] === 'xL1', 'gene-loss branches must retain their labels');

$oversized = score_fit_board($board, 100, 10, 192 * 1024);
check($oversized === [], 'aggregate byte budget must exclude records that do not fit');

echo "PHP score schema OK: malformed fixtures normalized and byte budget enforced.\n";
