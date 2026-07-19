import { describe, expect, it } from 'vitest';
import {
  classifyManifestEntry,
  parsePngDimensions,
  parseWorldTileParityArgs,
  percentile,
} from './world_tile_parity_probe.mjs';

describe('world tile parity probe contracts', () => {
  it('accepts only explicit API/version and immutable Pages renderer inputs', () => {
    const args = parseWorldTileParityArgs([
      'node',
      'script',
      '--api-base',
      'https://everybodys-platformer-safety.example.workers.dev/',
      '--renderer-origin',
      'https://a1b2c3d4.wampland.pages.dev',
      '--renderer-version',
      'renderer-2026-07-19',
      '--bounds',
      '-8,7,-4,11',
    ]);
    expect(args.apiBase).toBe('https://everybodys-platformer-safety.example.workers.dev');
    expect(args.rendererOrigin).toBe('https://a1b2c3d4.wampland.pages.dev');
    expect(args.bounds).toEqual({ minTileX: -8, maxTileX: 7, minTileY: -4, maxTileY: 11 });

    expect(() => parseWorldTileParityArgs([
      'node', 'script',
      '--api-base', 'https://safety.example',
      '--renderer-origin', 'https://main.wampland.pages.dev',
      '--renderer-version', 'renderer-a',
    ])).toThrow('immutable');
  });

  it('distinguishes current objects, empty markers, stale, and missing coverage', () => {
    const base = {
      desiredGeneration: 3,
      desiredEmpty: false,
      readyEmptyGeneration: null,
      ready: null,
      staleRoomIds: [],
    };
    expect(classifyManifestEntry(base).missing).toBe(true);
    expect(classifyManifestEntry({
      ...base,
      ready: { generation: 3 },
    }).readyObjectCurrent).toBe(true);
    expect(classifyManifestEntry({
      ...base,
      desiredEmpty: true,
      readyEmptyGeneration: 3,
    }).readyEmptyCurrent).toBe(true);
    expect(classifyManifestEntry({
      ...base,
      ready: { generation: 2 },
      staleRoomIds: ['0,0'],
    }).stale).toBe(true);
  });

  it('reads PNG IHDR dimensions and uses nearest-rank percentiles', () => {
    const png = Buffer.alloc(24);
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(png, 0);
    png.write('IHDR', 12, 'ascii');
    png.writeUInt32BE(642, 16);
    png.writeUInt32BE(354, 20);
    expect(parsePngDimensions(png)).toEqual({ width: 642, height: 354 });
    expect(percentile([10, 40, 20, 30, 50], 0.5)).toBe(30);
    expect(percentile([10, 40, 20, 30, 50], 0.95)).toBe(50);
  });
});
