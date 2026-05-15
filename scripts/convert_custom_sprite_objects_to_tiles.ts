import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import {
  convertCustomSpriteObjectsToRoomTiles,
  type ConvertCustomSpriteObjectsToRoomTilesResult,
} from '../src/customTiles/migration.ts';
import { LAYER_NAMES, type LayerName } from '../src/config.ts';
import type { RoomSnapshot } from '../src/persistence/roomModel.ts';

interface Options {
  env: string | null;
  remote: boolean;
  apply: boolean;
  roomId: string | null;
  includeVersions: boolean;
  snapshotFile: string | null;
  outputFile: string | null;
  spriteIds: string[];
  layers: LayerName[];
  overwriteExistingTiles: boolean;
}

interface RoomRowRecord {
  id: string;
  draft_json: string;
  published_json: string | null;
}

interface RoomVersionRowRecord {
  room_id: string;
  version: number;
  snapshot_json: string;
}

const SQL_TEXT_CHUNK_SIZE = 6_000;

function parseArgs(argv: string[]): Options {
  let env: string | null = null;
  let remote = true;
  let apply = false;
  let roomId: string | null = null;
  let includeVersions = true;
  let snapshotFile: string | null = null;
  let outputFile: string | null = null;
  const spriteIds: string[] = [];
  let layers: LayerName[] = [...LAYER_NAMES];
  let overwriteExistingTiles = false;

  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === '--env' && next) {
      env = next;
      index += 1;
      continue;
    }
    if (arg === '--local') {
      remote = false;
      continue;
    }
    if (arg === '--remote') {
      remote = true;
      continue;
    }
    if (arg === '--apply') {
      apply = true;
      continue;
    }
    if (arg === '--room' && next) {
      roomId = next;
      index += 1;
      continue;
    }
    if (arg === '--no-versions') {
      includeVersions = false;
      continue;
    }
    if (arg === '--snapshot-file' && next) {
      snapshotFile = next;
      index += 1;
      continue;
    }
    if (arg === '--output-file' && next) {
      outputFile = next;
      index += 1;
      continue;
    }
    if (arg === '--sprite' && next) {
      spriteIds.push(...splitCsv(next));
      index += 1;
      continue;
    }
    if (arg === '--layers' && next) {
      layers = parseLayers(next);
      index += 1;
      continue;
    }
    if (arg === '--overwrite-existing-tiles') {
      overwriteExistingTiles = true;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (roomId && !/^-?\d+,-?\d+$/.test(roomId)) {
    throw new Error(`Invalid room id: ${roomId}`);
  }

  return {
    env,
    remote,
    apply,
    roomId,
    includeVersions,
    snapshotFile,
    outputFile,
    spriteIds,
    layers,
    overwriteExistingTiles,
  };
}

function splitCsv(value: string): string[] {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function parseLayers(value: string): LayerName[] {
  const parsed = splitCsv(value);
  if (parsed.length === 0) {
    throw new Error('At least one layer is required.');
  }

  for (const layer of parsed) {
    if (!(LAYER_NAMES as readonly string[]).includes(layer)) {
      throw new Error(`Invalid layer: ${layer}`);
    }
  }

  return parsed as LayerName[];
}

function sqlStringLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function runWranglerJson(command: string, options: Pick<Options, 'env' | 'remote'>): unknown {
  const args = ['wrangler', 'd1', 'execute', 'DB'];
  if (options.env) {
    args.push('--env', options.env);
  }
  args.push(options.remote ? '--remote' : '--local', '--command', command, '--json');
  const stdout = execFileSync('npx', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return JSON.parse(stdout);
}

function runWranglerStatements(
  statements: readonly string[],
  options: Pick<Options, 'env' | 'remote'>,
): void {
  for (const statement of statements) {
    runWranglerJson(statement, options);
  }
}

function extractResults<T>(payload: unknown): T[] {
  if (!Array.isArray(payload) || payload.length === 0) {
    throw new Error('Unexpected Wrangler response payload.');
  }

  const first = payload[0] as { success?: boolean; results?: T[]; error?: string };
  if (!first || first.success !== true || !Array.isArray(first.results)) {
    throw new Error(`Wrangler query failed: ${JSON.stringify(first)}`);
  }

  return first.results;
}

function buildLargeTextUpdateStatements(
  tableName: string,
  columnName: string,
  value: string | null,
  whereClause: string,
): string[] {
  if (value === null) {
    return [`UPDATE ${tableName} SET ${columnName} = NULL WHERE ${whereClause}`];
  }

  const statements = [`UPDATE ${tableName} SET ${columnName} = '' WHERE ${whereClause}`];
  for (let offset = 0; offset < value.length; offset += SQL_TEXT_CHUNK_SIZE) {
    statements.push(
      `UPDATE ${tableName} SET ${columnName} = ${columnName} || ${sqlStringLiteral(
        value.slice(offset, offset + SQL_TEXT_CHUNK_SIZE),
      )} WHERE ${whereClause}`,
    );
  }
  return statements;
}

function loadRoomRows(options: Options): RoomRowRecord[] {
  const whereClause = options.roomId ? ` WHERE id = ${sqlStringLiteral(options.roomId)}` : '';
  const command = `SELECT id, draft_json, published_json FROM rooms${whereClause} ORDER BY id`;
  return extractResults<RoomRowRecord>(runWranglerJson(command, options));
}

function loadRoomVersionRows(options: Options): RoomVersionRowRecord[] {
  if (!options.includeVersions) {
    return [];
  }

  const whereClause = options.roomId
    ? ` WHERE room_id = ${sqlStringLiteral(options.roomId)}`
    : '';
  const command =
    `SELECT room_id, version, snapshot_json FROM room_versions${whereClause} ORDER BY room_id, version`;
  return extractResults<RoomVersionRowRecord>(runWranglerJson(command, options));
}

function updateRoomRow(
  row: RoomRowRecord,
  draftJson: string,
  publishedJson: string | null,
  options: Options,
): void {
  const whereClause = `id = ${sqlStringLiteral(row.id)}`;
  runWranglerStatements([
    ...buildLargeTextUpdateStatements('rooms', 'draft_json', draftJson, whereClause),
    ...buildLargeTextUpdateStatements('rooms', 'published_json', publishedJson, whereClause),
  ], options);
}

function updateRoomVersionRow(
  row: RoomVersionRowRecord,
  snapshotJson: string,
  options: Options,
): void {
  runWranglerStatements(
    buildLargeTextUpdateStatements(
      'room_versions',
      'snapshot_json',
      snapshotJson,
      `room_id = ${sqlStringLiteral(row.room_id)} AND version = ${row.version}`,
    ),
    options,
  );
}

function convertSnapshot(snapshot: RoomSnapshot, options: Options): ConvertCustomSpriteObjectsToRoomTilesResult {
  return convertCustomSpriteObjectsToRoomTiles(snapshot, {
    spriteIds: options.spriteIds,
    layers: options.layers,
    overwriteExistingTiles: options.overwriteExistingTiles,
  });
}

function summarizeResult(result: ConvertCustomSpriteObjectsToRoomTilesResult) {
  return {
    changed: result.changed,
    convertedObjectCount: result.convertedObjectCount,
    skippedObjectCount: result.skippedObjectCount,
    customTileCountBefore: result.customTileCountBefore,
    customTileCountAfter: result.customTileCountAfter,
  };
}

function runSnapshotFileMode(options: Options): void {
  if (!options.snapshotFile) {
    throw new Error('Missing snapshot file path.');
  }

  const raw = fs.readFileSync(options.snapshotFile, 'utf8');
  const result = convertSnapshot(JSON.parse(raw) as RoomSnapshot, options);
  const outputPath = options.outputFile ?? options.snapshotFile;

  if (options.apply) {
    fs.writeFileSync(outputPath, JSON.stringify(result.snapshot));
  }

  console.log(JSON.stringify({
    mode: 'snapshot-file',
    snapshotFile: options.snapshotFile,
    outputFile: options.apply ? outputPath : null,
    apply: options.apply,
    spriteIds: options.spriteIds,
    layers: options.layers,
    overwriteExistingTiles: options.overwriteExistingTiles,
    summary: summarizeResult(result),
  }, null, 2));
}

function main(): void {
  const options = parseArgs(process.argv);
  if (options.snapshotFile) {
    runSnapshotFileMode(options);
    return;
  }

  const roomRows = loadRoomRows(options);
  const versionRows = loadRoomVersionRows(options);
  let changedRoomRows = 0;
  let changedVersionRows = 0;
  let convertedObjectCount = 0;
  let skippedObjectCount = 0;

  for (const row of roomRows) {
    const draftResult = convertSnapshot(JSON.parse(row.draft_json) as RoomSnapshot, options);
    const publishedResult = row.published_json
      ? convertSnapshot(JSON.parse(row.published_json) as RoomSnapshot, options)
      : null;

    if (draftResult.changed || publishedResult?.changed) {
      changedRoomRows += 1;
      convertedObjectCount += draftResult.convertedObjectCount + (publishedResult?.convertedObjectCount ?? 0);
      skippedObjectCount += draftResult.skippedObjectCount + (publishedResult?.skippedObjectCount ?? 0);

      if (options.apply) {
        updateRoomRow(
          row,
          JSON.stringify(draftResult.snapshot),
          publishedResult ? JSON.stringify(publishedResult.snapshot) : row.published_json,
          options,
        );
      }
    }
  }

  for (const row of versionRows) {
    const result = convertSnapshot(JSON.parse(row.snapshot_json) as RoomSnapshot, options);
    if (!result.changed) {
      skippedObjectCount += result.skippedObjectCount;
      continue;
    }

    changedVersionRows += 1;
    convertedObjectCount += result.convertedObjectCount;
    skippedObjectCount += result.skippedObjectCount;
    if (options.apply) {
      updateRoomVersionRow(row, JSON.stringify(result.snapshot), options);
    }
  }

  console.log(JSON.stringify({
    mode: 'd1',
    env: options.env,
    remote: options.remote,
    apply: options.apply,
    roomId: options.roomId,
    includeVersions: options.includeVersions,
    spriteIds: options.spriteIds,
    layers: options.layers,
    overwriteExistingTiles: options.overwriteExistingTiles,
    changedRoomRows,
    changedVersionRows,
    convertedObjectCount,
    skippedObjectCount,
  }, null, 2));
}

main();
