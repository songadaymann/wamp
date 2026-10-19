import type Phaser from 'phaser';
import type {
  BuiltInBackgroundObject,
  CustomBackgroundLayer,
  CustomBackgroundObject,
} from '../../backgrounds/runtime';
import type { RoomStaticLightingEmitters } from '../../lighting/emissiveSources';
import type { RoomSnapshot } from '../../persistence/roomModel';
import type { PlayableRoomSource } from './worldStreamingModel';

export interface LoadedFullRoom<TLiveObject = unknown, TEdgeWall = unknown> {
  room: RoomSnapshot;
  source: PlayableRoomSource;
  staticLighting: RoomStaticLightingEmitters;
  backgroundColorRect: Phaser.GameObjects.Rectangle | null;
  backgroundSprites: LoadedRoomBackgroundSprite[];
  image: Phaser.GameObjects.Image;
  textureKey: string;
  foregroundImage: Phaser.GameObjects.Image | null;
  foregroundTextureKey: string | null;
  map: Phaser.Tilemaps.Tilemap;
  terrainLayer: Phaser.Tilemaps.TilemapLayer;
  terrainCollider: Phaser.Physics.Arcade.Collider | null;
  terrainInsetBodies: Phaser.Physics.Arcade.StaticGroup | null;
  terrainInsetCollider: Phaser.Physics.Arcade.Collider | null;
  edgeWalls: TEdgeWall[];
  liveObjects: TLiveObject[];
  artifactKey?: string;
  customRoomTileTextureKey?: string | null;
  collisionReady?: boolean;
  runtimeSuspended?: boolean;
}

export interface LoadedRoomBackgroundSprite {
  sprite: BuiltInBackgroundObject | CustomBackgroundObject;
  parallax: number;
  tileScale: number;
  useVerticalParallax: boolean;
  builtInLayer?: { height: number; repeat?: boolean };
  customLayer?: CustomBackgroundLayer;
}
