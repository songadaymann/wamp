import { describe, expect, it, vi } from 'vitest';
import { ROOM_WIDTH, ROOM_HEIGHT, getTilesetByKey, SPECIAL_TILE_ONE_WAY_PLATFORM_GID, encodeTileDataValue } from '../../config';
import { createDefaultRoomSnapshot } from '../../persistence/roomModel';
import { smartSemanticCellKey } from '../../autotiling/model';
import { CUSTOM_ROOM_TILE_FIRST_GID } from '../../customTiles/model';
import { EditorEdgeGuideCache, getStandingEdgeOpenings, type RoomEdgeSide } from './edgeGuides';

const SOLID = getTilesetByKey('forest')!.firstGid + 14;
function room(x = 0, y = 0) { return createDefaultRoomSnapshot(`${x},${y}`, { x, y }); }
function seal(r: ReturnType<typeof room>) { r.tileData.terrain.forEach(row => row.fill(SOLID)); return r; }
function neighbor(x: number, y: number) { const r = room(x, y); r.status = 'published'; return r; }

describe('standing-player edge geometry', () => {
  it('excludes one-tile crouch passages and accepts two-tile headroom', () => {
    const r = seal(room()); r.tileData.terrain[10][0] = -1;
    expect(getStandingEdgeOpenings(r, 'left').some(Boolean)).toBe(false);
    r.tileData.terrain[11][0] = -1;
    const open = getStandingEdgeOpenings(r, 'left');
    expect(open[173]).toBe(1); expect(open[179]).toBe(1); expect(open[180]).toBe(0);
  });
  it('checks a full standing-height vertical entry rather than only the border row', () => {
    const r = seal(room()); r.tileData.terrain[0][10] = -1;
    expect(getStandingEdgeOpenings(r, 'top').some(Boolean)).toBe(false);
    r.tileData.terrain[1][10] = -1;
    expect(getStandingEdgeOpenings(r, 'top')[165]).toBe(1);
    r.tileData.terrain[0][10] = encodeTileDataValue(SOLID, true, true);
    expect(getStandingEdgeOpenings(r, 'top').some(Boolean)).toBe(false);
  });
  it('treats runtime one-way and projected Smart Background platforms as pass-through hints', () => {
    const r = room(); r.tileData.terrain[5][0] = SPECIAL_TILE_ONE_WAY_PLATFORM_GID;
    r.smartTerrain!.semanticCells[smartSemanticCellKey('background', 0, 6)] = { styleId: 'forest', brushId: 'forest.ground' };
    expect(getStandingEdgeOpenings(r, 'left')[88]).toBe(1);
    expect(getStandingEdgeOpenings(r, 'left')[104]).toBe(1);
    r.tileData.terrain[5][0] = SOLID; expect(getStandingEdgeOpenings(r, 'left')[88]).toBe(0);
  });
  it('respects custom tile collision rather than treating decoration as a wall', () => {
    const r = room(); r.customTiles = [{ id: 'tile', name: 'Edge', pixels: Array(256).fill(null), collision: 'none', createdAt: '', updatedAt: '' }];
    r.tileData.terrain[5][0] = CUSTOM_ROOM_TILE_FIRST_GID;
    expect(getStandingEdgeOpenings(r, 'left')[88]).toBe(1);
    r.customTiles[0].collision = 'solid'; expect(getStandingEdgeOpenings(r, 'left')[88]).toBe(0);
  });
  it('includes initial solid object footprints but ignores decoration layers and moving NPCs', () => {
    const r = room(); r.placedObjects = [{ id: 'crate', instanceId: 'c', x: 8, y: 88, layer: 'terrain' }];
    expect(getStandingEdgeOpenings(r, 'left')[88]).toBe(0);
    r.placedObjects[0].layer = 'background'; expect(getStandingEdgeOpenings(r, 'left')[88]).toBe(1);
    r.placedObjects = [{ id: 'jimothy', instanceId: 'n', x: 8, y: 88, layer: 'terrain' }];
    expect(getStandingEdgeOpenings(r, 'left')[88]).toBe(1);
  });
});

describe('cached neighbor edge guides', () => {
  it('shows connected and blocked openings, empty space and only orthogonal published neighbors', () => {
    const r = room(), right = seal(neighbor(1, 0)), left = neighbor(-1, 0), diagonal = neighbor(1, 1), draft = room(0, 1);
    const cache = new EditorEdgeGuideCache(); cache.sync(true, 1, 1, 'ready', () => r, [right, left, diagonal, draft]);
    expect(cache.summary).toEqual({ connectedNeighbors: 1, openSides: 4, status: 'ready' });
    expect(cache.guides.some(g => g.side === 'left' && g.state === 'connected')).toBe(true);
    expect(cache.guides.some(g => g.side === 'right' && g.state === 'blocked')).toBe(true);
    expect(cache.guides.some(g => g.side === 'bottom' && g.state === 'open-space')).toBe(true);
  });
  it('requires shared player clearance, not just overlapping raw empty cells', () => {
    const r = seal(room()), right = seal(neighbor(1, 0));
    for (const y of [10, 11]) r.tileData.terrain[y][ROOM_WIDTH - 1] = -1;
    for (const y of [11, 12]) right.tileData.terrain[y][0] = -1;
    const cache = new EditorEdgeGuideCache(); cache.sync(true, 1, 1, 'ready', () => r, [right]);
    expect(cache.summary.connectedNeighbors).toBe(0); expect(cache.guides.every(g => g.state === 'blocked')).toBe(true);
  });
  it('does no repeated-frame exports and recomputes on document or neighbor revision changes', () => {
    const own = vi.fn(() => room()), cache = new EditorEdgeGuideCache();
    cache.sync(true, 1, 1, 'ready', own, []); const guides = cache.guides;
    for (let i = 0; i < 300; i++) expect(cache.sync(true, 1, 1, 'ready', own, [])).toBe(false);
    expect(own).toHaveBeenCalledTimes(1); expect(cache.guides).toBe(guides);
    cache.sync(true, 1, 2, 'ready', own, [neighbor(1, 0)]); expect(own).toHaveBeenCalledTimes(1);
    cache.sync(true, 2, 2, 'ready', own, []); expect(own).toHaveBeenCalledTimes(2);
  });
  it('refreshes a changed neighbor version and keeps loading/errors unknown', () => {
    const r = room(), n = neighbor(1, 0), cache = new EditorEdgeGuideCache();
    cache.sync(true, 1, 1, 'ready', () => r, [n]); expect(cache.summary.connectedNeighbors).toBe(1);
    seal(n); n.version++; cache.sync(true, 1, 2, 'ready', () => r, [n]); expect(cache.summary.connectedNeighbors).toBe(0);
    cache.sync(true, 1, 3, 'loading', () => r, [n]); expect(cache.guides).toEqual([]);
    cache.sync(true, 1, 4, 'error', () => r, []); expect(cache.guides).toEqual([]); expect(cache.summary.status).toBe('error');
  });
  it('clears disabled/Expanded seam guides once without per-frame exports and resets room ownership', () => {
    const own = vi.fn(() => room()), cache = new EditorEdgeGuideCache();
    cache.sync(true, 1, 1, 'ready', own, []); expect(cache.sync(false, 1, 1, 'ready', own, [])).toBe(true);
    for (let i = 0; i < 20; i++) expect(cache.sync(false, 1, 1, 'ready', own, [])).toBe(false);
    expect(cache.guides).toEqual([]); expect(own).toHaveBeenCalledTimes(1);
    cache.reset(); cache.sync(true, 1, 1, 'ready', own, []); expect(own).toHaveBeenCalledTimes(2);
  });
  it('sealed geometry has zero open sides without inventing a neighbor connection', () => {
    const r = seal(room()), cache = new EditorEdgeGuideCache();
    cache.sync(true, 1, 1, 'ready', () => r, []); expect(cache.summary.openSides).toBe(0); expect(cache.guides).toEqual([]);
    expect(r.tileData.terrain).toHaveLength(ROOM_HEIGHT);
    for (const side of ['left', 'right', 'top', 'bottom'] as RoomEdgeSide[]) expect(getStandingEdgeOpenings(r, side).some(Boolean)).toBe(false);
  });
});
