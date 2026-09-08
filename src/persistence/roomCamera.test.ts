import { describe, expect, it } from 'vitest';
import { cloneRoomSnapshot, createDefaultRoomSnapshot, createRoomVersionRecord, isRoomSnapshotBlank } from './roomModel';
import { buildRoomVersionFingerprint } from './roomVersionLineage';
import { parseRoomSnapshot } from '../cloudflare/worker/core/http';

describe('room camera persistence', () => {
  it('round-trips centered mode through API normalization, snapshot clones, and published history', async () => {
    const snapshot = createDefaultRoomSnapshot();
    snapshot.cameraMode = 'room';
    expect(isRoomSnapshotBlank(snapshot)).toBe(false);
    const parsed = await parseRoomSnapshot(new Request('https://example.test/api/rooms/0,0', {
      method: 'PUT', body: JSON.stringify(snapshot),
    }), snapshot.id);
    expect(parsed.cameraMode).toBe('room');
    expect(cloneRoomSnapshot(parsed).cameraMode).toBe('room');
    expect(createRoomVersionRecord(parsed).snapshot.cameraMode).toBe('room');
  });

  it('defaults legacy rooms to follow without changing their gameplay fingerprint', () => {
    const snapshot = createDefaultRoomSnapshot();
    const explicitFollow = buildRoomVersionFingerprint(snapshot);
    delete snapshot.cameraMode;
    expect(cloneRoomSnapshot(snapshot).cameraMode).toBe('follow');
    expect(buildRoomVersionFingerprint(snapshot)).toBe(explicitFollow);
    snapshot.cameraMode = 'room';
    expect(buildRoomVersionFingerprint(snapshot)).not.toBe(explicitFollow);
  });
});
