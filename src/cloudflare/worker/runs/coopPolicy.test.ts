import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultCourseSnapshot } from '../../../courses/model';
import type { PlacedObject } from '../../../config';
import type { RoomDiscoveryEntry } from '../../../runs/model';
import { fixture, NOW, run } from '../activity/testDatabase';
import { assertSoloCourseRun, assertSoloRoomRun, attachCoopDiscoveryFlags } from './coopPolicy';
import { handleRunFinish, handleRunStart } from './routes';
import { startGuestRun } from '../guestRuns/attempts';
import { loadGuestRunSnapshot } from '../guestRuns/snapshots';
vi.mock('../auth/request', async original => ({ ...await original<object>(),
  requireAuthenticatedRequestAuth: async () => ({ user: { id: 'p1', displayName: 'Player' }, source: 'session', isAdmin: false }),
}));

let f: ReturnType<typeof fixture>;
beforeEach(() => { f = fixture(); });
afterEach(() => { f.sqlite.close(); });
const plate = { id: 'floor_trigger', instanceId: 'plate', x: 88, y: 296, coopPlate: true };
function version(version: number, objects: PlacedObject[]) {
  const snapshot = { ...f.record.published!, version, placedObjects: objects };
  f.sqlite.prepare(`INSERT OR REPLACE INTO room_versions(room_id,version,snapshot_json,title,created_at,published_by_user_id)
    VALUES ('0,0',?,?, 'Co-op test',?,'builder')`).run(version, JSON.stringify(snapshot), NOW);
  return snapshot;
}
const entry = (roomVersion = 1): RoomDiscoveryEntry => ({ roomId: '0,0', roomVersion } as RoomDiscoveryEntry);
function index(version: number, cellVersion: number) {
  const key = `expanded_room:coop:${version}`;
  f.sqlite.prepare(`INSERT INTO playable_content_index(target_key,target_type,content_id,version_key,representative_room_id,
    room_x,room_y,published_at,first_published_at,anchor_x,anchor_y,source_type,updated_at)
    VALUES (?,'expanded_room','coop',?,'0,0',0,0,?,?,0,0,'native_expanded_room',?)`).run(key, version, NOW, NOW, NOW);
  f.sqlite.prepare('INSERT INTO playable_content_index_members(target_key,room_id,room_version) VALUES (?,\'0,0\',?)').run(key, cellVersion);
  return { ...entry(), expandedRoom: { expandedRoomId: 'coop', expandedRoomVersion: version, source: 'native_expanded_room' } } as RoomDiscoveryEntry;
}

describe('co-op solo policy on exact published snapshots', () => {
  it('blocks the actual signed start/finish and guest snapshot/start paths without creating a ranked receipt', async () => {
    const snapshot = version(1, [plate]);
    f.sqlite.prepare('UPDATE rooms SET published_json=? WHERE id=\'0,0\'').run(JSON.stringify(snapshot));
    const request = (body: object) => new Request('https://api.wamp.land/api/runs/start', {
      method: 'POST', headers: { Origin: 'https://wamp.land', 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    await expect(handleRunStart(request({ roomId: '0,0', roomCoordinates: { x: 0, y: 0 }, roomVersion: 1, goal: snapshot.goal }), f.env))
      .rejects.toMatchObject({ status: 400 });
    const guestBody = { clientRunId: 'coop-review-client', contentType: 'room' as const, contentId: '0,0', version: 1 };
    await expect(loadGuestRunSnapshot(f.env, guestBody)).rejects.toMatchObject({ status: 400 });
    await expect(startGuestRun(f.env, { guestUserId: 'guest-coop-review', recoveryTokenHash: 'test-hash' }, guestBody))
      .rejects.toMatchObject({ status: 400 });
    run(f, 'legacy-coop-start'); f.sqlite.prepare('UPDATE room_runs SET result=\'active\' WHERE attempt_id=\'legacy-coop-start\'').run();
    await expect(handleRunFinish(request({ result: 'completed', elapsedMs: 1000, deaths: 0,
      collectiblesCollected: 0, enemyCollectiblesCollected: 0, enemiesDefeated: 0, checkpointsReached: 0 }), f.env, 'legacy-coop-start'))
      .rejects.toMatchObject({ status: 400 });
    expect(f.sqlite.prepare('SELECT result FROM room_runs WHERE attempt_id=\'legacy-coop-start\'').get()).toMatchObject({ result: 'active' });
    expect(f.sqlite.prepare('SELECT COUNT(*) AS n FROM guest_run_attempts').get()).toMatchObject({ n: 0 });
  });

  it('rejects co-op rooms but keeps ordinary and decorative plates eligible', () => {
    expect(() => assertSoloRoomRun(version(1, [plate]))).toThrow(/Co-op practice/);
    for (const object of [{ ...plate, coopPlate: false }, { ...plate, layer: 'background' as const }, { ...plate, id: 'coin_gold' }]) {
      expect(() => assertSoloRoomRun(version(1, [object]))).not.toThrow();
    }
  });
  it('checks pinned course cells in bounded batches, including a co-op cell after the first page', async () => {
    version(1, [plate]); version(2, [{ ...plate, coopPlate: false }]);
    const course = createDefaultCourseSnapshot('coop');
    course.roomRefs = Array.from({ length: 81 }, (_, i) => ({ roomId: '0,0', roomVersion: i === 80 ? 1 : 2,
      coordinates: { x: 0, y: 0 }, roomTitle: null }));
    const prepare = vi.spyOn(f.env.DB, 'prepare');
    await expect(assertSoloCourseRun(f.env, course)).rejects.toMatchObject({ status: 400 });
    expect(prepare).toHaveBeenCalledTimes(3);
    course.roomRefs[80].roomVersion = 2;
    await expect(assertSoloCourseRun(f.env, course)).resolves.toBeUndefined();
  });
  it('matches strict JSON booleans and layer normalization for pinned cells', async () => {
    const course = createDefaultCourseSnapshot('coop');
    course.roomRefs = [{ roomId: '0,0', roomVersion: 1, coordinates: { x: 0, y: 0 }, roomTitle: null }];
    for (const object of [{ ...plate, coopPlate: 1 }, { ...plate, coopPlate: 'true' }, { ...plate, layer: 'foreground' }, { ...plate, id: 'crate' }]) {
      version(1, [object as PlacedObject]);
      await expect(assertSoloCourseRun(f.env, course)).resolves.toBeUndefined();
    }
    version(1, [{ ...plate, layer: 'legacy-unknown' } as unknown as PlacedObject]);
    await expect(assertSoloCourseRun(f.env, course)).rejects.toMatchObject({ status: 400 });
  });
  it('labels ordinary and expanded discovery targets by their exact member versions', async () => {
    version(1, [plate]); version(2, [{ ...plate, coopPlate: false }]);
    const coopArea = index(1, 1), soloArea = index(2, 2);
    const entries = [entry(1), entry(2), coopArea, soloArea];
    expect((await attachCoopDiscoveryFlags(f.env, entries)).map(item => item.cooperative)).toEqual([true, false, true, false]);
    expect(entries[0].cooperative).toBeUndefined();
    expect(await attachCoopDiscoveryFlags(f.env, [])).toEqual([]);
    expect((await attachCoopDiscoveryFlags(f.env, Array.from({ length: 61 }, () => entry(1)))).every(item => item.cooperative)).toBe(true);
  });
});
