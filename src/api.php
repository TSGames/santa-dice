<?php
/**
 * Adventskalender-Backend. Spezifikation: Backlog.md, Leitplanken: CLAUDE.md.
 *
 * Umgebungsvariablen:
 *   DATA_DIR       Verzeichnis für settings.json, items.json, days.json und uploads/ (Default: .)
 *   ADMIN_TOKEN    Token für Admin-Aktionen (Header X-Admin-Token). Leer = Admin deaktiviert.
 *   FAKE_TODAY     Nur für Tests: festes Datum YYYY-MM-DD statt heute.
 *                  Der Admin kann die geöffneten Türchen zusätzlich per "open-until" festlegen.
 *   CALENDAR_YEAR  Jahr des Kalenders (Default: Jahr von "heute").
 */

header('Content-Type: application/json');

const DAYS = 24;
// Frontend shrinks images to this size before upload (see image-resize.ts)
const MAX_UPLOAD_BYTES = 500 * 1024;
const IMAGE_TYPES = ['image/jpeg' => 'jpg', 'image/png' => 'png', 'image/webp' => 'webp', 'image/gif' => 'gif'];

$dataDir = rtrim(getenv('DATA_DIR') ?: '.', '/');
// Storage: one JSON file per part, all guarded by one lock file (see CLAUDE.md)
$files = [
    'settings' => "$dataDir/settings.json",
    'items' => "$dataDir/items.json",
    'days' => "$dataDir/days.json",
];
$legacyFile = "$dataDir/data.json";
$uploadDir = $dataDir . '/uploads';

function fail(int $status, string $message): void
{
    http_response_code($status);
    echo json_encode(['error' => $message]);
    exit;
}

function encodeJson($value): string
{
    return json_encode($value, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
}

/** Replaces a file in one step, so a crash never leaves it half written. */
function writeAtomic(string $file, string $content): void
{
    $tmp = "$file.tmp";
    if (file_put_contents($tmp, $content) === false || !rename($tmp, $file)) {
        fail(500, 'write failed');
    }
}

/**
 * Splits the former single data.json into settings/items/days.
 * The old file is kept as data.json.migrated. The old flat list format is dropped (see CLAUDE.md).
 */
function migrateLegacy(string $legacyFile, array $files): void
{
    $decoded = json_decode((string)file_get_contents($legacyFile), true);
    $old = is_array($decoded) && !array_is_list($decoded) ? $decoded : [];
    foreach ($files as $part => $file) {
        writeAtomic($file, encodeJson($old[$part] ?? []));
    }
    rename($legacyFile, "$legacyFile.migrated");
}

function today(): DateTimeImmutable
{
    $fake = getenv('FAKE_TODAY');
    return new DateTimeImmutable($fake ?: 'today');
}

/** Highest day number that is open by date (0 = none). */
function autoOpenUntil(): int
{
    $today = today();
    $year = (int)(getenv('CALENDAR_YEAR') ?: $today->format('Y'));
    $start = new DateTimeImmutable("$year-12-01");
    if ($today < $start) {
        return 0;
    }
    if ((int)$today->format('Y') > $year) {
        return DAYS;
    }
    return min(DAYS, (int)$today->format('j'));
}

/** Highest open day number: admin override if set, otherwise by date. */
function openUntil(array $data): int
{
    $override = $data['settings']['openUntil'];
    return $override === null ? autoOpenUntil() : max(0, min(DAYS, (int)$override));
}

function isAdmin(): bool
{
    $token = getenv('ADMIN_TOKEN');
    $given = $_SERVER['HTTP_X_ADMIN_TOKEN'] ?? '';
    return $token !== false && $token !== '' && hash_equals($token, $given);
}

function requireAdmin(): void
{
    if (!isAdmin()) {
        fail(403, 'admin token required');
    }
}

function input(): array
{
    static $body = null;
    if ($body === null) {
        $body = json_decode(file_get_contents('php://input') ?: '[]', true) ?: [];
    }
    return $body + $_GET + $_POST;
}

function param(string $key, bool $required = true)
{
    $value = input()[$key] ?? null;
    if ($required && ($value === null || $value === '')) {
        fail(400, "missing parameter: $key");
    }
    return is_string($value) ? trim($value) : $value;
}

function dayParam(): int
{
    $day = (int)param('day');
    if ($day < 1 || $day > DAYS) {
        fail(400, 'invalid day');
    }
    return $day;
}

function nameParam(): string
{
    $name = mb_substr((string)param('name'), 0, 60);
    if ($name === '') {
        fail(400, 'missing name');
    }
    return $name;
}

function emptyDay(): array
{
    return ['participants' => [], 'rounds' => [['players' => [], 'rolls' => (object)[], 'closed' => false]],
        'winner' => null, 'revealed' => false, 'itemId' => null, 'pickedFor' => null];
}

function normalize(array $data): array
{
    $data['items'] = $data['items'] ?? [];
    $data['settings'] = array_merge(['openUntil' => null], $data['settings'] ?? []);
    $days = $data['days'] ?? [];
    for ($d = 1; $d <= DAYS; $d++) {
        $days[(string)$d] = array_merge(emptyDay(), $days[(string)$d] ?? []);
        foreach ($days[(string)$d]['rounds'] as &$round) {
            $round['rolls'] = (object)(array)$round['rolls'];
        }
        unset($round);
    }
    $data['days'] = $days;
    return $data;
}

function &currentRound(array &$day): array
{
    $last = count($day['rounds']) - 1;
    return $day['rounds'][$last];
}

/** Rolls of the current round as [name => sum]; null if round still running. */
function roundResult(array $round): ?array
{
    $rolls = (array)$round['rolls'];
    $complete = $round['closed'] || count($rolls) >= count($round['players']);
    if (!$complete) {
        return null;
    }
    return array_map('array_sum', $rolls);
}

/** Names sharing the highest sum of a finished round. */
function leaders(array $round): array
{
    $sums = roundResult($round);
    if (!$sums) {
        return [];
    }
    $max = max($sums);
    return array_map('strval', array_keys(array_filter($sums, fn($s) => $s === $max)));
}

function nextDayWithoutItem(array $data, int $from): ?int
{
    for ($d = $from + 1; $d <= DAYS; $d++) {
        if (!$data['days'][(string)$d]['itemId']) {
            return $d;
        }
    }
    return null;
}

function findItem(array $data, ?string $id): ?array
{
    foreach ($data['items'] as $item) {
        if ($item['id'] === $id) {
            return $item;
        }
    }
    return null;
}

function publicItem(?array $item): ?array
{
    if (!$item) {
        return null;
    }
    return ['id' => $item['id'], 'title' => $item['title'], 'description' => $item['description'],
        'link' => $item['link'], 'image' => $item['image'] ? 'api.php?action=image&id=' . rawurlencode($item['id']) : null];
}

function calendar(array $data): array
{
    $open = openUntil($data);
    $days = [];
    for ($d = 1; $d <= DAYS; $d++) {
        $day = $data['days'][(string)$d];
        $isOpen = $d <= $open;
        $entry = ['day' => $d, 'open' => $isOpen];
        if ($isOpen) {
            $round = $day['rounds'][count($day['rounds']) - 1];
            $item = publicItem(findItem($data, $day['itemId']));
            $entry += [
                // Preis erst nach Freigabe durch den Admin sichtbar
                'item' => $day['revealed'] ? $item : null,
                'hasItem' => (bool)$item,
                'preview' => isAdmin() && !$day['revealed'] ? $item : null,
                'revealed' => $day['revealed'],
                'participants' => $day['participants'],
                'rounds' => $day['rounds'],
                'winner' => $day['winner'],
                'pickedFor' => $day['pickedFor'],
                'pickTarget' => $day['revealed'] && !$day['pickedFor'] ? nextDayWithoutItem($data, $d) : null,
                'roundComplete' => roundResult($round) !== null,
                'leaders' => leaders($round),
            ];
        }
        $days[] = $entry;
    }
    $result = ['today' => today()->format('Y-m-d'), 'openUntil' => $open, 'admin' => isAdmin(), 'days' => $days];
    if (isAdmin()) {
        $result += ['autoOpenUntil' => autoOpenUntil(), 'openOverride' => $data['settings']['openUntil']];
    }
    return $result;
}

// ---------------------------------------------------------------------------

$action = $_GET['action'] ?? 'calendar';

// Bilder ausliefern (ohne Lock, read-only)
if ($action === 'image') {
    $id = preg_replace('/[^a-zA-Z0-9_-]/', '', $_GET['id'] ?? '');
    foreach (IMAGE_TYPES as $mime => $ext) {
        $file = "$uploadDir/$id.$ext";
        if ($id && is_file($file)) {
            header('Content-Type: ' . $mime);
            header('Cache-Control: public, max-age=86400');
            readfile($file);
            exit;
        }
    }
    fail(404, 'image not found');
}

$isWrite = $_SERVER['REQUEST_METHOD'] === 'POST';
if (!$isWrite && !in_array($action, ['calendar', 'items', 'available'], true)) {
    fail(405, 'use POST');
}

$lock = fopen("$dataDir/.lock", 'c');
// Reads share the lock, writes and the one-time migration from data.json need it exclusively
$needsMigration = is_file($legacyFile) && !is_file($files['days']);
if (!$lock || !flock($lock, $isWrite || $needsMigration ? LOCK_EX : LOCK_SH)) {
    fail(500, 'lock failed');
}
if (is_file($legacyFile) && !is_file($files['days'])) {
    migrateLegacy($legacyFile, $files);
}

$stored = [];
foreach ($files as $part => $file) {
    $decoded = is_file($file) ? json_decode((string)file_get_contents($file), true) : null;
    $stored[$part] = is_array($decoded) ? $decoded : [];
}
$data = normalize($stored);
$loaded = array_map('encodeJson', $data);

/** Writes only the parts that changed, each atomically (temp file + rename). */
$save = function () use (&$data, &$loaded, $files) {
    foreach ($files as $part => $file) {
        $json = encodeJson($data[$part]);
        if ($json !== $loaded[$part]) {
            writeAtomic($file, $json);
            $loaded[$part] = $json;
        }
    }
};

$open = openUntil($data);
$response = null;

switch ($action) {
    case 'calendar':
        break;

    case 'join':
        $d = dayParam();
        $name = nameParam();
        $day = &$data['days'][(string)$d];
        if ($d > $open) fail(409, 'door not open yet');
        if ($day['winner']) fail(409, 'door already decided');
        if (count($day['rounds']) > 1 || $day['rounds'][0]['closed']) fail(409, 'round already closed');
        if (!in_array($name, $day['participants'], true)) {
            $day['participants'][] = $name;
            $day['rounds'][0]['players'][] = $name;
        }
        unset($day);
        $save();
        break;

    case 'roll':
        $d = dayParam();
        $name = nameParam();
        $day = &$data['days'][(string)$d];
        if ($d > $open) fail(409, 'door not open yet');
        if ($day['winner']) fail(409, 'door already decided');
        $round = &currentRound($day);
        if ($round['closed']) fail(409, 'round closed');
        if (!in_array($name, $round['players'], true)) fail(409, 'not a player in this round');
        if (isset($round['rolls']->$name)) fail(409, 'already rolled');
        $roll = [random_int(1, 6), random_int(1, 6)];
        $round['rolls']->$name = $roll;
        $response = ['roll' => $roll];
        unset($round, $day);
        $save();
        break;

    case 'pick':
        $d = dayParam();
        $name = nameParam();
        $itemId = (string)param('itemId');
        $day = &$data['days'][(string)$d];
        if ($day['winner'] !== $name) fail(403, 'only the winner can pick');
        if (!$day['revealed']) fail(409, 'prize not revealed yet');
        if ($day['pickedFor']) fail(409, 'already picked');
        $target = nextDayWithoutItem($data, $d);
        if (!$target) fail(409, 'no door left to fill');
        $found = false;
        foreach ($data['items'] as &$item) {
            if ($item['id'] === $itemId) {
                if ($item['assignedDay']) fail(409, 'item already assigned');
                $item['assignedDay'] = $target;
                $found = true;
            }
        }
        unset($item);
        if (!$found) fail(404, 'item not found');
        $data['days'][(string)$target]['itemId'] = $itemId;
        $day['pickedFor'] = $target;
        unset($day);
        $response = ['pickedFor' => $target];
        $save();
        break;

    case 'available':
        // Für die Auswahl durch Gewinner*in: nur freie Einträge
        $response = ['items' => array_values(array_map('publicItem',
            array_filter($data['items'], fn($i) => !$i['assignedDay'])))];
        break;

    // --- Admin --------------------------------------------------------------

    case 'close':
        requireAdmin();
        $d = dayParam();
        $round = &currentRound($data['days'][(string)$d]);
        $round['closed'] = true;
        unset($round);
        $save();
        break;

    case 'winner':
        requireAdmin();
        $d = dayParam();
        $day = &$data['days'][(string)$d];
        if ($day['winner']) fail(409, 'winner already set');
        $leaders = leaders(currentRound($day));
        if (count($leaders) !== 1) fail(409, 'no unique leader');
        $day['winner'] = $leaders[0];
        $round = &currentRound($day);
        $round['closed'] = true;
        unset($round);
        unset($day);
        $save();
        break;

    case 'tiebreak':
        requireAdmin();
        $d = dayParam();
        $day = &$data['days'][(string)$d];
        if ($day['winner']) fail(409, 'winner already set');
        $leaders = leaders(currentRound($day));
        if (count($leaders) < 2) fail(409, 'no tie at the top');
        $round = &currentRound($day);
        $round['closed'] = true;
        unset($round);
        $day['rounds'][] = ['players' => $leaders, 'rolls' => (object)[], 'closed' => false];
        unset($day);
        $save();
        break;

    case 'reveal':
        requireAdmin();
        $d = dayParam();
        if (!$data['days'][(string)$d]['winner']) fail(409, 'no winner yet');
        $data['days'][(string)$d]['revealed'] = true;
        $save();
        break;

    case 'open-until':
        requireAdmin();
        // null or '' = by date, otherwise open doors 1..value
        $value = input()['value'] ?? null;
        if ($value !== null && $value !== '') {
            $value = (int)$value;
            if ($value < 0 || $value > DAYS) fail(400, 'invalid day');
        } else {
            $value = null;
        }
        $data['settings']['openUntil'] = $value;
        $save();
        break;

    case 'day-reset':
        requireAdmin();
        $d = dayParam();
        $itemId = $data['days'][(string)$d]['itemId'];
        $pickedFor = $data['days'][(string)$d]['pickedFor'];
        $data['days'][(string)$d] = array_merge(emptyDay(), ['itemId' => $itemId, 'pickedFor' => $pickedFor]);
        $save();
        break;

    case 'items':
        requireAdmin();
        $response = ['items' => array_map(fn($i) => publicItem($i) + ['assignedDay' => $i['assignedDay']], $data['items'])];
        break;

    case 'item-save':
        requireAdmin();
        $id = param('id', false) ?: bin2hex(random_bytes(8));
        $fields = [
            'title' => mb_substr((string)param('title'), 0, 120),
            'description' => mb_substr((string)param('description', false), 0, 1000),
            'link' => (string)param('link', false),
        ];
        if ($fields['link'] && !preg_match('#^https?://#i', $fields['link'])) fail(400, 'link must start with http(s)://');
        $updated = false;
        foreach ($data['items'] as &$item) {
            if ($item['id'] === $id) {
                $item = array_merge($item, $fields);
                $updated = true;
            }
        }
        unset($item);
        if (!$updated) {
            $data['items'][] = ['id' => $id, 'image' => null, 'assignedDay' => null] + $fields;
        }
        $response = ['id' => $id];
        $save();
        break;

    case 'item-delete':
        requireAdmin();
        $id = (string)param('id');
        $item = findItem($data, $id);
        if (!$item) fail(404, 'item not found');
        if ($item['assignedDay']) fail(409, 'item is assigned to a door');
        $data['items'] = array_values(array_filter($data['items'], fn($i) => $i['id'] !== $id));
        foreach (IMAGE_TYPES as $ext) {
            @unlink("$uploadDir/$id.$ext");
        }
        $save();
        break;

    case 'upload':
        requireAdmin();
        $id = (string)param('id');
        if (!findItem($data, $id)) fail(404, 'item not found');
        $file = $_FILES['image'] ?? null;
        if (!$file || $file['error'] !== UPLOAD_ERR_OK) fail(400, 'upload failed');
        if ($file['size'] > MAX_UPLOAD_BYTES) fail(413, 'image too large (max 500 KB)');
        $mime = (new finfo(FILEINFO_MIME_TYPE))->file($file['tmp_name']);
        if (!isset(IMAGE_TYPES[$mime])) fail(415, 'only jpeg, png, webp or gif');
        if (!is_dir($uploadDir)) mkdir($uploadDir, 0775, true);
        foreach (IMAGE_TYPES as $ext) {
            @unlink("$uploadDir/$id.$ext");
        }
        move_uploaded_file($file['tmp_name'], "$uploadDir/$id." . IMAGE_TYPES[$mime]);
        foreach ($data['items'] as &$item) {
            if ($item['id'] === $id) {
                $item['image'] = "uploads/$id." . IMAGE_TYPES[$mime];
            }
        }
        unset($item);
        $save();
        break;

    case 'assign':
        requireAdmin();
        $d = dayParam();
        $itemId = param('itemId', false) ?: null;
        $previous = $data['days'][(string)$d]['itemId'];
        if ($itemId) {
            $item = findItem($data, $itemId);
            if (!$item) fail(404, 'item not found');
            if ($item['assignedDay'] && $item['assignedDay'] !== $d) fail(409, 'item already assigned');
        }
        foreach ($data['items'] as &$item) {
            if ($item['id'] === $previous) $item['assignedDay'] = null;
            if ($item['id'] === $itemId) $item['assignedDay'] = $d;
        }
        unset($item);
        $data['days'][(string)$d]['itemId'] = $itemId;
        $save();
        break;

    default:
        fail(400, 'unknown action');
}

flock($lock, LOCK_UN);
fclose($lock);

echo json_encode($response ?? calendar($data), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
