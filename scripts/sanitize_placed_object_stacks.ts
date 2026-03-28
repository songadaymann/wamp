import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { cloneRoomSnapshot, type RoomSnapshot } from '../src/persistence/roomModel.ts';
import { getPlacedObjectAnchorCell } from '../src/placedObjects/occupancy.ts';
import type { PlacedObject } from '../src/config.ts';

interface Options {
  env: string | null;
  remote: boolean;
  apply: boolean;
  roomId: string | null;
  includeVersions: boolean;
  snapshotFile: string | null;
  outputFile: string | null;
}

interface SnapshotSanitizeSummary {
  changed: boolean;
  placedObjectCountBefore: number;
  placedObjectCountAfter: number;
  duplicateAnchorCellsBefore: number;
  duplicateAnchorCellsAfter: number;
  sanitizedSnapshot: RoomSnapshot;
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

function parseArgs(argv: string[]): Options {
  let env: string | null = null;
  let remote = true;
  let apply = false;
  let roomId: string | null = null;
  let includeVersions = true;
  let snapshotFile: string | null = null;
  let outputFile: string | null = null;

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
  };
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

function countDuplicateAnchorCells(placedObjects: PlacedObject[]): number {
  const counts = new Map<string, number>();

  for (const placed of placedObjects) {
    const cell = getPlacedObjectAnchorCell(placed);
    if (!cell) {
      continue;
    }

    const key = `${cell.tileX},${cell.tileY},${cell.layer}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  let duplicates = 0;
  for (const count of counts.values()) {
    if (count > 1) {
      duplicates += 1;
    }
  }
  return duplicates;
}

function sanitizeSnapshot(snapshot: RoomSnapshot): SnapshotSanitizeSummary {
  const beforeCount = snapshot.placedObjects.length;
  const duplicateAnchorCellsBefore = countDuplicateAnchorCells(snapshot.placedObjects);
  const sanitizedSnapshot = cloneRoomSnapshot(snapshot);
  const afterCount = sanitizedSnapshot.placedObjects.length;
  const duplicateAnchorCellsAfter = countDuplicateAnchorCells(sanitizedSnapshot.placedObjects);

  return {
    changed: JSON.stringify(snapshot) !== JSON.stringify(sanitizedSnapshot),
    placedObjectCountBefore: beforeCount,
    placedObjectCountAfter: afterCount,
    duplicateAnchorCellsBefore,
    duplicateAnchorCellsAfter,
    sanitizedSnapshot,
  };
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
  const publishedSql = publishedJson === null ? 'NULL' : sqlStringLiteral(publishedJson);
  const command = `
    UPDATE rooms
    SET draft_json = ${sqlStringLiteral(draftJson)},
        published_json = ${publishedSql}
    WHERE id = ${sqlStringLiteral(row.id)}
  `;
  runWranglerJson(command, options);
}

function updateRoomVersionRow(
  row: RoomVersionRowRecord,
  snapshotJson: string,
  options: Options,
): void {
  const command = `
    UPDATE room_versions
    SET snapshot_json = ${sqlStringLiteral(snapshotJson)}
    WHERE room_id = ${sqlStringLiteral(row.room_id)}
      AND version = ${row.version}
  `;
  runWranglerJson(command, options);
}

function runSnapshotFileMode(options: Options): void {
  if (!options.snapshotFile) {
    throw new Error('Missing snapshot file path.');
  }

  const raw = fs.readFileSync(options.snapshotFile, 'utf8');
  const snapshot = JSON.parse(raw) as RoomSnapshot;
  const summary = sanitizeSnapshot(snapshot);
  const outputPath = options.outputFile ?? options.snapshotFile;

  if (options.apply) {
    fs.writeFileSync(outputPath, JSON.stringify(summary.sanitizedSnapshot));
  }

  console.log(
    JSON.stringify(
      {
        mode: 'snapshot-file',
        snapshotFile: options.snapshotFile,
        outputFile: options.apply ? outputPath : null,
        apply: options.apply,
        summary: {
          changed: summary.changed,
          placedObjectCountBefore: summary.placedObjectCountBefore,
          placedObjectCountAfter: summary.placedObjectCountAfter,
          duplicateAnchorCellsBefore: summary.duplicateAnchorCellsBefore,
          duplicateAnchorCellsAfter: summary.duplicateAnchorCellsAfter,
        },
      },
      null,
      2,
    ),
  );
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
  let removedPlacedObjects = 0;
  let removedDuplicateAnchorCells = 0;

  for (const row of roomRows) {
    const draftSummary = sanitizeSnapshot(JSON.parse(row.draft_json) as RoomSnapshot);
    const publishedSummary = row.published_json
      ? sanitizeSnapshot(JSON.parse(row.published_json) as RoomSnapshot)
      : null;

    if (draftSummary.changed || publishedSummary?.changed) {
      changedRoomRows += 1;
      removedPlacedObjects +=
        (draftSummary.placedObjectCountBefore - draftSummary.placedObjectCountAfter) +
        ((publishedSummary?.placedObjectCountBefore ?? 0) -
          (publishedSummary?.placedObjectCountAfter ?? 0));
      removedDuplicateAnchorCells +=
        (draftSummary.duplicateAnchorCellsBefore - draftSummary.duplicateAnchorCellsAfter) +
        ((publishedSummary?.duplicateAnchorCellsBefore ?? 0) -
          (publishedSummary?.duplicateAnchorCellsAfter ?? 0));

      if (options.apply) {
        updateRoomRow(
          row,
          JSON.stringify(draftSummary.sanitizedSnapshot),
          publishedSummary ? JSON.stringify(publishedSummary.sanitizedSnapshot) : row.published_json,
          options,
        );
      }
    }
  }

  for (const row of versionRows) {
    const summary = sanitizeSnapshot(JSON.parse(row.snapshot_json) as RoomSnapshot);
    if (!summary.changed) {
      continue;
    }

    changedVersionRows += 1;
    removedPlacedObjects += summary.placedObjectCountBefore - summary.placedObjectCountAfter;
    removedDuplicateAnchorCells +=
      summary.duplicateAnchorCellsBefore - summary.duplicateAnchorCellsAfter;

    if (options.apply) {
      updateRoomVersionRow(row, JSON.stringify(summary.sanitizedSnapshot), options);
    }
  }

  console.log(
    JSON.stringify(
      {
        mode: 'd1',
        env: options.env,
        remote: options.remote,
        apply: options.apply,
        roomId: options.roomId,
        includeVersions: options.includeVersions,
        changedRoomRows,
        changedVersionRows,
        removedPlacedObjects,
        removedDuplicateAnchorCells,
      },
      null,
      2,
    ),
  );
}

main();
