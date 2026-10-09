import { describe, expect, it } from 'vitest';
import { cloneRoomSnapshot, createDefaultRoomSnapshot, createRoomVersionRecord } from '../persistence/roomModel';
import { buildRoomVersionFingerprint } from '../persistence/roomVersionLineage';
import { getManualRoomLeaderboardSourceValidationError } from '../persistence/roomLeaderboardLineage';
import { computeRoomSnapshotVerificationHash } from '../cloudflare/worker/runs/verification';
import { coopPlateActorTouches, hasCoopPressurePlates, isCoopPressurePlate } from './coopPressurePlates';

describe('co-op plate persistence and solo lineage', () => {
  it('requires an explicit boolean on a gameplay floor plate and round-trips that opt-in', () => {
    const room = createDefaultRoomSnapshot();
    room.placedObjects = [
      { id: 'floor_trigger', instanceId: 'coop', x: 88, y: 296, coopPlate: true },
      { id: 'floor_trigger', instanceId: 'solo', x: 104, y: 296, coopPlate: false },
      { id: 'floor_trigger', instanceId: 'decorative', x: 120, y: 296, layer: 'background', coopPlate: true },
      { id: 'coin_gold', instanceId: 'coin', x: 136, y: 296, coopPlate: true },
    ];
    const saved = cloneRoomSnapshot(room);
    expect(saved.placedObjects.map(object => object.coopPlate)).toEqual([true, null, null, null]);
    expect(hasCoopPressurePlates(saved.placedObjects)).toBe(true);
    for (const coopPlate of [1, 'true', null, false, undefined]) {
      expect(isCoopPressurePlate({ id: 'floor_trigger', coopPlate } as never)).toBe(false);
    }
    expect(isCoopPressurePlate({ id: 'floor_trigger', layer: 'foreground', coopPlate: true })).toBe(false);
  });

  it('preserves default fingerprints/hashes and separates co-op versions from solo records', async () => {
    const solo = createDefaultRoomSnapshot();
    solo.goal = { type: 'reach_exit', exit: { x: 500, y: 304 }, timeLimitMs: null };
    solo.placedObjects = [{ id: 'floor_trigger', instanceId: 'plate', x: 88, y: 296 }];
    const disabled = cloneRoomSnapshot(solo);
    disabled.placedObjects[0].coopPlate = false;
    expect(buildRoomVersionFingerprint(disabled)).toBe(buildRoomVersionFingerprint(solo));
    expect(await computeRoomSnapshotVerificationHash(disabled)).toBe(await computeRoomSnapshotVerificationHash(solo));
    const coop = cloneRoomSnapshot(solo); coop.placedObjects[0].coopPlate = true; coop.version = 2;
    expect(buildRoomVersionFingerprint(coop)).not.toBe(buildRoomVersionFingerprint(solo));
    expect(await computeRoomSnapshotVerificationHash(coop)).not.toBe(await computeRoomSnapshotVerificationHash(solo));
    const source = createRoomVersionRecord({ ...solo, version: 1 });
    const target = createRoomVersionRecord(coop);
    expect(getManualRoomLeaderboardSourceValidationError(target, source)).toMatch(/Co-op practice/);
    expect(getManualRoomLeaderboardSourceValidationError(
      createRoomVersionRecord({ ...solo, version: 3 }), target,
    )).toMatch(/Co-op practice/);
  });
});

describe('live player foot contact', () => {
  const bounds = { x: 80, y: 298, width: 16, height: 8 };
  it('only presses the same physical cell with feet on the plate', () => {
    expect(coopPlateActorTouches({ roomId: '0,0', x: 88, feetY: 304 }, '0,0', bounds)).toBe(true);
    expect(coopPlateActorTouches({ roomId: '1,0', x: 88, feetY: 304 }, '0,0', bounds)).toBe(false);
    expect(coopPlateActorTouches({ roomId: '0,0', x: 102, feetY: 304 }, '0,0', bounds)).toBe(false);
    expect(coopPlateActorTouches({ roomId: '0,0', x: 88, feetY: 290 }, '0,0', bounds)).toBe(false);
    expect(coopPlateActorTouches({ roomId: '0,0', x: NaN, feetY: 304 }, '0,0', bounds)).toBe(false);
    expect(coopPlateActorTouches({ roomId: '0,0', x: 88, feetY: Infinity }, '0,0', bounds)).toBe(false);
  });
});
