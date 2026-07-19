import {
  WORLD_TILE_IMAGE_HEIGHT,
  WORLD_TILE_IMAGE_WIDTH,
  WORLD_TILE_OVERLAP,
  floorDivide,
  getWorldTileChildren,
  getWorldTileParent,
  isWorldTileLevel,
  type WorldTileAddress,
  type WorldTileLevel,
} from '../../worldTiles/model';

export const WORLD_TILE_JOB_SCHEMA_VERSION = 1 as const;
export const WORLD_TILE_RENDER_WIDTH = WORLD_TILE_IMAGE_WIDTH;
export const WORLD_TILE_RENDER_HEIGHT = WORLD_TILE_IMAGE_HEIGHT;
export const WORLD_TILE_RENDER_OVERLAP = WORLD_TILE_OVERLAP;

export { floorDivide };
export type { WorldTileAddress, WorldTileLevel };

export interface WorldTileRenderJob extends WorldTileAddress {
  schemaVersion: typeof WORLD_TILE_JOB_SCHEMA_VERSION;
  generation: number;
  reason: string;
  enqueuedAt: string;
}

export interface WorldRenderTileRow {
  renderer_version: string;
  level: number;
  tile_x: number;
  tile_y: number;
  desired_generation: number;
  desired_hash: string | null;
  desired_empty: number;
  ready_generation: number | null;
  ready_hash: string | null;
  ready_empty: number | null;
  r2_key: string | null;
  r2_etag: string | null;
  byte_length: number | null;
  lease_owner: string | null;
  lease_generation: number | null;
  lease_expires_at: string | null;
  attempts: number;
  last_error: string | null;
  desired_at: string;
  ready_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface WorldTileRendererVersionRow {
  version: string;
  status: 'building' | 'active' | 'retired' | 'failed';
  render_origin: string;
  renderer_contract_hash: string;
  asset_contract_hash: string;
}

export type ParentChildSlot = 'northWest' | 'northEast' | 'southWest' | 'southEast';

export interface ParentChildSource {
  address: WorldTileAddress;
  contentHash: string;
  key: string;
  slot: ParentChildSlot;
}

export type ParentReadiness =
  | { kind: 'waiting'; waiting: WorldTileAddress[] }
  | { kind: 'empty' }
  | { kind: 'ready'; sources: ParentChildSource[] };

const VERSION_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;
const HASH_PATTERN = /^[a-f0-9]{64}$/;

export function parseWorldTileRenderJob(value: unknown): WorldTileRenderJob {
  if (!isRecord(value)) {
    throw new Error('World tile job must be an object.');
  }
  if (value.schemaVersion !== WORLD_TILE_JOB_SCHEMA_VERSION) {
    throw new Error(`Unsupported world tile job schema ${String(value.schemaVersion)}.`);
  }

  const rendererVersion = requireRendererVersion(value.rendererVersion);
  const level = requireWorldTileLevel(value.level);
  const x = requireSafeInteger(value.x, 'x');
  const y = requireSafeInteger(value.y, 'y');
  const generation = requirePositiveInteger(value.generation, 'generation');
  const reason = requireBoundedText(value.reason, 'reason', 160);
  const enqueuedAt = requireIsoDate(value.enqueuedAt, 'enqueuedAt');
  return {
    schemaVersion: WORLD_TILE_JOB_SCHEMA_VERSION,
    rendererVersion,
    level,
    x,
    y,
    generation,
    reason,
    enqueuedAt,
  };
}

export function requireWorldTileLevel(value: unknown): WorldTileLevel {
  if (typeof value !== 'number' || !isWorldTileLevel(value)) {
    throw new Error(`World tile level must be an integer from 0 through 4; received ${String(value)}.`);
  }
  return value as WorldTileLevel;
}

export function getParentAddress(address: WorldTileAddress): WorldTileAddress | null {
  const parent = getWorldTileParent(address);
  if (!parent) {
    return null;
  }
  return {
    rendererVersion: address.rendererVersion,
    ...parent,
  };
}

export function getChildAddresses(address: WorldTileAddress): Array<WorldTileAddress & { slot: ParentChildSlot }> {
  const slots: ParentChildSlot[] = ['northWest', 'northEast', 'southWest', 'southEast'];
  return getWorldTileChildren(address).map((child, index) => ({
    rendererVersion: address.rendererVersion,
    ...child,
    slot: slots[index],
  }));
}

export function resolveParentReadiness(
  address: WorldTileAddress,
  rows: readonly WorldRenderTileRow[]
): ParentReadiness {
  const rowsByKey = new Map(rows.map((row) => [`${row.level}:${row.tile_x}:${row.tile_y}`, row]));
  const waiting: WorldTileAddress[] = [];
  const sources: ParentChildSource[] = [];

  for (const child of getChildAddresses(address)) {
    const row = rowsByKey.get(`${child.level}:${child.x}:${child.y}`);
    if (!row) {
      continue;
    }
    const current = row.ready_generation === row.desired_generation;
    if (!current || row.ready_empty === null || row.ready_empty !== row.desired_empty) {
      waiting.push(stripChildSlot(child));
      continue;
    }
    if (row.ready_empty === 1) {
      continue;
    }
    if (row.ready_empty !== 0 || !row.r2_key || !row.ready_hash) {
      waiting.push(stripChildSlot(child));
      continue;
    }
    sources.push({
      address: child,
      contentHash: row.ready_hash,
      key: row.r2_key,
      slot: child.slot,
    });
  }

  if (waiting.length > 0) {
    return { kind: 'waiting', waiting };
  }
  if (sources.length === 0) {
    return { kind: 'empty' };
  }
  return { kind: 'ready', sources };
}

function stripChildSlot(child: WorldTileAddress & { slot: ParentChildSlot }): WorldTileAddress {
  return {
    rendererVersion: child.rendererVersion,
    level: child.level,
    x: child.x,
    y: child.y,
  };
}

export function buildWorldTileR2Key(address: WorldTileAddress, contentHash: string): string {
  if (!HASH_PATTERN.test(contentHash)) {
    throw new Error('World tile content hash must be a lowercase SHA-256 hex digest.');
  }
  requireWorldTileLevel(address.level);
  requireSafeInteger(address.x, 'x');
  requireSafeInteger(address.y, 'y');
  return [
    'world-tiles',
    encodeURIComponent(requireRendererVersion(address.rendererVersion)),
    'objects',
    `${contentHash}.png`,
  ].join('/');
}

export function buildParentDesiredHash(sources: readonly ParentChildSource[]): string {
  const bySlot = new Map(sources.map((source) => [source.slot, source.contentHash]));
  return (['northWest', 'northEast', 'southWest', 'southEast'] as const)
    .map((slot) => `${slot}:${bySlot.get(slot) ?? 'empty'}`)
    .join('|');
}

function requireRendererVersion(value: unknown): string {
  if (typeof value !== 'string' || !VERSION_PATTERN.test(value)) {
    throw new Error('rendererVersion must contain 1-128 URL-safe characters.');
  }
  return value;
}

function requireSafeInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new Error(`${label} must be a safe integer.`);
  }
  return value;
}

function requirePositiveInteger(value: unknown, label: string): number {
  const integer = requireSafeInteger(value, label);
  if (integer < 1) {
    throw new Error(`${label} must be at least 1.`);
  }
  return integer;
}

function requireBoundedText(value: unknown, label: string, maximumLength: number): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > maximumLength) {
    throw new Error(`${label} must contain 1-${maximumLength} characters.`);
  }
  return value;
}

function requireIsoDate(value: unknown, label: string): string {
  const text = requireBoundedText(value, label, 64);
  if (!Number.isFinite(Date.parse(text))) {
    throw new Error(`${label} must be an ISO timestamp.`);
  }
  return text;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
