import { requireAdminRequest } from '../auth/request';
import { HttpError, jsonResponse, parseJsonBody } from '../core/http';
import type { Env } from '../core/types';
import { countRows } from '../maintenance/routes';

const SNAPSHOT_TABLES = [
  'admin_suspicious_invalidation_audit',
  'agent_tokens',
  'agents',
  'api_tokens',
  'chat_admins',
  'chat_bans',
  'chat_messages',
  'course_room_refs',
  'course_runs',
  'course_versions',
  'courses',
  'magic_link_tokens',
  'playfun_point_sync',
  'playfun_user_links',
  'point_events',
  'room_difficulty_votes',
  'room_runs',
  'room_versions',
  'rooms',
  'sessions',
  'user_stats',
  'users',
  'wallet_challenges',
] as const;

const IMPORT_BATCH_SIZE = 50;

type SnapshotTableName = (typeof SNAPSHOT_TABLES)[number];

interface SnapshotImportRequestBody {
  rows: Array<Record<string, unknown>>;
}

export async function handleAdminSnapshotReset(request: Request, env: Env): Promise<Response> {
  requireAdminRequest(env, request, 'reset safety snapshot tables');

  const deleted = Object.fromEntries(
    await Promise.all(
      SNAPSHOT_TABLES.map(async (tableName) => [tableName, await countRows(env, tableName)])
    )
  );

  await env.DB.batch(SNAPSHOT_TABLES.map((tableName) => env.DB.prepare(`DELETE FROM "${tableName}"`)));

  return jsonResponse(request, {
    ok: true,
    deleted,
  });
}

export async function handleAdminSnapshotImport(
  request: Request,
  env: Env,
  tableName: string
): Promise<Response> {
  requireAdminRequest(env, request, `import safety snapshot rows into ${tableName}`);

  if (!isSnapshotTableName(tableName)) {
    throw new HttpError(400, 'Unsupported snapshot import table.');
  }

  const body = await parseJsonBody<SnapshotImportRequestBody>(request);
  const rows = Array.isArray(body?.rows) ? body.rows : [];
  if (rows.length === 0) {
    return jsonResponse(request, {
      ok: true,
      table: tableName,
      imported: 0,
    });
  }

  const columnNames = await loadColumnNames(env, tableName);
  const columnList = columnNames.map(quoteIdentifier).join(', ');
  const placeholderList = columnNames.map(() => '?').join(', ');
  const insertSql = `INSERT OR REPLACE INTO "${tableName}" (${columnList}) VALUES (${placeholderList})`;

  let imported = 0;
  let skippedDueForeignKey = 0;
  for (let index = 0; index < rows.length; index += IMPORT_BATCH_SIZE) {
    const batchRows = rows.slice(index, index + IMPORT_BATCH_SIZE);
    const result = await insertRowsResilient(env, insertSql, columnNames, batchRows);
    imported += result.imported;
    skippedDueForeignKey += result.skippedDueForeignKey;
  }

  return jsonResponse(request, {
    ok: true,
    table: tableName,
    imported,
    skippedDueForeignKey,
  });
}

function isSnapshotTableName(value: string): value is SnapshotTableName {
  return SNAPSHOT_TABLES.includes(value as SnapshotTableName);
}

async function loadColumnNames(env: Env, tableName: SnapshotTableName): Promise<string[]> {
  const result = await env.DB.prepare(`PRAGMA table_info("${tableName}")`).all<{ name: string }>();
  const columnNames = result.results.map((row) => row.name).filter(Boolean);
  if (columnNames.length === 0) {
    throw new HttpError(500, `Could not load column metadata for ${tableName}.`);
  }
  return columnNames;
}

function quoteIdentifier(value: string): string {
  return `"${value.split('"').join('""')}"`;
}

function normalizeBoundValue(value: unknown): unknown {
  if (value === undefined) {
    return null;
  }

  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number'
  ) {
    return value;
  }

  if (typeof value === 'boolean') {
    return value ? 1 : 0;
  }

  return JSON.stringify(value);
}

async function insertRowsResilient(
  env: Env,
  insertSql: string,
  columnNames: string[],
  rows: Array<Record<string, unknown>>
): Promise<{ imported: number; skippedDueForeignKey: number }> {
  if (rows.length === 0) {
    return { imported: 0, skippedDueForeignKey: 0 };
  }

  try {
    await env.DB.batch(
      rows.map((row) =>
        env.DB.prepare(insertSql).bind(
          ...columnNames.map((columnName) => normalizeBoundValue(row[columnName]))
        )
      )
    );
    return {
      imported: rows.length,
      skippedDueForeignKey: 0,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes('FOREIGN KEY constraint failed')) {
      throw error;
    }

    if (rows.length === 1) {
      return {
        imported: 0,
        skippedDueForeignKey: 1,
      };
    }

    const midpoint = Math.floor(rows.length / 2);
    const left = await insertRowsResilient(env, insertSql, columnNames, rows.slice(0, midpoint));
    const right = await insertRowsResilient(env, insertSql, columnNames, rows.slice(midpoint));
    return {
      imported: left.imported + right.imported,
      skippedDueForeignKey: left.skippedDueForeignKey + right.skippedDueForeignKey,
    };
  }
}
