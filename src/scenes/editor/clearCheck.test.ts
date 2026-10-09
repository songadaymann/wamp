import { describe, expect, it } from 'vitest';
import { SPECIAL_TILE_ONE_WAY_PLATFORM_GID } from '../../config';
import { createDefaultRoomSnapshot } from '../../persistence/roomModel';
import { buildRoomTemplate } from '../../templates/roomTemplates';
import { buildEditorPlayModeData } from './playMode';
import { buildReadyToPublishChecklist, getEditorDraftFingerprint, hasEditorDraftClear, recordEditorDraftClear, type ClearCheckStorage } from './clearCheck';

function room() { return buildRoomTemplate(createDefaultRoomSnapshot('6,9', { x: 6, y: 9 }), 'flat_run', 'forest'); }
function storage(): ClearCheckStorage & { values: Map<string, string> } {
  const values = new Map<string, string>(); return { values, getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); } };
}
const complete = { roomId: '6,9', roomStatus: 'draft', result: 'completed', qualificationState: 'qualified' };

describe('advisory editor Clear Check', () => {
  it('keeps sealed-room and unavailable-neighbor guidance advisory without changing publish eligibility', () => {
    const snapshot = room(), store = storage(), base = buildReadyToPublishChecklist(snapshot, store);
    for (const status of ['ready', 'loading', 'error'] as const) {
      const check = buildReadyToPublishChecklist(snapshot, store, { connectedNeighbors: 0, openSides: 0, status });
      expect(check.ready).toBe(base.ready); expect(check.publishError).toBe(base.publishError);
      expect(check.rows.find(r => r.id === 'connections')?.state).toBe('optional');
    }
    expect(buildReadyToPublishChecklist(snapshot, store, { connectedNeighbors: 0, openSides: 0, status: 'ready' }).rows.at(-1)?.detail).toMatch(/keep this room sealed/);
    expect(buildReadyToPublishChecklist(snapshot, store, { connectedNeighbors: 2, openSides: 2, status: 'ready' }).rows.at(-1)?.detail).toMatch(/2 connected neighbors/);
  });
  it('records an authored-start editor clear and recovers only for its exact snapshot', () => {
    const snapshot = room(); const store = storage();
    const data = buildEditorPlayModeData({ roomCoordinates: snapshot.coordinates, roomSnapshot: snapshot, usePublishedCourseRoomVersion: true, coursePreview: null, courseEditedRoom: null });
    expect(data.draftRoom).toEqual(snapshot); expect(data.publishedRoom).toBeNull();
    // A refresh reset would discard this exact draft and load the published room.
    expect(data.forceRefreshAround).toBe(false);
    expect(recordEditorDraftClear(data.editorPlaytestReturnTarget?.clearCheck, complete, store)).toBe(true);
    expect(buildReadyToPublishChecklist(snapshot, store).cleared).toBe(true);
    const changed = structuredClone(snapshot); changed.tileData.terrain[18][3] = 13;
    expect(hasEditorDraftClear(changed, store)).toBe(false);
    expect(hasEditorDraftClear(snapshot, store)).toBe(true);
    const reloaded = { ...snapshot, version: 9, status: 'published' as const, updatedAt: 'later', publishedAt: 'later' };
    expect(hasEditorDraftClear(reloaded, store)).toBe(true);
    expect(hasEditorDraftClear({ ...snapshot, title: 'Changed title' }, store)).toBe(false);
    expect(hasEditorDraftClear({ ...snapshot, playerHearts: 3 }, store)).toBe(false);
  });

  it('excludes cursor practice, failed or unqualified runs, other rooms and published runs', () => {
    const snapshot = room(); const store = storage();
    const data = buildEditorPlayModeData({ roomCoordinates: snapshot.coordinates, roomSnapshot: snapshot, usePublishedCourseRoomVersion: false, coursePreview: null, courseEditedRoom: null, practiceStart: { x: 500, y: 320 } });
    expect(data.draftRoom?.spawnPoint).toEqual({ x: 500, y: 320 }); expect(snapshot.spawnPoint?.x).toBe(56);
    expect(recordEditorDraftClear(data.editorPlaytestReturnTarget?.clearCheck, complete, store)).toBe(false);
    const binding = { roomId: snapshot.id, fingerprint: getEditorDraftFingerprint(snapshot), eligible: true };
    for (const patch of [{ result: 'failed' }, { qualificationState: 'practice' }, { roomId: '7,9' }, { roomStatus: 'published' }]) expect(recordEditorDraftClear(binding, { ...complete, ...patch }, store)).toBe(false);
    expect(hasEditorDraftClear(snapshot, store)).toBe(false); expect(store.values.size).toBe(0);
  });

  it('does not attach a standalone proof to a course editor test', () => {
    const snapshot = room();
    const data = buildEditorPlayModeData({ roomCoordinates: snapshot.coordinates, roomSnapshot: snapshot, usePublishedCourseRoomVersion: true, coursePreview: null, courseEditedRoom: { courseId: 'course', roomId: snapshot.id } });
    expect(data.editorPlaytestReturnTarget?.clearCheck).toBeUndefined(); expect(data.publishedRoom).toBe(snapshot);
    expect(data.forceRefreshAround).toBe(true);
  });

  it('handles storage failures and malformed receipts, and retains only twenty rooms', () => {
    const snapshot = room(); const binding = { roomId: snapshot.id, fingerprint: getEditorDraftFingerprint(snapshot), eligible: true };
    const broken = { getItem: () => 'broken JSON', setItem: () => { throw new Error('Quota'); } };
    expect(recordEditorDraftClear(binding, complete, broken)).toBe(true); expect(hasEditorDraftClear(snapshot, broken)).toBe(true);
    const store = storage();
    for (let x = 0; x < 30; x += 1) {
      const s = { ...snapshot, id: `${x},9`, coordinates: { x, y: 9 } };
      recordEditorDraftClear({ roomId: s.id, fingerprint: getEditorDraftFingerprint(s), eligible: true }, { ...complete, roomId: s.id }, store);
    }
    expect(JSON.parse([...store.values.values()][0])).toHaveLength(20);
    expect(hasEditorDraftClear({ ...snapshot, id: '0,9', coordinates: { x: 0, y: 9 } }, store)).toBe(false);
  });

  it('supports automatic starts and goal-free exploration without adding publish blockers', () => {
    const snapshot = room(); snapshot.spawnPoint = null; snapshot.goal = null;
    const checklist = buildReadyToPublishChecklist(snapshot, storage());
    expect(checklist.rows.find(row => row.id === 'start')?.state).toBe('ready');
    expect(checklist.rows.find(row => row.id === 'goal')?.state).toBe('optional');
    expect(checklist.rows.find(row => row.id === 'clear')?.state).toBe('optional');
    expect(checklist.publishError).toBeNull(); expect(checklist.ready).toBe(true);
    const blank = buildReadyToPublishChecklist(createDefaultRoomSnapshot('0,0', { x: 0, y: 0 }), storage());
    expect(blank.rows.find(row => row.id === 'start')?.state).toBe('warning'); expect(blank.publishError).toBeNull();
  });

  it('warns about overlapping ground and placed hazards, and permits pass-through terrain markers', () => {
    const snapshot = room(); snapshot.tileData.terrain[19][3] = 13;
    expect(buildReadyToPublishChecklist(snapshot, storage()).rows.find(row => row.id === 'start')?.state).toBe('warning');
    const hazard = room(); hazard.placedObjects = [{ id: 'spikes', instanceId: 's', x: 56, y: 312 }];
    expect(buildReadyToPublishChecklist(hazard, storage()).rows.find(row => row.id === 'start')?.state).toBe('warning');
    const exit = room(); exit.tileData.terrain[19][36] = 13;
    expect(buildReadyToPublishChecklist(exit, storage()).rows.find(row => row.id === 'goal')?.state).toBe('warning');
    expect(buildReadyToPublishChecklist(exit, storage()).publishError).toBeNull();
    exit.tileData.terrain[19][36] = SPECIAL_TILE_ONE_WAY_PLATFORM_GID;
    expect(buildReadyToPublishChecklist(exit, storage()).rows.find(row => row.id === 'goal')?.state).toBe('ready');
    exit.goal = { type: 'reach_exit', exit: null, timeLimitMs: null };
    expect(buildReadyToPublishChecklist(exit, storage()).publishError).toMatch(/Set Exit/);
  });
});
