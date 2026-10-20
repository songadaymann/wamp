import type { OverworldPlayScene } from '../../OverworldPlayScene';

/** Internal factory capabilities; the adapter performs no eager scene reads. */
export type OverworldCompositionPorts = ReturnType<typeof OverworldPlayScene.createCompositionPorts>;
