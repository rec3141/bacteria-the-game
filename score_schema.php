<?php

// Pure leaderboard normalization helpers. JSON is decoded without associative mode so arrays and
// objects remain distinguishable: a public `{}` must never pass as a list merely because PHP can
// represent both as arrays.

function score_value($object, $key, $default = null) {
  return is_object($object) && property_exists($object, $key) ? $object->$key : $default;
}

function score_number($value, $min, $max, $default = null) {
  if (!is_int($value) && !is_float($value)) return $default;
  $number = (float)$value;
  if (!is_finite($number)) return $default;
  return max($min, min($max, $number));
}

function score_integer($value, $min, $max, $default = 0) {
  $number = score_number($value, $min, $max, null);
  return $number === null ? $default : (int)round($number);
}

function score_text($value, $maxLength) {
  if (!is_string($value)) return '';
  $clean = preg_replace('/[\x00-\x1F<>]/u', '', $value);
  if (!is_string($clean)) return '';
  return function_exists('mb_substr') ? mb_substr($clean, 0, $maxLength) : substr($clean, 0, $maxLength);
}

function score_vector($value, $length, $max) {
  if (!is_array($value) || count($value) !== $length) return null;
  $out = [];
  foreach ($value as $item) {
    $number = score_number($item, 0, $max, null);
    if ($number === null) return null;
    $out[] = (int)round($number);
  }
  return $out;
}

function score_buckets($value) {
  if (!is_object($value)) return null;
  $out = [];
  foreach (get_object_vars($value) as $key => $count) {
    if (count($out) >= 64 || !preg_match('/^(?:0|[1-9][0-9]*)$/', (string)$key)) continue;
    $bucket = (int)$key;
    $number = score_number($count, 0, 100000, null);
    if ($bucket < 0 || $bucket > 4095 || $number === null) continue;
    $out[$bucket] = (int)round($number);
  }
  ksort($out, SORT_NUMERIC);
  return (object)$out;
}

function score_upgrade($value, $maxTime = 86400) {
  if (!is_object($value)) return null;
  $abbr = preg_replace('/[^A-Za-z0-9]/', '', score_text(score_value($value, 'abbr', ''), 12));
  if (!is_string($abbr) || $abbr === '') return null;
  $out = ['t' => score_number(score_value($value, 't', 0), 0, $maxTime, 0), 'abbr' => $abbr];
  if (score_value($value, 'acquired', false) === true) $out['acquired'] = true; // omit the common false
  // label & color are OPTIONAL: a compact record omits them and the client rebuilds both from the abbr.
  // Keep them only when actually supplied (legacy full-form records), so a stored default can never
  // override the client's reconstruction.
  $label = score_text(score_value($value, 'label', ''), 64);
  if ($label !== '') $out['label'] = $label;
  $color = score_text(score_value($value, 'color', ''), 9);
  if (preg_match('/^#[0-9A-Fa-f]{3,8}$/', $color)) $out['color'] = $color;
  return $out;
}

function score_upgrades($value, $limit = 200, $maxTime = 86400) {
  if (!is_array($value)) return [];
  $out = [];
  foreach ($value as $item) {
    if (count($out) >= $limit) break;
    $upgrade = score_upgrade($item, $maxTime);
    if ($upgrade !== null) $out[] = $upgrade;
  }
  return $out;
}

function score_history_sample($value) {
  if (!is_object($value)) return null;
  $eco = score_vector(score_value($value, 'eco'), 8, 100000); // legacy wire key: per-trait-mask counts (kept for data compat)
  if ($eco === null) return null;
  $out = [
    'eco' => $eco,
    'p' => score_integer(score_value($value, 'p', 0), 0, 1000000, 0),
    'v' => score_integer(score_value($value, 'v', 0), 0, 1000000, 0),
  ];
  $buckets = score_buckets(score_value($value, 'buckets'));
  if ($buckets !== null) $out['buckets'] = $buckets;
  $sub = score_vector(score_value($value, 'sub'), 3, 1000000);
  if ($sub !== null) $out['sub'] = $sub;
  $mort = score_vector(score_value($value, 'mort'), 4, 1000000);
  if ($mort !== null) $out['mort'] = $mort;
  $cin = score_vector(score_value($value, 'cin'), 5, 100000000); // calories consumed by source
  if ($cin !== null) $out['cin'] = $cin;
  $lsp = score_vector(score_value($value, 'lsp'), 12, 1000000); // age-at-death histogram for the turnover spectrogram
  if ($lsp !== null) $out['lsp'] = $lsp;
  $levels = score_vector(score_value($value, 'lvl'), 8, 511);
  if ($levels !== null) $out['lvl'] = $levels;
  return $out;
}

function score_history($value, $limit = 800) {
  if (!is_array($value)) return [];
  $out = [];
  foreach ($value as $item) {
    if (count($out) >= $limit) break;
    $sample = score_history_sample($item);
    if ($sample !== null) $out[] = $sample;
  }
  return $out;
}

function score_lineages($value) {
  if (!is_object($value)) return new stdClass();
  $out = [];
  foreach (get_object_vars($value) as $key => $lineage) {
    if (count($out) >= 512 || !preg_match('/^(?:0|[1-9][0-9]*)$/', (string)$key) || !is_object($lineage)) continue; // keep every band's genome (compact encoding keeps this cheap)
    $bucket = (int)$key;
    if ($bucket < 0 || $bucket > 4095) continue;
    $entry = [
      't' => score_number(score_value($lineage, 't', 0), 0, 86400, 0),
      'ups' => score_upgrades(score_value($lineage, 'ups'), 512),
    ];
    $tree = score_value($lineage, 'tree');
    if (is_array($tree)) $entry['tree'] = score_upgrades($tree, 512);
    $variants = score_value($lineage, 'variants');
    if (is_array($variants)) {
      $entry['variants'] = [];
      foreach ($variants as $variant) {
        if (count($entry['variants']) >= 4 || !is_object($variant)) continue;
        $clean = [
          't' => score_number(score_value($variant, 't', 0), 0, 86400, 0),
          'ups' => score_upgrades(score_value($variant, 'ups'), 512),
        ];
        $variantTree = score_value($variant, 'tree');
        if (is_array($variantTree)) $clean['tree'] = score_upgrades($variantTree, 512);
        $entry['variants'][] = $clean;
      }
    }
    $out[$bucket] = $entry;
  }
  ksort($out, SORT_NUMERIC);
  return (object)$out;
}

// A role swap is an OBJECT — {t, to} — not a bare number.
//
// This was handing the whole {t,to} object to score_number(), which only accepts a scalar, so every
// entry came back null and the list was dropped: the shared board silently lost the trophic role
// swap on every run. And even had it parsed, flattening to bare times would have thrown away `to`,
// which is the half that says WHICH WAY you flipped — the client needs it to label the divider
// "became protist" or "back to bacteria".
function score_role_swaps($value) {
  if (!is_array($value)) return [];
  $out = [];
  foreach ($value as $item) {
    if (count($out) >= 32) break;
    $time = score_number(score_value($item, 't'), 0, 86400, null);
    if ($time === null) continue;
    $to = score_value($item, 'to');
    $out[] = ['t' => $time, 'to' => ($to === 'bacterium') ? 'bacterium' : 'protist'];
  }
  return $out;
}

function score_normalize_record($record, $now) {
  if (!is_object($record)) return null;
  $date = score_integer(score_value($record, 'date', $now), 0, 9007199254740991, $now);
  $id = score_integer(score_value($record, 'id', $date), 0, 9007199254740991, $date);
  return [
    'id' => $id,
    'name' => score_text(score_value($record, 'name', ''), 18),
    'score' => score_integer(score_value($record, 'score', 0), 0, 100000000, 0),
    'gen' => score_integer(score_value($record, 'gen', 0), 0, 1000000, 0),
    'dur' => score_integer(score_value($record, 'dur', 0), 0, 86400, 0),
    'date' => $date,
    'hist' => score_history(score_value($record, 'hist')),
    'upgrades' => score_upgrades(score_value($record, 'upgrades')),
    'device' => score_value($record, 'device', '') === 'touch' ? 'touch' : 'desktop',
    'day' => score_integer(score_value($record, 'day', 1), 1, 3650, 1),
    'live' => score_value($record, 'live', false) === true, // run is still continuable — PUBLIC in-progress flag
    'lineages' => score_lineages(score_value($record, 'lineages')),
    'roleSwaps' => score_role_swaps(score_value($record, 'roleSwaps')),
  ];
}

function score_json($value) {
  $json = json_encode($value, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
  return is_string($json) ? $json : null;
}

function score_fit_board($records, $maxRows, $maxBytes, $maxRecordBytes) {
  usort($records, function ($a, $b) { return ($b['score'] ?? 0) <=> ($a['score'] ?? 0); });
  $out = []; $bytes = 2; // surrounding []
  foreach ($records as $record) {
    if (count($out) >= $maxRows) break;
    $json = score_json($record);
    if ($json === null || strlen($json) > $maxRecordBytes) continue;
    $extra = strlen($json) + (count($out) ? 1 : 0);
    if ($bytes + $extra > $maxBytes) continue;
    $out[] = $record; $bytes += $extra;
  }
  return $out;
}

function score_normalize_board($value, $now, $maxRows, $maxBytes, $maxRecordBytes) {
  if (!is_array($value)) return [];
  $records = [];
  foreach ($value as $item) {
    $record = score_normalize_record($item, $now);
    if ($record !== null) $records[] = $record;
  }
  return score_fit_board($records, $maxRows, $maxBytes, $maxRecordBytes);
}

function score_decode_board($json, $now, $maxRows, $maxBytes, $maxRecordBytes) {
  $value = json_decode($json);
  if (json_last_error() !== JSON_ERROR_NONE) return [];
  return score_normalize_board($value, $now, $maxRows, $maxBytes, $maxRecordBytes);
}
