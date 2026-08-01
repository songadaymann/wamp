import type Phaser from 'phaser';
import type { OverworldRuntimeTransitionProbe } from '../scenes/OverworldPlayScene';

interface RuntimeTransitionProbeScene {
  getRuntimeTransitionProbe(
    destinationRoomId?: string | null,
  ): OverworldRuntimeTransitionProbe;
}

export function getRuntimeTransitionProbe(
  game: Phaser.Game,
  destinationRoomId: string | null = null,
): OverworldRuntimeTransitionProbe | null {
  if (!game.scene.isActive('OverworldPlayScene')) {
    return null;
  }
  const scene = game.scene.getScene('OverworldPlayScene') as unknown as
    Partial<RuntimeTransitionProbeScene>;
  return scene.getRuntimeTransitionProbe?.(destinationRoomId) ?? null;
}
