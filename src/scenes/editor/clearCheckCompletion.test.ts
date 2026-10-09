import { expect, it, vi } from 'vitest';
import { createDefaultRoomSnapshot } from '../../persistence/roomModel';
import { buildRoomTemplate } from '../../templates/roomTemplates';
import { OverworldGoalRunController } from '../overworld/goalRuns';
import { getEditorDraftFingerprint, hasEditorDraftClear, recordEditorDraftClear } from './clearCheck';

it('records the goal controller draft completion once without starting or finishing a ranked run', () => {
  const snapshot = buildRoomTemplate(createDefaultRoomSnapshot('0,0', { x: 0, y: 0 }), 'flat_run', 'forest');
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
  const startRun = vi.fn(); const finishRun = vi.fn();
  const onDraftGoalCompleted = vi.fn(run => recordEditorDraftClear({ roomId: snapshot.id, fingerprint: getEditorDraftFingerprint(snapshot), eligible: true }, run, storage));
  const controller = new OverworldGoalRunController({ playerHeight: 26, getScore: () => 0, getAuthenticated: () => true, getAuthSource: () => null, getAuthDisplayName: () => 'Builder', countRoomObjectsByCategory: () => 0, runRepository: { startRun, finishRun } as never, onDraftGoalCompleted });
  controller.syncRunForRoom(snapshot, 'spawn'); controller.markCompleted('Exit reached.'); controller.markCompleted('Again');
  expect(onDraftGoalCompleted).toHaveBeenCalledOnce(); expect(hasEditorDraftClear(snapshot, storage)).toBe(true);
  expect(startRun).not.toHaveBeenCalled(); expect(finishRun).not.toHaveBeenCalled();
});
