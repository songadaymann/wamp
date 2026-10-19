import { expect, it } from 'vitest';
import { createDefaultRoomSnapshot } from '../../persistence/roomModel';
import { getTilesetByKey, SPECIAL_TILESET_FIRST_GID, SPECIAL_TILE_LOCAL_INDICES } from '../../config';
import { isSafeAssistGround } from './assistSafeRespawn';
const ground = getTilesetByKey('forest')!.firstGid + 14;
function room() { const r = createDefaultRoomSnapshot(); for (let x = 0; x < 40; x++) r.tileData.terrain[19][x] = ground; return r; }
it('accepts standing clearance with stable full-width ground and rejects edges and absent support', () => {
  const r = room(); expect(isSafeAssistGround(r, { x: 100, y: 304 }, 14, 40, [])).toBe(true);
  expect(isSafeAssistGround(r, { x: 12, y: 304 }, 14, 40, [])).toBe(false);
  r.tileData.terrain[19][6] = -1;
  expect(isSafeAssistGround(r, { x: 100, y: 304 }, 14, 40, [])).toBe(false);
});
it('rejects low ceilings, special tiles and hazards within a full tile of the standing body', () => {
  const r = room(); r.tileData.terrain[17][6] = ground;
  expect(isSafeAssistGround(r, { x: 100, y: 304 }, 14, 40, [])).toBe(false);
  r.tileData.terrain[17][6] = -1; r.tileData.terrain[19][7] = SPECIAL_TILESET_FIRST_GID + SPECIAL_TILE_LOCAL_INDICES.crumbling;
  expect(isSafeAssistGround(r, { x: 100, y: 304 }, 14, 40, [])).toBe(false);
  r.tileData.terrain[19][7] = ground;
  expect(isSafeAssistGround(r, { x: 100, y: 304 }, 14, 40, [{ left: 116, right: 140, top: 280, bottom: 304 }])).toBe(false);
  expect(isSafeAssistGround(r, { x: 100, y: 304 }, 14, 40, [{ left: 200, right: 230, top: 280, bottom: 304 }])).toBe(true);
});

it('revalidates anchors against scope, room replacement and new hazards before respawning', async () => {
  const { OverworldAssistSafeRespawn } = await import('./assistSafeRespawn');
  const { updateAssistSettings } = await import('../../settings/assistSettings');
  updateAssistSettings({ safeRespawn: true });
  let owner = {}, now = 100, active = true;
  const r = room(); const loaded = { room: r, liveObjects: [] as unknown[], terrainLayer: { getTileAtWorldXY: () => ({ index: ground }) } };
  const body = { enable: true, blocked: { down: true }, touching: { down: false }, velocity: { y: 0 }, center: { x: 100 }, bottom: 304, width: 10 };
  const controller = new OverworldAssistSafeRespawn({ active: () => active, owner: () => owner, now: () => now, getBody: () => body,
    getRoom: () => loaded, findRoom: () => loaded, allRooms: () => [loaded], getOrigin: () => ({ x: 0, y: 0 }), standingHeight: 40 } as never);
  controller.capture(); expect(controller.getCheckpoint()).toMatchObject({ x: 100, y: 304 });
  controller.grantProtection(); expect(controller.isProtected()).toBe(true); now += 1001; expect(controller.isProtected()).toBe(false);
  loaded.liveObjects.push({ config: { category: 'hazard' }, sprite: { active: true, getBounds: () => ({ left: 100, right: 120, top: 280, bottom: 304 }) } });
  expect(controller.getCheckpoint()).toBeNull(); loaded.liveObjects.length = 0; controller.capture(); expect(controller.getCheckpoint()).not.toBeNull();
  owner = {}; expect(controller.getCheckpoint()).toBeNull(); now += 200; controller.capture(); loaded.room = room(); expect(controller.getCheckpoint()).toBeNull();
  active = false; controller.capture(); expect(controller.describe()).toEqual({ checkpoint: null, protected: false });
  updateAssistSettings({ safeRespawn: false });
});
