import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const WRANGLER_BIN = process.env.SAFETY_REFRESH_WRANGLER_BIN ?? 'wrangler';
const SOURCE_DB = process.env.SAFETY_REFRESH_SOURCE_DB ?? 'everybodys-platformer-db';
const TARGET_DB = process.env.SAFETY_REFRESH_TARGET_DB ?? 'everybodys-platformer-safety-db';
const HEALTHCHECK_BASE_URL =
  process.env.SAFETY_REFRESH_HEALTHCHECK_BASE_URL ??
  'https://everybodys-platformer-safety.novox-robot.workers.dev';
const OUTPUT_ROOT = 'output/db-safety-refresh';
const DRY_RUN = process.env.SAFETY_REFRESH_DRY_RUN === '1';
const ALLOW_REFRESH = process.env.SAFETY_REFRESH_FROM_PROD === '1';
const INCLUDE_EPHEMERAL_AUTH = process.env.SAFETY_REFRESH_INCLUDE_EPHEMERAL_AUTH === '1';
const WRANGLER_MAX_ATTEMPTS = parsePositiveInteger(
  process.env.SAFETY_REFRESH_WRANGLER_MAX_ATTEMPTS,
  4
);
const ADMIN_REQUEST_MAX_ATTEMPTS = parsePositiveInteger(
  process.env.SAFETY_REFRESH_ADMIN_REQUEST_MAX_ATTEMPTS,
  3
);
const ADMIN_REQUEST_TIMEOUT_MS = parsePositiveInteger(
  process.env.SAFETY_REFRESH_ADMIN_REQUEST_TIMEOUT_MS,
  120_000
);
const RETRY_DELAY_MS = parsePositiveInteger(
  process.env.SAFETY_REFRESH_RETRY_DELAY_MS,
  1_500
);
const RUN_ID = new Date().toISOString().replace(/[:.]/g, '-');
const OUTPUT_DIR = join(OUTPUT_ROOT, RUN_ID);

const INTERNAL_TABLES = new Set(['_cf_KV', 'd1_migrations']);
const DEFAULT_EPHEMERAL_AUTH_TABLES = new Set([
  'magic_link_tokens',
  'sessions',
  'wallet_challenges',
]);
const IMPORT_ORDER = [
  'users',
  'agents',
  'rooms',
  'room_versions',
  'courses',
  'course_versions',
  'course_room_refs',
  'user_stats',
  'point_events',
  'playfun_user_links',
  'api_tokens',
  'agent_tokens',
  'room_runs',
  'course_runs',
  'room_difficulty_votes',
  'chat_messages',
  'chat_admins',
  'chat_bans',
  'playfun_point_sync',
  'admin_suspicious_invalidation_audit',
];
const IMPORT_ORDER_INDEX = new Map(IMPORT_ORDER.map((table, index) => [table, index]));
const TABLE_BATCH_SIZES = {
  users: 100,
  agents: 100,
  rooms: 1,
  room_versions: 5,
  courses: 25,
  course_versions: 25,
  course_room_refs: 100,
  user_stats: 100,
  point_events: 250,
  playfun_user_links: 250,
  api_tokens: 100,
  agent_tokens: 100,
  room_runs: 250,
  course_runs: 250,
  room_difficulty_votes: 250,
  chat_messages: 100,
  chat_admins: 100,
  chat_bans: 100,
  playfun_point_sync: 100,
  admin_suspicious_invalidation_audit: 100,
};

const summary = {
  runId: RUN_ID,
  startedAt: new Date().toISOString(),
  dryRun: DRY_RUN,
  allowRefresh: ALLOW_REFRESH,
  sourceDb: SOURCE_DB,
  targetDb: TARGET_DB,
  healthcheckBaseUrl: HEALTHCHECK_BASE_URL,
  includeEphemeralAuth: INCLUDE_EPHEMERAL_AUTH,
  sourceTables: [],
  targetTables: [],
  resetTables: [],
  copiedTables: [],
  skippedTables: [],
  sourceCounts: {},
  sourceCountsEnd: {},
  targetCountsBefore: {},
  targetCountsAfter: {},
  verification: {
    matchedTables: [],
    partialTables: [],
    mismatchedTables: [],
    emptiedSkippedTables: [],
    staleSkippedTables: [],
  },
  tableRefresh: [],
  healthcheck: null,
  errors: [],
};

mkdirSync(OUTPUT_DIR, { recursive: true });

main()
  .catch((error) => {
    summary.errors.push(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(() => {
    summary.finishedAt = new Date().toISOString();
    writeSummary();
  });

async function main() {
  guardDirection();

  const sourceTables = getTables(SOURCE_DB);
  const targetTables = getTables(TARGET_DB);
  summary.sourceTables = sourceTables;
  summary.targetTables = targetTables;

  const targetTableSet = new Set(targetTables);
  const missingInTarget = sourceTables.filter((table) => !targetTableSet.has(table));
  if (missingInTarget.length > 0) {
    throw new Error(
      `Target DB is missing source tables: ${missingInTarget.join(', ')}. Run migrations before refreshing safety.`
    );
  }

  const resetTables = sourceTables.filter((table) => !INTERNAL_TABLES.has(table));
  const skippedTables = resetTables.filter((table) => shouldSkipTable(table));
  const copiedTables = sortTablesForImport(resetTables.filter((table) => !shouldSkipTable(table)));

  summary.resetTables = resetTables;
  summary.skippedTables = skippedTables;
  summary.copiedTables = copiedTables;
  summary.sourceCounts = countTables(SOURCE_DB, resetTables);
  summary.targetCountsBefore = countTables(TARGET_DB, resetTables);

  if (DRY_RUN) {
    return;
  }

  const adminApiKey = loadAdminApiKey();
  await postAdmin('/api/admin/snapshot/reset', adminApiKey, {});

  for (const table of copiedTables) {
    await refreshTable(table, adminApiKey);
  }

  summary.sourceCountsEnd = countTables(SOURCE_DB, resetTables);
  summary.targetCountsAfter = countTables(TARGET_DB, resetTables);
  verifyCounts(copiedTables, skippedTables);
  summary.healthcheck = await runHealthcheck();
}

function guardDirection() {
  if (SOURCE_DB === TARGET_DB) {
    throw new Error('Source and target D1 databases must be different.');
  }

  if (!/(safety|staging|preview|local)/i.test(TARGET_DB)) {
    throw new Error(
      `Refusing to write into target database "${TARGET_DB}" because it does not look like safety/staging/local infrastructure.`
    );
  }

  if (!DRY_RUN && !ALLOW_REFRESH) {
    throw new Error(
      'Safety refresh mutates the target database. Re-run with SAFETY_REFRESH_FROM_PROD=1 when you intend to replace safety data.'
    );
  }
}

function shouldSkipTable(table) {
  if (INTERNAL_TABLES.has(table)) {
    return true;
  }

  if (!INCLUDE_EPHEMERAL_AUTH && DEFAULT_EPHEMERAL_AUTH_TABLES.has(table)) {
    return true;
  }

  const extraExcludedTables = parseCsv(process.env.SAFETY_REFRESH_EXCLUDE_TABLES);
  if (extraExcludedTables.has(table)) {
    return true;
  }

  const limitedTables = parseCsv(process.env.SAFETY_REFRESH_INCLUDE_TABLES);
  if (limitedTables.size > 0 && !limitedTables.has(table)) {
    return true;
  }

  return false;
}

function parseCsv(value) {
  if (!value) {
    return new Set();
  }

  return new Set(
    value
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean)
  );
}

function getTables(databaseName) {
  const response = d1ExecJson(
    databaseName,
    "select name from sqlite_master where type='table' and name not like 'sqlite_%' order by name;"
  );
  return response[0]?.results?.map((row) => row.name) ?? [];
}

function countTables(databaseName, tables) {
  if (tables.length === 0) {
    return {};
  }

  const sql = tables
    .map((table) => `select '${table}' as table_name, count(*) as row_count from "${table}";`)
    .join(' ');
  const response = d1ExecJson(databaseName, sql);
  const counts = {};
  for (const statement of response) {
    const row = statement.results?.[0];
    if (row && typeof row.table_name === 'string') {
      counts[row.table_name] = Number(row.row_count ?? 0);
    }
  }
  return counts;
}

function getTableSchema(databaseName, table) {
  const response = d1ExecJson(databaseName, `PRAGMA table_info("${table}")`);
  const columns = response[0]?.results ?? [];
  const columnNames = columns.map((column) => column.name);
  const primaryKeyColumns = columns
    .filter((column) => Number(column.pk ?? 0) > 0)
    .sort((left, right) => Number(left.pk) - Number(right.pk))
    .map((column) => column.name);
  const primaryKeys = primaryKeyColumns.map(quoteIdentifier);

  return {
    columnNames,
    selectColumns: columnNames.map(quoteIdentifier).join(', '),
    orderByClause: primaryKeys.length > 0 ? primaryKeys.join(', ') : 'rowid',
    primaryKeyColumns,
    keysetColumn: primaryKeyColumns.length === 1 ? primaryKeyColumns[0] : null,
  };
}

function d1ExecJson(databaseName, sql) {
  const output = runWrangler([
    'd1',
    'execute',
    databaseName,
    '--remote',
    '--command',
    sql,
    '--json',
  ]);
  return JSON.parse(output);
}

function sortTablesForImport(tables) {
  return [...tables].sort((left, right) => {
    const leftIndex = IMPORT_ORDER_INDEX.get(left) ?? Number.MAX_SAFE_INTEGER;
    const rightIndex = IMPORT_ORDER_INDEX.get(right) ?? Number.MAX_SAFE_INTEGER;
    if (leftIndex !== rightIndex) {
      return leftIndex - rightIndex;
    }
    return left.localeCompare(right);
  });
}

async function refreshTable(table, adminApiKey) {
  const sourceCount = summary.sourceCounts[table] ?? 0;
  const batchSize = TABLE_BATCH_SIZES[table] ?? 100;
  const schema = getTableSchema(SOURCE_DB, table);
  const tableSummary = {
    table,
    sourceCount,
    batchSize,
    importedRows: 0,
    skippedRows: 0,
    requestedBatches: sourceCount === 0 ? 0 : Math.ceil(sourceCount / batchSize),
    actualBatches: 0,
    mode: 'worker-admin',
    pagination: schema.keysetColumn ? 'keyset' : 'offset',
  };
  summary.tableRefresh.push(tableSummary);
  console.info(
    `[safety-refresh] copying ${table}: ${sourceCount} rows, batchSize=${batchSize}, pagination=${tableSummary.pagination}`
  );

  if (schema.keysetColumn) {
    let lastSeenValue = null;
    while (true) {
      const rows = loadRowsByKeyset(SOURCE_DB, table, schema, batchSize, lastSeenValue);
      if (rows.length === 0) {
        break;
      }

      const result = await postAdmin(
        `/api/admin/snapshot/import/${encodeURIComponent(table)}`,
        adminApiKey,
        {
          rows,
        }
      );

      tableSummary.importedRows += Number(result?.imported ?? rows.length);
      tableSummary.skippedRows += Number(result?.skippedDueForeignKey ?? 0);
      tableSummary.actualBatches += 1;
      lastSeenValue = rows[rows.length - 1]?.[schema.keysetColumn] ?? null;
      logTableProgress(tableSummary);
    }
  } else {
    for (let offset = 0; offset < sourceCount; offset += batchSize) {
      const rows = loadRowsByOffset(SOURCE_DB, table, schema, batchSize, offset);
      if (rows.length === 0) {
        break;
      }

      const result = await postAdmin(
        `/api/admin/snapshot/import/${encodeURIComponent(table)}`,
        adminApiKey,
        {
          rows,
        }
      );

      tableSummary.importedRows += Number(result?.imported ?? rows.length);
      tableSummary.skippedRows += Number(result?.skippedDueForeignKey ?? 0);
      tableSummary.actualBatches += 1;
      logTableProgress(tableSummary);
    }
  }

  console.info(
    `[safety-refresh] finished ${table}: imported=${tableSummary.importedRows}, skipped=${tableSummary.skippedRows}, batches=${tableSummary.actualBatches}`
  );
}

function loadRowsByOffset(databaseName, table, schema, limit, offset) {
  const sql = [
    `SELECT ${schema.selectColumns}`,
    `FROM "${table}"`,
    `ORDER BY ${schema.orderByClause}`,
    `LIMIT ${limit}`,
    `OFFSET ${offset}`,
  ].join(' ');
  const response = d1ExecJson(databaseName, sql);
  return response[0]?.results ?? [];
}

function loadRowsByKeyset(databaseName, table, schema, limit, lastSeenValue) {
  if (!schema.keysetColumn) {
    throw new Error(`Keyset pagination requested for ${table} without a single-column primary key.`);
  }

  const whereClause =
    lastSeenValue === null
      ? ''
      : `WHERE ${quoteIdentifier(schema.keysetColumn)} > ${quoteSqlLiteral(lastSeenValue)}`;
  const sql = [
    `SELECT ${schema.selectColumns}`,
    `FROM "${table}"`,
    whereClause,
    `ORDER BY ${schema.orderByClause}`,
    `LIMIT ${limit}`,
  ]
    .filter(Boolean)
    .join(' ');
  const response = d1ExecJson(databaseName, sql);
  return response[0]?.results ?? [];
}

async function postAdmin(path, adminApiKey, body) {
  const baseUrl = HEALTHCHECK_BASE_URL.replace(/\/+$/, '');
  let lastError = null;

  for (let attempt = 1; attempt <= ADMIN_REQUEST_MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-key': adminApiKey,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(ADMIN_REQUEST_TIMEOUT_MS),
      });

      const text = await response.text();
      if (!response.ok) {
        throw new Error(`${path} failed: ${response.status} ${text}`);
      }

      if (!text) {
        return null;
      }

      try {
        return JSON.parse(text);
      } catch {
        return text;
      }
    } catch (error) {
      lastError = error;
      if (attempt >= ADMIN_REQUEST_MAX_ATTEMPTS) {
        break;
      }
      console.warn(
        `[safety-refresh] admin request retry ${attempt}/${ADMIN_REQUEST_MAX_ATTEMPTS - 1} for ${path}: ${formatError(error)}`
      );
      sleepMs(RETRY_DELAY_MS * attempt);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function loadAdminApiKey() {
  const direct =
    process.env.SAFETY_REFRESH_ADMIN_API_KEY?.trim() ||
    process.env.ADMIN_API_KEY?.trim();
  if (direct) {
    return direct;
  }

  const dotDevVarsPath = join(process.cwd(), '.dev.vars');
  if (existsSync(dotDevVarsPath)) {
    const raw = readFileSync(dotDevVarsPath, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) {
        continue;
      }

      const match = /^ADMIN_API_KEY=(.*)$/.exec(trimmed);
      if (!match) {
        continue;
      }

      return stripWrappingQuotes(match[1].trim());
    }
  }

  throw new Error(
    'Could not resolve ADMIN_API_KEY for safety snapshot import. Set SAFETY_REFRESH_ADMIN_API_KEY or run from a checkout with .dev.vars present.'
  );
}

function stripWrappingQuotes(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}

function quoteIdentifier(value) {
  return `"${value.replaceAll('"', '""')}"`;
}

function quoteSqlLiteral(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(value) : 'NULL';
  }

  if (typeof value === 'string') {
    return `'${value.replace(/'/g, "''")}'`;
  }

  if (value === null) {
    return 'NULL';
  }

  throw new Error(`Unsupported SQL literal value type for keyset pagination: ${typeof value}`);
}

function verifyCounts(copiedTables, skippedTables) {
  for (const table of copiedTables) {
    const sourceCount = summary.sourceCounts[table] ?? 0;
    const sourceCountEnd = summary.sourceCountsEnd[table] ?? sourceCount;
    const targetCount = summary.targetCountsAfter[table] ?? 0;
    if (targetCount === sourceCount || targetCount === sourceCountEnd) {
      summary.verification.matchedTables.push(table);
      continue;
    }

    const tableSummary = summary.tableRefresh.find((entry) => entry.table === table);
    const reconstructedCount = targetCount + Number(tableSummary?.skippedRows ?? 0);
    if (
      reconstructedCount === sourceCount ||
      reconstructedCount === sourceCountEnd
    ) {
      summary.verification.partialTables.push({
        table,
        sourceCount,
        sourceCountEnd,
        targetCount,
        skippedRows: Number(tableSummary?.skippedRows ?? 0),
      });
      continue;
    }

    summary.verification.mismatchedTables.push({
      table,
      sourceCount,
      sourceCountEnd,
      targetCount,
    });
  }

  for (const table of skippedTables) {
    const targetCount = summary.targetCountsAfter[table] ?? 0;
    if (targetCount === 0) {
      summary.verification.emptiedSkippedTables.push(table);
      continue;
    }

    summary.verification.staleSkippedTables.push({
      table,
      targetCount,
    });
  }

  if (summary.verification.mismatchedTables.length > 0) {
    throw new Error(
      `Safety refresh finished with row-count mismatches: ${summary.verification.mismatchedTables
        .map((entry) => `${entry.table} (${entry.sourceCount} vs ${entry.targetCount})`)
        .join(', ')}`
    );
  }

  if (summary.verification.staleSkippedTables.length > 0) {
    throw new Error(
      `Skipped tables were not cleared: ${summary.verification.staleSkippedTables
        .map((entry) => `${entry.table} (${entry.targetCount})`)
        .join(', ')}`
    );
  }
}

async function runHealthcheck() {
  const baseUrl = HEALTHCHECK_BASE_URL.replace(/\/+$/, '');
  const healthResponse = await fetch(`${baseUrl}/api/health`);
  const worldResponse = await fetch(`${baseUrl}/api/world?centerX=0&centerY=0&radius=1`);
  const healthJson = await healthResponse.json();
  const worldJson = await worldResponse.json();

  return {
    baseUrl,
    health: {
      status: healthResponse.status,
      ok: healthResponse.ok,
      body: healthJson,
    },
    world: {
      status: worldResponse.status,
      ok: worldResponse.ok,
      roomCount: Array.isArray(worldJson.rooms) ? worldJson.rooms.length : null,
      center: worldJson.center ?? null,
      radius: worldJson.radius ?? null,
    },
  };
}

function runWrangler(args) {
  let lastError = null;

  for (let attempt = 1; attempt <= WRANGLER_MAX_ATTEMPTS; attempt += 1) {
    try {
      return execFileSync(WRANGLER_BIN, args, {
        encoding: 'utf8',
        env: process.env,
        maxBuffer: 1024 * 1024 * 128,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      lastError = error;
      if (attempt >= WRANGLER_MAX_ATTEMPTS) {
        break;
      }
      console.warn(
        `[safety-refresh] wrangler retry ${attempt}/${WRANGLER_MAX_ATTEMPTS - 1} for ${args.join(' ')}: ${formatError(error)}`
      );
      sleepMs(RETRY_DELAY_MS * attempt);
    }
  }

  const commandText = [WRANGLER_BIN, ...args].join(' ');
  throw new Error(`${formatError(lastError)}\ncommand: ${commandText}`);
}

function writeSummary() {
  writeFileSync(join(OUTPUT_DIR, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
}

function logTableProgress(tableSummary) {
  if (tableSummary.actualBatches === 1 || tableSummary.actualBatches === tableSummary.requestedBatches) {
    return;
  }

  if (tableSummary.actualBatches % 5 !== 0) {
    return;
  }

  console.info(
    `[safety-refresh] ${tableSummary.table}: batch ${tableSummary.actualBatches}/${tableSummary.requestedBatches}, imported=${tableSummary.importedRows}, skipped=${tableSummary.skippedRows}`
  );
}

function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function sleepMs(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function formatError(error) {
  if (error instanceof Error) {
    const stderr = typeof error.stderr === 'string' ? error.stderr.trim() : '';
    return stderr ? `${error.message}\n${stderr}` : error.message;
  }

  return String(error);
}
