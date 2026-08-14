import { cloneRoomSnapshot, type RoomSnapshot } from '../persistence/roomModel';
import type { RoomRepository } from '../persistence/roomRepository';
import {
  TUTORIAL_BRIDGE_ROOM,
  TUTORIAL_TEMPLATE_CONTRACT,
  TUTORIAL_WAKE_ROOM,
} from './config';

export interface TutorialTemplates {
  wakeRoom: RoomSnapshot;
  bridgeRoom: RoomSnapshot;
}

export class TutorialTemplateContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TutorialTemplateContractError';
  }
}

export class PinnedTutorialTemplateLoader {
  constructor(private readonly roomRepository: Pick<RoomRepository, 'loadExactRoomVersion'>) {}

  async load(): Promise<TutorialTemplates> {
    const [wakeVersion, bridgeVersion] = await Promise.all([
      this.roomRepository.loadExactRoomVersion(TUTORIAL_WAKE_ROOM.id, TUTORIAL_WAKE_ROOM.version),
      this.roomRepository.loadExactRoomVersion(TUTORIAL_BRIDGE_ROOM.id, TUTORIAL_BRIDGE_ROOM.version),
    ]);
    validateTutorialTemplateContract(wakeVersion.snapshot, bridgeVersion.snapshot);
    return {
      wakeRoom: makePrivateTemplateSnapshot(wakeVersion.snapshot),
      bridgeRoom: makePrivateTemplateSnapshot(bridgeVersion.snapshot),
    };
  }
}

export function makePrivateTemplateSnapshot(snapshot: RoomSnapshot): RoomSnapshot {
  const result = cloneRoomSnapshot(snapshot);
  result.status = 'draft';
  result.publishedAt = null;
  return result;
}

export function validateTutorialTemplateContract(
  wakeRoom: RoomSnapshot,
  bridgeRoom: RoomSnapshot,
): void {
  validateRoomIdentity(wakeRoom, TUTORIAL_TEMPLATE_CONTRACT.wakeRoom);
  validateRoomIdentity(bridgeRoom, TUTORIAL_TEMPLATE_CONTRACT.bridgeRoom);

  const expectedSign = TUTORIAL_TEMPLATE_CONTRACT.bridgeRoom;
  const sign = bridgeRoom.placedObjects.find(
    (placed) => placed.instanceId === expectedSign.signInstanceId,
  );
  if (!sign || sign.signText?.trim() !== expectedSign.signText) {
    throw new TutorialTemplateContractError(
      `Pinned bridge template is missing sign ${expectedSign.signInstanceId}.`,
    );
  }
}

function validateRoomIdentity(
  room: RoomSnapshot,
  contract: {
    id: string;
    coordinates: { x: number; y: number };
    version: number;
    goalType: 'reach_exit';
  },
): void {
  if (
    room.id !== contract.id
    || room.coordinates.x !== contract.coordinates.x
    || room.coordinates.y !== contract.coordinates.y
    || room.version !== contract.version
    || room.goal?.type !== contract.goalType
    || !room.goal.exit
  ) {
    throw new TutorialTemplateContractError(
      `Pinned tutorial template ${contract.id} v${contract.version} no longer matches its contract.`,
    );
  }
}
