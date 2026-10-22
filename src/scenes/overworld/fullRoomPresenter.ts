import Phaser from 'phaser';
import { resolveRoomBackground } from '../../backgrounds/model';
import {
  createBuiltInBackgroundObject,
  createCustomBackgroundLayer,
  createCustomBackgroundObject,
  ensureCustomBackgroundTexture,
  getBuiltInBackgroundTileScale,
  getCustomBackgroundTextureKey,
  syncBuiltInBackgroundObject,
  syncCustomBackgroundObject,
  type BuiltInBackgroundObject,
  type CustomBackgroundObject,
} from '../../backgrounds/runtime';
import {
  ROOM_HEIGHT,
  ROOM_PX_HEIGHT,
  ROOM_PX_WIDTH,
  ROOM_WIDTH,
  TILESETS,
  TILE_SIZE,
} from '../../config';
import { registerCustomSpritesFromSnapshot } from '../../customSprites/registry';
import {
  ensureCustomRoomTileTexture,
  ensureCustomRoomTilesetForMap,
} from '../../customTiles/runtime';
import { extractRoomStaticLightingEmitters } from '../../lighting/emissiveSources';
import {
  type RoomCoordinates,
  type RoomSnapshot,
} from '../../persistence/roomModel';
import { buildRoomSnapshotTexture } from '../../visuals/roomSnapshotTexture';
import {
  RETRO_COLORS,
  createStarfieldTileSprite,
  getStarfieldLayerConfig,
  syncStarfieldTileSprite,
} from '../../visuals/starfield';
import {
  getTerrainCollisionTileValue,
  getTerrainTileCollisionProfile,
  terrainTileDisablesTilemapCollision,
  terrainTileNeedsInsetBody,
} from './terrainCollision';
import { roomLayerHasTiles } from './roomTexturePreparation';
import { type PlayableRoomSource } from './worldStreamingModel';

import type {
  LoadedFullRoom,
  LoadedRoomBackgroundSprite,
} from './fullRoomTypes';
const PLAY_ROOM_PARALLAX_MULTIPLIER = 0.2;

export interface FullRoomPresenterOptions<TLiveObject, TEdgeWall> {
  scene: Phaser.Scene;
  getRoomOrigin: (coordinates: RoomCoordinates) => { x: number; y: number };
  getPlayer: () => Phaser.GameObjects.GameObject | null;
  shouldCollidePlayerWithTerrainTile: (tile: Phaser.Tilemaps.Tile) => boolean;
  createLiveObjects: (room: LoadedFullRoom<TLiveObject, TEdgeWall>) => void;
  destroyLiveObjects: (
    room: LoadedFullRoom<TLiveObject, TEdgeWall>,
    options?: { preserveTriggerState?: boolean },
  ) => void;
  destroyEdgeWalls: (room: LoadedFullRoom<TLiveObject, TEdgeWall>) => void;
  setLiveObjectsDormant: (
    room: LoadedFullRoom<TLiveObject, TEdgeWall>,
    dormant: boolean,
  ) => void;
  setLiveObjectWorldCollisionTargetDormant: (
    room: LoadedFullRoom<TLiveObject, TEdgeWall>,
    dormant: boolean,
  ) => void;
  buildScopedRoomTextureKey: (
    room: RoomSnapshot,
    options: {
      includeBackground?: boolean;
      includeObjects?: boolean;
      includedLayers?: ('background' | 'terrain' | 'foreground')[];
    },
  ) => string;
  buildFullRoomArtifactKey: (
    room: RoomSnapshot,
    source: PlayableRoomSource,
  ) => string;
  getCustomRoomTileTextureKey: (room: RoomSnapshot) => string | null;
  isDestroyed: () => boolean;
  measure: <T>(label: string, callback: () => T) => T;
}
export interface FullRoomRenderIdentity {
  room: RoomSnapshot;
  source: PlayableRoomSource;
  textureKey: string;
  /** Null when the room has no foreground tiles, so it gets no foreground image. */
  foregroundTextureKey: string | null;
  artifactKey: string;
}
interface CreatedFullRoom<TLiveObject, TEdgeWall> {
  loadedRoom: LoadedFullRoom<TLiveObject, TEdgeWall>;
  textureKey: string;
  foregroundTextureKey: string | null;
  customRoomTileTextureKey: string | null;
}

/** Owns full-room Phaser resources. Scheduling, generations, membership and cache leases stay in the streamer. */
export class OverworldFullRoomPresenter<
  TLiveObject = unknown,
  TEdgeWall = unknown,
> {
  constructor(
    private readonly options: FullRoomPresenterOptions<TLiveObject, TEdgeWall>,
  ) {}
  /** Called only after the streamer proves that no runtime or cache lease refers to the key. */
  releaseTextureIfPresent(resourceKey: string): void {
    if (this.options.scene.textures.exists(resourceKey)) {
      this.options.scene.textures.remove(resourceKey);
    }
  }

  createImmediate(
    room: RoomSnapshot,
    source: PlayableRoomSource,
  ): CreatedFullRoom<TLiveObject, TEdgeWall> | null {
    const textureKey = this.options.buildScopedRoomTextureKey(room, {
      includeBackground: false,
      includeObjects: false,
      includedLayers: ['background', 'terrain'],
    });
    const foregroundTextureKey = roomLayerHasTiles(room, 'foreground')
      ? this.options.buildScopedRoomTextureKey(room, {
          includeBackground: false,
          includeObjects: false,
          includedLayers: ['foreground'],
        })
      : null;
    if (!this.options.scene.textures.exists(textureKey)) {
      this.options.measure('stream.buildFullRoomTexture.terrain', () => {
        buildRoomSnapshotTexture(
          this.options.scene,
          room,
          textureKey,
          TILE_SIZE,
          {
            includeBackground: false,
            includeObjects: false,
            includedLayers: ['background', 'terrain'],
          },
        );
      });
    }
    if (foregroundTextureKey && !this.options.scene.textures.exists(foregroundTextureKey)) {
      this.options.measure('stream.buildFullRoomTexture.foreground', () => {
        buildRoomSnapshotTexture(
          this.options.scene,
          room,
          foregroundTextureKey,
          TILE_SIZE,
          {
            includeBackground: false,
            includeObjects: false,
            includedLayers: ['foreground'],
          },
        );
      });
    }

    const origin = this.options.getRoomOrigin(room.coordinates);
    const roomBackground = this.options.measure(
      'stream.createRoomBackground',
      () => this.createRoomBackground(room, origin),
    );
    const image = this.options.scene.add.image(
      origin.x + ROOM_PX_WIDTH / 2,
      origin.y + ROOM_PX_HEIGHT / 2,
      textureKey,
    );
    image.setOrigin(0.5);
    image.setDepth(10);
    image.setDisplaySize(ROOM_PX_WIDTH, ROOM_PX_HEIGHT);
    const foregroundImage = foregroundTextureKey
      ? this.createForegroundImage(origin, foregroundTextureKey)
      : null;

    const map = this.options.measure('stream.createTilemap', () =>
      this.options.scene.make.tilemap({
        tileWidth: TILE_SIZE,
        tileHeight: TILE_SIZE,
        width: ROOM_WIDTH,
        height: ROOM_HEIGHT,
      }),
    );
    const customRoomTileTextureKey =
      this.options.getCustomRoomTileTextureKey(room);
    if (customRoomTileTextureKey) {
      this.options.measure('stream.ensureCustomRoomTileTexture', () => {
        if (!this.options.scene.textures.exists(customRoomTileTextureKey)) {
          ensureCustomRoomTileTexture(
            this.options.scene,
            customRoomTileTextureKey,
            room.customTiles,
          );
        }
      });
    }
    const tilesets: Phaser.Tilemaps.Tileset[] = [];
    for (const tilesetConfig of TILESETS) {
      const tileset = map.addTilesetImage(
        tilesetConfig.key,
        tilesetConfig.key,
        TILE_SIZE,
        TILE_SIZE,
        0,
        0,
        tilesetConfig.firstGid,
      );
      if (tileset) {
        tilesets.push(tileset);
      }
    }
    if (customRoomTileTextureKey) {
      const customTileset = ensureCustomRoomTilesetForMap(
        map,
        customRoomTileTextureKey,
      );
      if (customTileset) {
        tilesets.push(customTileset);
      }
    }

    const terrainLayer = this.options.measure('stream.createTerrainLayer', () =>
      map.createBlankLayer(`terrain-${room.id}`, tilesets, origin.x, origin.y),
    );
    if (!terrainLayer) {
      roomBackground.colorRect?.destroy();
      for (const backgroundSprite of roomBackground.sprites) {
        backgroundSprite.sprite.destroy();
      }
      image.destroy();
      foregroundImage?.destroy();
      map.destroy();
      return null;
    }

    this.options.measure('stream.populateTerrainLayer', () => {
      this.populateTerrainLayerRows(room, terrainLayer, 0, ROOM_HEIGHT);
    });

    this.options.measure('stream.setTerrainCollision', () => {
      terrainLayer.setCollisionByExclusion([-1]);
    });
    terrainLayer.setVisible(false);
    const terrainInsetBodies = this.options.measure(
      'stream.createTerrainInsetBodies',
      () => this.createTerrainInsetBodies(room, origin, terrainLayer),
    );
    const staticLighting = this.options.measure(
      'stream.extractStaticLighting',
      () => extractRoomStaticLightingEmitters(room, origin),
    );

    const player = this.options.getPlayer();
    const loadedRoom: LoadedFullRoom<TLiveObject, TEdgeWall> = {
      room,
      source,
      staticLighting,
      backgroundColorRect: roomBackground.colorRect,
      backgroundSprites: roomBackground.sprites,
      image,
      textureKey,
      foregroundImage,
      foregroundTextureKey,
      map,
      terrainLayer,
      terrainCollider: player
        ? this.options.scene.physics.add.collider(
            player,
            terrainLayer,
            undefined,
            (_player, tile) =>
              this.options.shouldCollidePlayerWithTerrainTile?.(
                tile as Phaser.Tilemaps.Tile,
              ) ?? true,
          )
        : null,
      terrainInsetBodies,
      terrainInsetCollider:
        player && terrainInsetBodies
          ? this.options.scene.physics.add.collider(player, terrainInsetBodies)
          : null,
      edgeWalls: [],
      liveObjects: [],
      artifactKey: this.options.buildFullRoomArtifactKey(room, source),
      customRoomTileTextureKey,
      collisionReady: false,
    };
    this.options.measure('stream.updateFullRoomBackground', () => {
      this.updateFullRoomBackground(
        loadedRoom,
        this.options.scene.cameras.main,
      );
    });
    this.options.measure('stream.createLiveObjects', () => {
      this.options.createLiveObjects(loadedRoom);
    });

    // Cache accounting uses these captured keys even if an object callback
    // mutates fields on the newly allocated runtime before returning.
    return {
      loadedRoom,
      textureKey,
      foregroundTextureKey,
      customRoomTileTextureKey,
    };
  }

  private createForegroundImage(
    origin: { x: number; y: number },
    textureKey: string,
  ): Phaser.GameObjects.Image {
    const foregroundImage = this.options.scene.add.image(
      origin.x + ROOM_PX_WIDTH / 2,
      origin.y + ROOM_PX_HEIGHT / 2,
      textureKey,
    );
    foregroundImage.setOrigin(0.5);
    foregroundImage.setDepth(27.25);
    foregroundImage.setDisplaySize(ROOM_PX_WIDTH, ROOM_PX_HEIGHT);
    return foregroundImage;
  }

  populateTerrainLayerRows(
    room: RoomSnapshot,
    terrainLayer: Phaser.Tilemaps.TilemapLayer,
    startRow: number,
    endRow: number,
  ): void {
    for (
      let y = Math.max(0, startRow);
      y < Math.min(ROOM_HEIGHT, endRow);
      y += 1
    ) {
      for (let x = 0; x < ROOM_WIDTH; x += 1) {
        const { gid, flipX, flipY } = getTerrainCollisionTileValue(room, x, y);
        if (gid <= 0) continue;
        const tile = terrainLayer.putTileAt(gid, x, y);
        if (tile) {
          tile.flipX = flipX;
          tile.flipY = flipY;
        }
      }
    }
  }

  setPreparedInsetBodiesActive(
    loadedRoom: LoadedFullRoom<TLiveObject, TEdgeWall>,
    active: boolean,
  ): void {
    loadedRoom.terrainInsetBodies?.children.iterate((child) => {
      const gameObject = child as Phaser.GameObjects.GameObject & {
        body?: Phaser.Physics.Arcade.StaticBody | null;
      };
      gameObject.setActive(active);
      if (gameObject.body) gameObject.body.enable = active;
      return true;
    });
  }

  destroyLoadedRoomResources(
    loadedRoom: LoadedFullRoom<TLiveObject, TEdgeWall>,
    preserveTriggerState = false,
  ): void {
    let firstError: unknown;
    let hasError = false;
    const attempt = (operation: () => void) => {
      try {
        operation();
      } catch (error) {
        if (!hasError) {
          firstError = error;
          hasError = true;
        }
      }
    };
    attempt(() => this.options.destroyEdgeWalls(loadedRoom));
    attempt(() =>
      this.options.destroyLiveObjects(loadedRoom, { preserveTriggerState }),
    );
    attempt(() => loadedRoom.terrainCollider?.destroy());
    loadedRoom.terrainCollider = null;
    attempt(() => loadedRoom.terrainInsetCollider?.destroy());
    loadedRoom.terrainInsetCollider = null;
    attempt(() => loadedRoom.terrainInsetBodies?.clear(true, true));
    attempt(() => loadedRoom.terrainInsetBodies?.destroy());
    loadedRoom.terrainInsetBodies = null;
    attempt(() => loadedRoom.terrainLayer.destroy());
    attempt(() => loadedRoom.map.destroy());
    attempt(() => loadedRoom.backgroundColorRect?.destroy());
    loadedRoom.backgroundColorRect = null;
    for (const backgroundSprite of loadedRoom.backgroundSprites) {
      attempt(() => backgroundSprite.sprite.destroy());
    }
    loadedRoom.backgroundSprites = [];
    attempt(() => loadedRoom.image.destroy());
    attempt(() => loadedRoom.foregroundImage?.destroy());
    loadedRoom.foregroundImage = null;
    if (hasError) throw firstError;
  }

  createTerrainInsetBodies(
    room: RoomSnapshot,
    origin: { x: number; y: number },
    terrainLayer: Phaser.Tilemaps.TilemapLayer,
  ): Phaser.Physics.Arcade.StaticGroup | null {
    const insetBodies = this.options.scene.physics.add.staticGroup();
    let bodyCount = 0;

    bodyCount += this.createTerrainInsetBodiesRows(
      room,
      origin,
      terrainLayer,
      insetBodies,
      0,
      ROOM_HEIGHT,
      false,
    );

    if (bodyCount === 0) {
      insetBodies.destroy();
      return null;
    }

    terrainLayer.calculateFacesWithin(0, 0, ROOM_WIDTH, ROOM_HEIGHT);
    return insetBodies;
  }

  createTerrainInsetBodiesRows(
    room: RoomSnapshot,
    origin: { x: number; y: number },
    terrainLayer: Phaser.Tilemaps.TilemapLayer,
    insetBodies: Phaser.Physics.Arcade.StaticGroup | null,
    startRow: number,
    endRow: number,
    dormant: boolean,
  ): number {
    if (!insetBodies) return 0;
    let bodyCount = 0;
    for (
      let y = Math.max(0, startRow);
      y < Math.min(ROOM_HEIGHT, endRow);
      y += 1
    ) {
      for (let x = 0; x < ROOM_WIDTH; x += 1) {
        const tile = terrainLayer.getTileAt(x, y);
        if (tile && terrainTileDisablesTilemapCollision(room, x, y)) {
          tile.setCollision(false, false, false, false);
        }
        if (!terrainTileNeedsInsetBody(room, x, y)) continue;

        const profile = getTerrainTileCollisionProfile(room, x, y);
        const zone = this.options.scene.add.zone(
          origin.x + x * TILE_SIZE + TILE_SIZE / 2,
          origin.y + y * TILE_SIZE + profile.topInset + profile.height / 2,
          TILE_SIZE,
          profile.height,
        );
        this.options.scene.physics.add.existing(zone, true);
        insetBodies.add(zone);
        if (dormant) {
          zone.setActive(false);
          const body = zone.body as Phaser.Physics.Arcade.StaticBody | null;
          if (body) body.enable = false;
        }
        bodyCount += 1;
      }
    }
    return bodyCount;
  }

  createRoomBackground(
    room: RoomSnapshot,
    origin: { x: number; y: number },
    options: {
      dormant?: boolean;
      requireCustomTextureReady?: boolean;
    } = {},
  ): {
    colorRect: Phaser.GameObjects.Rectangle | null;
    sprites: LoadedRoomBackgroundSprite[];
  } {
    const resolved = resolveRoomBackground(room.background);
    let colorRect: Phaser.GameObjects.Rectangle | null = null;
    const sprites: LoadedRoomBackgroundSprite[] = [];
    const finish = () => {
      if (options.dormant) {
        this.setRoomBackgroundObjectsActive(colorRect, sprites, false);
      }
      return { colorRect, sprites };
    };

    if (resolved.kind === 'none') {
      colorRect = this.options.scene.add.rectangle(
        origin.x,
        origin.y,
        ROOM_PX_WIDTH,
        ROOM_PX_HEIGHT,
        RETRO_COLORS.backgroundNumber,
      );
      colorRect.setOrigin(0, 0);
      colorRect.setDepth(8);

      for (let index = 0; index < 2; index += 1) {
        const config = getStarfieldLayerConfig(
          index,
          PLAY_ROOM_PARALLAX_MULTIPLIER,
        );
        sprites.push({
          sprite: createStarfieldTileSprite(this.options.scene, {
            x: origin.x,
            y: origin.y,
            width: ROOM_PX_WIDTH,
            height: ROOM_PX_HEIGHT,
            depth: 9 + index * 0.1,
            alpha: config.alpha,
          }),
          parallax: config.parallax,
          tileScale: config.tileScale,
          useVerticalParallax: false,
        });
      }

      return finish();
    }

    if (resolved.kind === 'solid') {
      const color = Phaser.Display.Color.HexStringToColor(resolved.color).color;
      colorRect = this.options.scene.add.rectangle(
        origin.x,
        origin.y,
        ROOM_PX_WIDTH,
        ROOM_PX_HEIGHT,
        color,
      );
      colorRect.setOrigin(0, 0);
      colorRect.setDepth(8);
      return finish();
    }

    if (resolved.kind === 'custom') {
      colorRect = this.options.scene.add.rectangle(
        origin.x,
        origin.y,
        ROOM_PX_WIDTH,
        ROOM_PX_HEIGHT,
        RETRO_COLORS.backgroundNumber,
      );
      colorRect.setOrigin(0, 0);
      colorRect.setDepth(8);
      const createReadyCustomBackground = () => {
        const layer = createCustomBackgroundLayer(
          this.options.scene,
          resolved.id,
          resolved.fit,
        );
        const sprite = createCustomBackgroundObject(
          this.options.scene,
          layer,
          origin.x,
          origin.y,
          ROOM_PX_WIDTH,
          ROOM_PX_HEIGHT,
          9,
        );
        sprites.push({
          sprite,
          parallax: 0,
          tileScale: ROOM_PX_HEIGHT / layer.height,
          useVerticalParallax: false,
          customLayer: layer,
        });
      };
      if (
        this.options.scene.textures.exists(
          getCustomBackgroundTextureKey(resolved.id),
        )
      ) {
        createReadyCustomBackground();
      } else if (options.requireCustomTextureReady) {
        colorRect.destroy();
        colorRect = null;
        throw new Error(
          `Prepared custom background texture is missing for ${room.id}.`,
        );
      } else {
        const currentColorRect = colorRect;
        void ensureCustomBackgroundTexture(this.options.scene, resolved.id)
          .then(() => {
            if (!currentColorRect.active || this.options.isDestroyed()) return;
            createReadyCustomBackground();
          })
          .catch(() => {});
      }
      return finish();
    }

    if (resolved.group.bgColor) {
      const color = Phaser.Display.Color.HexStringToColor(
        resolved.group.bgColor,
      ).color;
      colorRect = this.options.scene.add.rectangle(
        origin.x,
        origin.y,
        ROOM_PX_WIDTH,
        ROOM_PX_HEIGHT,
        color,
      );
      colorRect.setOrigin(0, 0);
      colorRect.setDepth(8);
    }

    for (let index = 0; index < resolved.group.layers.length; index += 1) {
      const layer = resolved.group.layers[index];
      const sprite = createBuiltInBackgroundObject(
        this.options.scene,
        layer,
        origin.x,
        origin.y,
        ROOM_PX_WIDTH,
        ROOM_PX_HEIGHT,
        9 + index * 0.01,
      );
      const tileScale = getBuiltInBackgroundTileScale(layer, ROOM_PX_HEIGHT);
      sprites.push({
        sprite,
        parallax: layer.scrollFactor * PLAY_ROOM_PARALLAX_MULTIPLIER,
        tileScale,
        useVerticalParallax: false,
        builtInLayer: layer,
      });
    }

    return finish();
  }

  setRoomBackgroundObjectsActive(
    colorRect: Phaser.GameObjects.Rectangle | null,
    sprites: readonly LoadedRoomBackgroundSprite[],
    active: boolean,
  ): void {
    colorRect?.setActive(active);
    colorRect?.setVisible(active);
    for (const background of sprites) {
      background.sprite.setActive(active);
      background.sprite.setVisible(active);
    }
  }

  setPreparedRoomBackgroundActive(
    loadedRoom: LoadedFullRoom<TLiveObject, TEdgeWall>,
    active: boolean,
  ): void {
    this.setRoomBackgroundObjectsActive(
      loadedRoom.backgroundColorRect ?? null,
      loadedRoom.backgroundSprites ?? [],
      active,
    );
  }

  updateFullRoomBackground(
    loadedRoom: LoadedFullRoom<TLiveObject, TEdgeWall>,
    camera: Phaser.Cameras.Scene2D.Camera,
  ): void {
    const origin = this.options.getRoomOrigin(loadedRoom.room.coordinates);
    const worldView = camera.worldView;
    if (
      origin.x + ROOM_PX_WIDTH < worldView.left ||
      origin.x > worldView.right ||
      origin.y + ROOM_PX_HEIGHT < worldView.top ||
      origin.y > worldView.bottom
    ) {
      return;
    }

    if (loadedRoom.backgroundColorRect) {
      loadedRoom.backgroundColorRect.setPosition(origin.x, origin.y);
      loadedRoom.backgroundColorRect.setSize(ROOM_PX_WIDTH, ROOM_PX_HEIGHT);
    }

    for (const backgroundSprite of loadedRoom.backgroundSprites) {
      if (backgroundSprite.customLayer) {
        syncCustomBackgroundObject(
          backgroundSprite.sprite as CustomBackgroundObject,
          backgroundSprite.customLayer,
          origin.x,
          origin.y,
          ROOM_PX_WIDTH,
          ROOM_PX_HEIGHT,
          camera.scrollX,
        );
        continue;
      }

      if (backgroundSprite.builtInLayer) {
        syncBuiltInBackgroundObject(
          backgroundSprite.sprite as BuiltInBackgroundObject,
          backgroundSprite.builtInLayer,
          origin.x,
          origin.y,
          ROOM_PX_WIDTH,
          ROOM_PX_HEIGHT,
          (camera.scrollX * backgroundSprite.parallax) /
            backgroundSprite.tileScale,
          backgroundSprite.useVerticalParallax
            ? (camera.scrollY * backgroundSprite.parallax) /
                backgroundSprite.tileScale
            : 0,
        );
        continue;
      }

      const sprite = backgroundSprite.sprite as Phaser.GameObjects.TileSprite;
      syncStarfieldTileSprite(
        sprite,
        camera,
        {
          parallax: backgroundSprite.parallax,
          tileScale: backgroundSprite.tileScale,
        },
        {
          x: origin.x,
          y: origin.y,
          width: ROOM_PX_WIDTH,
          height: ROOM_PX_HEIGHT,
          useVerticalParallax: backgroundSprite.useVerticalParallax,
        },
      );
    }
  }

  suspendLoadedRoomRuntime(
    loadedRoom: LoadedFullRoom<TLiveObject, TEdgeWall>,
  ): () => void {
    loadedRoom.runtimeSuspended = true;
    const displayObjects = [
      loadedRoom.backgroundColorRect,
      ...(loadedRoom.backgroundSprites ?? []).map(
        (background) => background.sprite,
      ),
      loadedRoom.image,
      loadedRoom.foregroundImage,
      loadedRoom.terrainLayer,
    ].filter(Boolean) as Phaser.GameObjects.GameObject[];
    const displayStates = displayObjects.map((gameObject) => {
      const displayObject = gameObject as Phaser.GameObjects.GameObject & {
        visible?: boolean;
        setVisible?: (visible: boolean) => unknown;
      };
      const state = {
        gameObject: displayObject,
        active: displayObject.active,
        visible: displayObject.visible,
      };
      displayObject.setActive(false);
      displayObject.setVisible?.(false);
      return state;
    });
    const terrainColliderActive = loadedRoom.terrainCollider?.active ?? false;
    const terrainInsetColliderActive =
      loadedRoom.terrainInsetCollider?.active ?? false;
    if (loadedRoom.terrainCollider) loadedRoom.terrainCollider.active = false;
    if (loadedRoom.terrainInsetCollider)
      loadedRoom.terrainInsetCollider.active = false;
    this.setPreparedInsetBodiesActive(loadedRoom, false);
    this.options.setLiveObjectsDormant?.(loadedRoom, true);
    this.options.setLiveObjectWorldCollisionTargetDormant?.(loadedRoom, true);

    return () => {
      loadedRoom.runtimeSuspended = false;
      for (const state of displayStates) {
        if (!state.gameObject.scene) continue;
        state.gameObject.setActive(state.active);
        if (typeof state.visible === 'boolean') {
          state.gameObject.setVisible?.(state.visible);
        }
      }
      if (loadedRoom.terrainCollider) {
        loadedRoom.terrainCollider.active = terrainColliderActive;
      }
      if (loadedRoom.terrainInsetCollider) {
        loadedRoom.terrainInsetCollider.active = terrainInsetColliderActive;
      }
      this.setPreparedInsetBodiesActive(loadedRoom, true);
      this.options.setLiveObjectsDormant?.(loadedRoom, false);
      this.options.setLiveObjectWorldCollisionTargetDormant?.(
        loadedRoom,
        false,
      );
    };
  }

  forceDestroyLoadedRoomInsetBodies(
    loadedRoom: LoadedFullRoom<TLiveObject, TEdgeWall>,
  ): void {
    const insetBodies = loadedRoom.terrainInsetBodies;
    if (!insetBodies) return;
    let children: Phaser.GameObjects.GameObject[] = [];
    this.runFullRoomTeardownCleanupStep(
      'enumerate terrain inset bodies',
      () => {
        children = [...insetBodies.getChildren()];
      },
    );
    for (const child of children) {
      this.runFullRoomTeardownCleanupStep('detach a terrain inset body', () => {
        insetBodies.remove(child, false, false);
      });
      this.runFullRoomTeardownCleanupStep(
        'destroy a terrain inset body',
        () => {
          child.destroy();
        },
      );
    }
    this.runFullRoomTeardownCleanupStep('clear terrain inset bodies', () => {
      insetBodies.clear(false, false);
    });
    this.runFullRoomTeardownCleanupStep(
      'destroy the terrain inset group',
      () => {
        insetBodies.destroy();
      },
    );
    loadedRoom.terrainInsetBodies = null;
  }

  destroyLoadedRoomCollisionResources(
    loadedRoom: LoadedFullRoom<TLiveObject, TEdgeWall>,
  ): void {
    this.options.destroyEdgeWalls(loadedRoom);
    loadedRoom.terrainCollider?.destroy();
    loadedRoom.terrainCollider = null;
    loadedRoom.terrainInsetCollider?.destroy();
    loadedRoom.terrainInsetCollider = null;
  }

  destroyLoadedRoomInsetBodyBatch(
    loadedRoom: LoadedFullRoom<TLiveObject, TEdgeWall>,
    maxObjectCount: number,
  ): boolean {
    const insetBodies = loadedRoom.terrainInsetBodies;
    if (!insetBodies) return true;
    const children = insetBodies.getChildren();
    for (
      let index = 0;
      index < Math.min(maxObjectCount, children.length);
      index += 1
    ) {
      insetBodies.remove(children[index], true, true);
    }
    if (insetBodies.getLength() > 0) return false;
    insetBodies.destroy();
    loadedRoom.terrainInsetBodies = null;
    return true;
  }

  isLoadedRoomCollisionInfrastructureReady(
    loadedRoom: LoadedFullRoom<TLiveObject, TEdgeWall>,
  ): boolean {
    const player = this.options.getPlayer?.();
    if (!player) {
      return true;
    }

    return Boolean(
      loadedRoom.terrainCollider?.active &&
        (!loadedRoom.terrainInsetBodies ||
          loadedRoom.terrainInsetCollider?.active),
    );
  }

  createDormantShell(
    identity: FullRoomRenderIdentity,
  ): LoadedFullRoom<TLiveObject, TEdgeWall> {
    registerCustomSpritesFromSnapshot(identity.room);
    const origin = this.options.getRoomOrigin(identity.room.coordinates);
    const image = this.options.scene.add.image(
      origin.x + ROOM_PX_WIDTH / 2,
      origin.y + ROOM_PX_HEIGHT / 2,
      identity.textureKey,
    );
    image.setOrigin(0.5);
    image.setDepth(10);
    image.setDisplaySize(ROOM_PX_WIDTH, ROOM_PX_HEIGHT);
    image.setActive(false);
    image.setVisible(false);
    const foregroundImage = identity.foregroundTextureKey
      ? this.createForegroundImage(origin, identity.foregroundTextureKey)
      : null;
    foregroundImage?.setActive(false);
    foregroundImage?.setVisible(false);

    const map = this.options.scene.make.tilemap({
      tileWidth: TILE_SIZE,
      tileHeight: TILE_SIZE,
      width: ROOM_WIDTH,
      height: ROOM_HEIGHT,
    });
    const tilesets: Phaser.Tilemaps.Tileset[] = [];
    for (const tilesetConfig of TILESETS) {
      const tileset = map.addTilesetImage(
        tilesetConfig.key,
        tilesetConfig.key,
        TILE_SIZE,
        TILE_SIZE,
        0,
        0,
        tilesetConfig.firstGid,
      );
      if (tileset) tilesets.push(tileset);
    }
    const customRoomTileTextureKey = this.options.getCustomRoomTileTextureKey(
      identity.room,
    );
    if (customRoomTileTextureKey) {
      const customTileset = ensureCustomRoomTilesetForMap(
        map,
        customRoomTileTextureKey,
      );
      if (customTileset) tilesets.push(customTileset);
    }
    const terrainLayer = map.createBlankLayer(
      `terrain-${identity.room.id}`,
      tilesets,
      origin.x,
      origin.y,
    );
    if (!terrainLayer) {
      image.destroy();
      foregroundImage?.destroy();
      map.destroy();
      throw new Error(
        `Could not create terrain layer for ${identity.room.id}.`,
      );
    }
    terrainLayer.setVisible(false);
    terrainLayer.setActive(false);
    return {
      room: identity.room,
      source: identity.source,
      staticLighting: { emitters: [], objectCount: 0, tileCount: 0 },
      backgroundColorRect: null,
      backgroundSprites: [],
      image,
      textureKey: identity.textureKey,
      foregroundImage,
      foregroundTextureKey: identity.foregroundTextureKey,
      map,
      terrainLayer,
      terrainCollider: null,
      terrainInsetBodies: null,
      terrainInsetCollider: null,
      edgeWalls: [],
      liveObjects: [],
      artifactKey: identity.artifactKey,
      customRoomTileTextureKey,
      collisionReady: false,
    };
  }

  prepareBackground(
    loadedRoom: LoadedFullRoom<TLiveObject, TEdgeWall>,
    identity: Pick<FullRoomRenderIdentity, 'room'>,
  ): void {
    const origin = this.options.getRoomOrigin(identity.room.coordinates);
    const roomBackground = this.createRoomBackground(identity.room, origin, {
      dormant: true,
      requireCustomTextureReady: true,
    });
    loadedRoom.backgroundColorRect = roomBackground.colorRect;
    loadedRoom.backgroundSprites = roomBackground.sprites;
  }

  prepareTerrainCollision(
    loadedRoom: LoadedFullRoom<TLiveObject, TEdgeWall>,
  ): void {
    loadedRoom.terrainLayer.setCollisionByExclusion([-1]);
    loadedRoom.terrainInsetBodies =
      this.options.scene.physics.add.staticGroup();
  }

  finishTerrainInsets(
    loadedRoom: LoadedFullRoom<TLiveObject, TEdgeWall>,
    bodyCount: number,
  ): void {
    if (bodyCount === 0) {
      loadedRoom.terrainInsetBodies?.destroy();
      loadedRoom.terrainInsetBodies = null;
    } else {
      loadedRoom.terrainLayer.calculateFacesWithin(
        0,
        0,
        ROOM_WIDTH,
        ROOM_HEIGHT,
      );
    }
  }

  prepareLighting(
    loadedRoom: LoadedFullRoom<TLiveObject, TEdgeWall>,
    room: RoomSnapshot,
  ): void {
    loadedRoom.staticLighting = extractRoomStaticLightingEmitters(
      room,
      this.options.getRoomOrigin(room.coordinates),
    );
  }

  activatePrepared(loadedRoom: LoadedFullRoom<TLiveObject, TEdgeWall>): void {
    this.setPreparedRoomBackgroundActive(loadedRoom, true);
    loadedRoom.image.setActive(true);
    loadedRoom.image.setVisible(true);
    loadedRoom.foregroundImage?.setActive(true);
    loadedRoom.foregroundImage?.setVisible(true);
    loadedRoom.terrainLayer.setActive(true);
    this.setPreparedInsetBodiesActive(loadedRoom, true);
    this.options.setLiveObjectsDormant?.(loadedRoom, false);
  }

  ensurePlayerTerrainColliders(
    loadedRoom: LoadedFullRoom<TLiveObject, TEdgeWall>,
  ): void {
    const player = this.options.getPlayer();
    if (!player) {
      return;
    }

    if (!loadedRoom.terrainCollider) {
      loadedRoom.terrainCollider = this.options.scene.physics.add.collider(
        player,
        loadedRoom.terrainLayer,
        undefined,
        (_player, tile) =>
          this.options.shouldCollidePlayerWithTerrainTile?.(
            tile as Phaser.Tilemaps.Tile,
          ) ?? true,
      );
    }
    if (loadedRoom.terrainInsetBodies && !loadedRoom.terrainInsetCollider) {
      loadedRoom.terrainInsetCollider = this.options.scene.physics.add.collider(
        player,
        loadedRoom.terrainInsetBodies,
      );
    }
  }

  destroyBackgroundSpriteBatch(
    loadedRoom: LoadedFullRoom<TLiveObject, TEdgeWall>,
    maxObjectCount: number,
  ): boolean {
    for (let index = 0; index < maxObjectCount; index += 1) {
      const background = loadedRoom.backgroundSprites.at(-1);
      if (!background) break;
      background.sprite.destroy();
      loadedRoom.backgroundSprites.pop();
    }

    return loadedRoom.backgroundSprites.length === 0;
  }

  destroyDisplay(loadedRoom: LoadedFullRoom<TLiveObject, TEdgeWall>): void {
    loadedRoom.backgroundColorRect?.destroy();
    loadedRoom.backgroundColorRect = null;
    loadedRoom.image.destroy();
    loadedRoom.foregroundImage?.destroy();
    loadedRoom.foregroundImage = null;
  }

  destroyTerrain(loadedRoom: LoadedFullRoom<TLiveObject, TEdgeWall>): void {
    loadedRoom.terrainLayer.destroy();
    loadedRoom.map.destroy();
  }

  forceDestroyCollision(
    loadedRoom: LoadedFullRoom<TLiveObject, TEdgeWall>,
  ): void {
    this.runFullRoomTeardownCleanupStep('destroy edge walls', () => {
      this.options.destroyEdgeWalls(loadedRoom);
    });
    this.runFullRoomTeardownCleanupStep('destroy the terrain collider', () => {
      loadedRoom.terrainCollider?.destroy();
    });
    loadedRoom.terrainCollider = null;
    this.runFullRoomTeardownCleanupStep('destroy the inset collider', () => {
      loadedRoom.terrainInsetCollider?.destroy();
    });
    loadedRoom.terrainInsetCollider = null;
  }

  forceDestroyTerrain(
    loadedRoom: LoadedFullRoom<TLiveObject, TEdgeWall>,
  ): void {
    this.runFullRoomTeardownCleanupStep('destroy the terrain layer', () => {
      loadedRoom.terrainLayer.destroy();
    });
    this.runFullRoomTeardownCleanupStep('destroy the tilemap', () => {
      loadedRoom.map.destroy();
    });
  }

  forceDestroyBackgrounds(
    loadedRoom: LoadedFullRoom<TLiveObject, TEdgeWall>,
  ): void {
    for (const background of loadedRoom.backgroundSprites) {
      this.runFullRoomTeardownCleanupStep('destroy a background sprite', () => {
        background.sprite.destroy();
      });
    }
    loadedRoom.backgroundSprites = [];
  }

  forceDestroyDisplay(
    loadedRoom: LoadedFullRoom<TLiveObject, TEdgeWall>,
  ): void {
    this.runFullRoomTeardownCleanupStep('destroy the background color', () => {
      loadedRoom.backgroundColorRect?.destroy();
    });
    loadedRoom.backgroundColorRect = null;
    this.runFullRoomTeardownCleanupStep('destroy the room image', () => {
      loadedRoom.image.destroy();
    });
    this.runFullRoomTeardownCleanupStep('destroy the foreground image', () => {
      loadedRoom.foregroundImage?.destroy();
    });
    loadedRoom.foregroundImage = null;
  }

  private runFullRoomTeardownCleanupStep(
    label: string,
    step: () => void,
  ): void {
    try {
      step();
    } catch (error) {
      console.error(`Full-room teardown could not ${label}.`, error);
    }
  }
}
