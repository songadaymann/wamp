import { listReferencedR2Keys } from './store';
import type { D1Database, R2Bucket } from './runtimeTypes';

export interface WorldTileGarbageCollectionOptions {
  dryRun: boolean;
  maximumDeletes?: number;
  maximumScanned?: number;
  minimumAgeDays?: number;
  now?: Date;
}

export interface WorldTileGarbageCollectionResult {
  candidateBytes: number;
  candidateCount: number;
  deletedCount: number;
  dryRun: boolean;
  minimumAgeDays: number;
  sampleKeys: string[];
  scannedCount: number;
  truncated: boolean;
}

const MINIMUM_ALLOWED_AGE_DAYS = 30;
const DEFAULT_MAXIMUM_DELETES = 500;
const DEFAULT_MAXIMUM_SCANNED = 50_000;

/**
 * Deletes only old content-addressed objects that no ready D1 pointer references.
 * There is deliberately no prefix-wide or lifecycle-rule deletion path.
 */
export async function collectUnreferencedWorldTileObjects(
  db: D1Database,
  bucket: R2Bucket,
  options: WorldTileGarbageCollectionOptions
): Promise<WorldTileGarbageCollectionResult> {
  const minimumAgeDays = Math.max(MINIMUM_ALLOWED_AGE_DAYS, options.minimumAgeDays ?? 30);
  const maximumDeletes = clampPositiveInteger(options.maximumDeletes, DEFAULT_MAXIMUM_DELETES, 2_000);
  const maximumScanned = clampPositiveInteger(options.maximumScanned, DEFAULT_MAXIMUM_SCANNED, 250_000);
  const now = options.now ?? new Date();
  const cutoff = now.getTime() - minimumAgeDays * 86_400_000;
  const referenced = await listReferencedR2Keys(db);
  const candidates: Array<{ key: string; size: number }> = [];
  let cursor: string | undefined;
  let scannedCount = 0;
  let listTruncated = false;

  do {
    const page = await bucket.list({ cursor, limit: 1_000, prefix: 'world-tiles/' });
    for (const object of page.objects) {
      scannedCount += 1;
      if (
        object.uploaded.getTime() < cutoff
        && !referenced.has(object.key)
        && candidates.length < maximumDeletes
      ) {
        candidates.push({ key: object.key, size: object.size });
      }
      if (scannedCount >= maximumScanned) {
        break;
      }
    }
    cursor = page.truncated ? page.cursor : undefined;
    listTruncated = Boolean(cursor);
  } while (cursor && scannedCount < maximumScanned && candidates.length < maximumDeletes);

  if (!options.dryRun && candidates.length > 0) {
    for (let index = 0; index < candidates.length; index += 100) {
      await bucket.delete(candidates.slice(index, index + 100).map((candidate) => candidate.key));
    }
  }

  return {
    candidateBytes: candidates.reduce((total, candidate) => total + candidate.size, 0),
    candidateCount: candidates.length,
    deletedCount: options.dryRun ? 0 : candidates.length,
    dryRun: options.dryRun,
    minimumAgeDays,
    sampleKeys: candidates.slice(0, 20).map((candidate) => candidate.key),
    scannedCount,
    truncated: listTruncated || scannedCount >= maximumScanned || candidates.length >= maximumDeletes,
  };
}

function clampPositiveInteger(value: number | undefined, fallback: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    return fallback;
  }
  return Math.min(value, maximum);
}
