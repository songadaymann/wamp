import type { TutorialTemplateVersionsV1 } from './model';

export const DREAM_SCRIPT = [
  'Somewhere, a room is dreaming.',
  'It cannot finish itself.',
  'So it dreams of someone who can.',
  'It dreamed of you.',
] as const;

export const TUTORIAL_TEMPLATE_VERSIONS: TutorialTemplateVersionsV1 = {
  wakeRoom: 4,
  bridgeRoom: 8,
};

export const TUTORIAL_WAKE_ROOM = {
  id: '-11,-6',
  coordinates: { x: -11, y: -6 },
  version: TUTORIAL_TEMPLATE_VERSIONS.wakeRoom,
} as const;

export const TUTORIAL_BRIDGE_ROOM = {
  id: '-10,-6',
  coordinates: { x: -10, y: -6 },
  version: TUTORIAL_TEMPLATE_VERSIONS.bridgeRoom,
  sign: {
    instanceId: 'obj_056152ce-c836-4f1b-b45b-d04b227e54ab',
    text: 'How are you going to get across?',
  },
  bridgeRegion: {
    minTileX: 14,
    maxTileX: 23,
    minTileY: 10,
    maxTileY: 18,
    minimumAddedTerrainTiles: 3,
  },
} as const;

export const TUTORIAL_TEMPLATE_CONTRACT = {
  wakeRoom: {
    id: '-11,-6',
    coordinates: { x: -11, y: -6 },
    version: 4,
    goalType: 'reach_exit',
  },
  bridgeRoom: {
    id: '-10,-6',
    coordinates: { x: -10, y: -6 },
    version: 8,
    goalType: 'reach_exit',
    signInstanceId: 'obj_056152ce-c836-4f1b-b45b-d04b227e54ab',
    signText: 'How are you going to get across?',
  },
} as const;
