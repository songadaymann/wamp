import { describe, expect, it } from 'vitest';
import { createDefaultRoomGoal } from '../goals/roomGoals';
import { createDefaultRoomSnapshot, type RoomSnapshot } from '../persistence/roomModel';
import { TUTORIAL_BRIDGE_ROOM, TUTORIAL_WAKE_ROOM } from './config';
import {
  PinnedTutorialTemplateLoader,
  TutorialTemplateContractError,
  validateTutorialTemplateContract,
} from './templateLoader';

function createTemplate(
  id: string,
  coordinates: { x: number; y: number },
  version: number,
): RoomSnapshot {
  const snapshot = createDefaultRoomSnapshot(id, coordinates);
  snapshot.version = version;
  const goal = createDefaultRoomGoal('reach_exit');
  if (goal.type !== 'reach_exit') throw new Error('Expected reach-exit goal.');
  goal.exit = { x: 600, y: 304 };
  snapshot.goal = goal;
  return snapshot;
}

function createTemplates(): { wake: RoomSnapshot; bridge: RoomSnapshot } {
  const wake = createTemplate(TUTORIAL_WAKE_ROOM.id, TUTORIAL_WAKE_ROOM.coordinates, 4);
  const bridge = createTemplate(TUTORIAL_BRIDGE_ROOM.id, TUTORIAL_BRIDGE_ROOM.coordinates, 8);
  bridge.placedObjects.push({
    id: 'sign',
    x: 100,
    y: 100,
    instanceId: TUTORIAL_BRIDGE_ROOM.sign.instanceId,
    signText: TUTORIAL_BRIDGE_ROOM.sign.text,
  });
  return { wake, bridge };
}

describe('pinned tutorial template loader', () => {
  it('requests exact v4/v8 versions and makes private draft copies', async () => {
    const { wake, bridge } = createTemplates();
    const requests: Array<[string, number]> = [];
    const loader = new PinnedTutorialTemplateLoader({
      loadExactRoomVersion: async (roomId, version) => {
        requests.push([roomId, version]);
        return { snapshot: roomId === wake.id ? wake : bridge } as never;
      },
    });

    const loaded = await loader.load();
    expect(requests).toEqual([['-11,-6', 4], ['-10,-6', 8]]);
    expect(loaded.wakeRoom.status).toBe('draft');
    expect(loaded.bridgeRoom.status).toBe('draft');
    expect(loaded.bridgeRoom).not.toBe(bridge);
  });

  it('fails closed when the pinned sign or version contract drifts', () => {
    const { wake, bridge } = createTemplates();
    bridge.placedObjects[0]!.signText = 'Different text';
    expect(() => validateTutorialTemplateContract(wake, bridge))
      .toThrow(TutorialTemplateContractError);
    bridge.placedObjects[0]!.signText = TUTORIAL_BRIDGE_ROOM.sign.text;
    bridge.version = 9;
    expect(() => validateTutorialTemplateContract(wake, bridge))
      .toThrow(/v8/);
  });
});
