import type Phaser from 'phaser';
import type { OverworldSpecialTilesController, PlayerGravityDirection } from './specialTiles';

type TileController = Pick<OverworldSpecialTilesController,
  'getConveyorDirectionForBody' | 'getBodyRoomId' | 'getEnvironmentForBody' | 'isBodyOnDamageTile'>;

/** Scene collaborators are created in order; look up the tile controller only on use. */
export function createSpecialTileCallbacks(getController: () => TileController) {
  return {
    getConveyorDirectionForBody: (body: Phaser.Physics.Arcade.Body, direction: PlayerGravityDirection) =>
      getController().getConveyorDirectionForBody(body, direction),
    getBodyRoomId: (body: Phaser.Physics.Arcade.Body) => getController().getBodyRoomId(body),
    getSpecialTileEnvironmentForBody: (body: Phaser.Physics.Arcade.Body, direction: PlayerGravityDirection) =>
      getController().getEnvironmentForBody(body, direction),
    isBodyOnDamageTile: (body: Phaser.Physics.Arcade.Body) => getController().isBodyOnDamageTile(body),
  };
}
