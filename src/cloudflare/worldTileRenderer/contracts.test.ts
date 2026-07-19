import { describe, expect, it } from 'vitest';
import {
  buildParentDesiredHash,
  buildWorldTileR2Key,
  floorDivide,
  getChildAddresses,
  getParentAddress,
  parseWorldTileRenderJob,
  resolveParentReadiness,
  type WorldRenderTileRow,
  type WorldTileAddress,
} from './contracts';

describe('world tile renderer contracts', () => {
  it('uses mathematical floor division and maps signed coordinates across zero', () => {
    expect(floorDivide(-1, 2)).toBe(-1);
    expect(floorDivide(-2, 2)).toBe(-1);
    expect(floorDivide(-3, 2)).toBe(-2);
    expect(getParentAddress(address(4, -1, 1))).toEqual(address(3, -1, 0));
    expect(getChildAddresses(address(3, -1, -1)).map(({ x, y }) => [x, y])).toEqual([
      [-2, -2],
      [-1, -2],
      [-2, -1],
      [-1, -1],
    ]);
  });

  it('accepts the versioned queue payload and rejects unsafe or private additions', () => {
    expect(parseWorldTileRenderJob({
      schemaVersion: 1,
      rendererVersion: '2026-07-19.a1',
      level: 4,
      x: -12,
      y: 9,
      generation: 3,
      reason: 'published-change',
      enqueuedAt: '2026-07-19T12:00:00.000Z',
    })).toMatchObject({ x: -12, y: 9, generation: 3 });

    expect(() => parseWorldTileRenderJob({
      schemaVersion: 1,
      rendererVersion: 'v1',
      level: 5,
      x: 0,
      y: 0,
      generation: 1,
      reason: 'bad-level',
      enqueuedAt: '2026-07-19T12:00:00.000Z',
    })).toThrow(/level/i);
    expect(() => parseWorldTileRenderJob({
      schemaVersion: 1,
      rendererVersion: 'v1',
      level: 4,
      x: Number.MAX_SAFE_INTEGER + 1,
      y: 0,
      generation: 1,
      reason: 'unsafe-coordinate',
      enqueuedAt: '2026-07-19T12:00:00.000Z',
    })).toThrow(/safe integer/i);
  });

  it('waits for stale children and treats absent or ready-empty children as transparent', () => {
    const parent = address(3, -1, 0);
    const stale = row(4, -2, 0, { desired_generation: 2, ready_generation: 1 });
    expect(resolveParentReadiness(parent, [stale])).toEqual({
      kind: 'waiting',
      waiting: [address(4, -2, 0)],
    });

    const empty = row(4, -2, 0, { desired_empty: 1, ready_empty: 1 });
    expect(resolveParentReadiness(parent, [empty])).toEqual({ kind: 'empty' });
  });

  it('returns canonical sibling slots and a content-addressed immutable key', () => {
    const parent = address(3, 0, 0);
    const hash = 'a'.repeat(64);
    const content = row(4, 1, 0, { ready_hash: hash, r2_key: 'old/key.png' });
    const readiness = resolveParentReadiness(parent, [content]);
    expect(readiness).toMatchObject({
      kind: 'ready',
      sources: [{ slot: 'northEast', contentHash: hash }],
    });
    if (readiness.kind !== 'ready') {
      throw new Error('Expected ready parent.');
    }
    expect(buildParentDesiredHash(readiness.sources)).toBe(
      `northWest:empty|northEast:${hash}|southWest:empty|southEast:empty`
    );
    expect(buildWorldTileR2Key(address(4, -2, 8), hash)).toBe(
      `world-tiles/test-renderer/objects/${hash}.png`
    );
    expect(buildWorldTileR2Key(address(0, 99, -40), hash)).toBe(
      buildWorldTileR2Key(address(4, -2, 8), hash)
    );
  });
});

function address(level: 0 | 1 | 2 | 3 | 4, x: number, y: number): WorldTileAddress {
  return { rendererVersion: 'test-renderer', level, x, y };
}

function row(
  level: number,
  tileX: number,
  tileY: number,
  overrides: Partial<WorldRenderTileRow> = {}
): WorldRenderTileRow {
  return {
    renderer_version: 'test-renderer',
    level,
    tile_x: tileX,
    tile_y: tileY,
    desired_generation: 1,
    desired_hash: null,
    desired_empty: 0,
    ready_generation: 1,
    ready_hash: 'b'.repeat(64),
    ready_empty: 0,
    r2_key: 'world-tiles/child.png',
    r2_etag: 'etag',
    byte_length: 100,
    lease_owner: null,
    lease_generation: null,
    lease_expires_at: null,
    attempts: 1,
    last_error: null,
    desired_at: '2026-07-19T00:00:00.000Z',
    ready_at: '2026-07-19T00:00:00.000Z',
    created_at: '2026-07-19T00:00:00.000Z',
    updated_at: '2026-07-19T00:00:00.000Z',
    ...overrides,
  };
}
