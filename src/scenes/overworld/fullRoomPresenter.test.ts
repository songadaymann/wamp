import { readFileSync } from 'node:fs';
import type Phaser from 'phaser';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  default: {
    Textures: { FilterMode: { LINEAR: 'linear', NEAREST: 'nearest' } },
    Display: {
      Color: {
        HexStringToColor: (value: string) => ({
          color: Number.parseInt(value.slice(1), 16),
        }),
      },
    },
  },
}));

import * as backgrounds from '../../backgrounds/runtime';
import {
  ROOM_HEIGHT,
  ROOM_PX_HEIGHT,
  ROOM_PX_WIDTH,
  TILE_FLIP_X_FLAG,
  TILE_FLIP_Y_FLAG,
  getTilesetByKey,
} from '../../config';
import { createDefaultRoomSnapshot } from '../../persistence/roomModel';
import * as roomTextures from '../../visuals/roomSnapshotTexture';
import {
  OverworldFullRoomPresenter,
  type FullRoomPresenterOptions,
} from './fullRoomPresenter';
import type { LoadedFullRoom } from './fullRoomTypes';

afterEach(() => vi.restoreAllMocks());

function display(tile = false) {
  const object = {
    scene: {} as object | null,
    active: true,
    visible: true,
    x: 0,
    y: 0,
    tilePositionX: 0,
    tilePositionY: 0,
    texture: { setFilter: vi.fn() },
    setActive(active: boolean) {
      this.active = active;
      return this;
    },
    setVisible(visible: boolean) {
      this.visible = visible;
      return this;
    },
    setPosition(x: number, y: number) {
      this.x = x;
      this.y = y;
      return this;
    },
    setOrigin: vi.fn(),
    setDepth: vi.fn(),
    setDisplaySize: vi.fn(),
    setSize: vi.fn(),
    setCrop: vi.fn(),
    setAlpha: vi.fn(),
    destroy() {
      this.active = false;
      this.scene = null;
    },
  };
  for (const key of [
    'setActive',
    'setVisible',
    'setPosition',
    'destroy',
  ] as const)
    vi.spyOn(object, key);
  return tile ? { ...object, setTileScale: vi.fn() } : object;
}

function fixture() {
  const room = createDefaultRoomSnapshot('0,0', { x: 0, y: 0 });
  room.background = 'solid:#123456';
  const images: ReturnType<typeof display>[] = [],
    rectangles: ReturnType<typeof display>[] = [];
  const lifecycle = { destroyed: false, player: null as object | null };
  const tile = { flipX: false, flipY: false, setCollision: vi.fn() };
  const terrain = {
    ...display(),
    putTileAt: vi.fn(() => tile),
    getTileAt: vi.fn(() => null),
    setCollisionByExclusion: vi.fn(),
    calculateFacesWithin: vi.fn(),
  };
  const map = {
    addTilesetImage: vi.fn((..._args: unknown[]) => ({})),
    createBlankLayer: vi.fn(() => terrain),
    destroy: vi.fn(),
  };
  const insetGroup = {
    destroy: vi.fn(),
    clear: vi.fn(),
    getLength: () => 0,
    getChildren: () => [],
    children: { iterate: vi.fn() },
  };
  const scene = {
    textures: {
      exists: vi.fn((_key: string) => true),
      remove: vi.fn(),
      get: vi.fn(() => ({
        getSourceImage: () => ({ width: 320, height: 176 }),
      })),
    },
    add: {
      image: vi.fn((..._args: unknown[]) => {
        const image = display();
        images.push(image);
        return image;
      }),
      tileSprite: vi.fn((..._args: unknown[]) => {
        const image = display(true);
        images.push(image);
        return image;
      }),
      rectangle: vi.fn((..._args: unknown[]) => {
        const image = display();
        rectangles.push(image);
        return image;
      }),
    },
    make: { tilemap: vi.fn(() => map) },
    physics: {
      add: {
        staticGroup: vi.fn(() => insetGroup),
        collider: vi.fn((..._args: unknown[]) => ({
          active: true,
          destroy: vi.fn(),
        })),
      },
    },
    cameras: {
      main: {
        worldView: { left: 0, top: 0, right: 640, bottom: 352 },
        scrollX: 100,
        scrollY: 200,
      },
    },
  };
  const labels: string[] = [];
  const options: FullRoomPresenterOptions<unknown, unknown> = {
    scene: scene as unknown as Phaser.Scene,
    getRoomOrigin: (coordinates) => ({
      x: coordinates.x * ROOM_PX_WIDTH,
      y: coordinates.y * ROOM_PX_HEIGHT,
    }),
    getPlayer: () => lifecycle.player as Phaser.GameObjects.GameObject | null,
    shouldCollidePlayerWithTerrainTile: vi.fn(() => true),
    createLiveObjects: vi.fn(),
    destroyLiveObjects: vi.fn(),
    destroyEdgeWalls: vi.fn(),
    setLiveObjectsDormant: vi.fn(),
    setLiveObjectWorldCollisionTargetDormant: vi.fn(),
    buildScopedRoomTextureKey: (_room, settings) =>
      settings.includedLayers?.[0] === 'foreground' ? 'front' : 'terrain',
    buildFullRoomArtifactKey: () => 'artifact',
    getCustomRoomTileTextureKey: () => null,
    isDestroyed: () => lifecycle.destroyed,
    measure: (label, callback) => {
      labels.push(label);
      return callback();
    },
  };
  const presenter = new OverworldFullRoomPresenter(options);
  const identity = {
    room,
    source: 'published' as const,
    textureKey: 'terrain',
    foregroundTextureKey: 'front',
    artifactKey: 'artifact',
  };
  return {
    presenter,
    options,
    scene,
    room,
    identity,
    lifecycle,
    labels,
    images,
    rectangles,
    terrain,
    map,
    insetGroup,
    tile,
  };
}

describe('full-room presentation ownership', () => {
  it('constructs without reading a partially initialized scene or player', () => {
    const ports = new Proxy({} as FullRoomPresenterOptions<unknown, unknown>, {
      get: () => {
        throw new Error('eager resource access');
      },
    });
    expect(() => new OverworldFullRoomPresenter(ports)).not.toThrow();
  });

  it('keeps graphics mutation out of the streaming scheduler and lifecycle state out of the presenter', () => {
    const scheduler = readFileSync(
      new URL('./worldStreaming.ts', import.meta.url),
      'utf8',
    );
    const presenter = readFileSync(
      new URL('./fullRoomPresenter.ts', import.meta.url),
      'utf8',
    );
    expect(scheduler).not.toMatch(/options\.scene\.(?:add|make|physics)\./);
    expect(scheduler).not.toMatch(/options\.scene\.textures\.remove\(/);
    expect(scheduler).toContain('new OverworldFullRoomPresenter');
    expect(presenter).not.toMatch(
      /FrameWorkCoordinator|RoomArtifactCache|WorldRepository|pendingFullRoomPreparationsById|loadedFullRoomsById/,
    );
  });

  it('creates cached room art, hidden terrain and live objects without publishing collision readiness', () => {
    const f = fixture();
    f.lifecycle.player = { id: 'first player' };
    const loaded = f.presenter.createImmediate(f.room, 'published')!.loadedRoom;
    expect(loaded.room).toBe(f.room);
    expect(loaded.collisionReady).toBe(false);
    expect(loaded.textureKey).toBe('terrain');
    expect(loaded.foregroundTextureKey).toBe('front');
    expect(loaded.artifactKey).toBe('artifact');
    expect(loaded.terrainInsetBodies).toBeNull();
    expect(f.images[0].setDepth).toHaveBeenCalledWith(10);
    expect(f.images[1].setDepth).toHaveBeenCalledWith(27.25);
    expect(f.terrain.visible).toBe(false);
    expect(f.terrain.setCollisionByExclusion).toHaveBeenCalledWith([-1]);
    expect(f.scene.physics.add.collider).toHaveBeenCalledWith(
      f.lifecycle.player,
      f.terrain,
      undefined,
      expect.any(Function),
    );
    expect(f.options.createLiveObjects).toHaveBeenCalledWith(loaded);
    expect(f.labels).toEqual([
      'stream.createRoomBackground',
      'stream.createTilemap',
      'stream.createTerrainLayer',
      'stream.populateTerrainLayer',
      'stream.setTerrainCollision',
      'stream.createTerrainInsetBodies',
      'stream.extractStaticLighting',
      'stream.updateFullRoomBackground',
      'stream.createLiveObjects',
    ]);
  });

  it('builds terrain and foreground textures before constructing display objects', () => {
    const f = fixture(),
      ready = new Set<string>();
    f.scene.textures.exists.mockImplementation((key) => ready.has(key));
    const build = vi
      .spyOn(roomTextures, 'buildRoomSnapshotTexture')
      .mockImplementation((_scene, _room, key) => {
        ready.add(key);
        return key;
      });
    expect(f.presenter.createImmediate(f.room, 'published')).not.toBeNull();
    expect(build.mock.calls.map((call) => call[2])).toEqual([
      'terrain',
      'front',
    ]);
    expect(f.labels.slice(0, 2)).toEqual([
      'stream.buildFullRoomTexture.terrain',
      'stream.buildFullRoomTexture.foreground',
    ]);
  });

  it('retains captured cache keys when a live-object callback mutates the allocated runtime', () => {
    const f = fixture();
    let observed: LoadedFullRoom | null = null;
    f.options.createLiveObjects = (loaded) => {
      observed = loaded;
      loaded.textureKey = 'callback-changed';
      loaded.foregroundTextureKey = null;
      loaded.customRoomTileTextureKey = 'callback-custom';
    };
    const result = f.presenter.createImmediate(f.room, 'published')!;
    expect(result.loadedRoom).toBe(observed);
    expect(result.textureKey).toBe('terrain');
    expect(result.foregroundTextureKey).toBe('front');
    expect(result.customRoomTileTextureKey).toBeNull();
    expect(result.loadedRoom.textureKey).toBe('callback-changed');
    expect(result.loadedRoom.foregroundTextureKey).toBeNull();
  });

  it.each(['immediate', 'prepared'] as const)(
    'cleans every shell allocation when %s terrain creation fails',
    (kind) => {
      const f = fixture();
      f.map.createBlankLayer.mockReturnValue(
        null as unknown as typeof f.terrain,
      );
      if (kind === 'immediate')
        expect(f.presenter.createImmediate(f.room, 'published')).toBeNull();
      else
        expect(() => f.presenter.createDormantShell(f.identity)).toThrow(
          'Could not create terrain layer for 0,0.',
        );
      expect(f.images).toHaveLength(2);
      for (const image of f.images)
        expect(image.destroy).toHaveBeenCalledOnce();
      expect(f.map.destroy).toHaveBeenCalledOnce();
      expect(f.options.createLiveObjects).not.toHaveBeenCalled();
      if (kind === 'immediate')
        expect(f.rectangles[0].destroy).toHaveBeenCalledOnce();
    },
  );

  it('keeps a prepared shell dormant until local activation, without claiming scheduler readiness', () => {
    const f = fixture(),
      loaded = f.presenter.createDormantShell(f.identity);
    for (const image of f.images) {
      expect(image.active).toBe(false);
      expect(image.visible).toBe(false);
    }
    expect(f.terrain.active).toBe(false);
    expect(loaded.backgroundSprites).toEqual([]);
    expect(f.options.createLiveObjects).not.toHaveBeenCalled();
    f.presenter.prepareBackground(loaded, f.identity);
    expect(f.rectangles[0].active).toBe(false);
    expect(f.rectangles[0].visible).toBe(false);
    f.presenter.activatePrepared(loaded);
    for (const image of f.images) {
      expect(image.active).toBe(true);
      expect(image.visible).toBe(true);
    }
    expect(f.rectangles[0].active).toBe(true);
    expect(f.terrain.active).toBe(true);
    expect(f.options.setLiveObjectsDormant).toHaveBeenCalledWith(loaded, false);
    expect(loaded.collisionReady).toBe(false);
    expect(loaded.terrainCollider).toBeNull();
  });

  it('reads the current player when repairing terrain colliders and does not duplicate them', () => {
    const f = fixture(),
      loaded = f.presenter.createDormantShell(f.identity);
    f.presenter.ensurePlayerTerrainColliders(loaded);
    expect(f.scene.physics.add.collider).not.toHaveBeenCalled();
    const first = { id: 1 };
    f.lifecycle.player = first;
    f.presenter.ensurePlayerTerrainColliders(loaded);
    f.presenter.ensurePlayerTerrainColliders(loaded);
    expect(f.scene.physics.add.collider).toHaveBeenCalledTimes(1);
    loaded.terrainCollider = null;
    const replacement = { id: 2 };
    f.lifecycle.player = replacement;
    f.presenter.ensurePlayerTerrainColliders(loaded);
    expect(f.scene.physics.add.collider).toHaveBeenLastCalledWith(
      replacement,
      f.terrain,
      undefined,
      expect.any(Function),
    );
  });

  it('restores previous display and collider state without resurrecting destroyed objects', () => {
    const f = fixture(),
      loaded = f.presenter.createDormantShell(f.identity);
    f.presenter.activatePrepared(loaded);
    loaded.terrainCollider = {
      active: false,
    } as Phaser.Physics.Arcade.Collider;
    const restore = f.presenter.suspendLoadedRoomRuntime(loaded);
    expect(loaded.runtimeSuspended).toBe(true);
    expect(f.images[0].active).toBe(false);
    expect(f.options.setLiveObjectsDormant).toHaveBeenLastCalledWith(
      loaded,
      true,
    );
    f.images[0].destroy();
    restore();
    expect(loaded.runtimeSuspended).toBe(false);
    expect(f.images[0].active).toBe(false);
    expect(f.images[1].active).toBe(true);
    expect(loaded.terrainCollider.active).toBe(false);
    expect(f.options.setLiveObjectsDormant).toHaveBeenLastCalledWith(
      loaded,
      false,
    );
    expect(
      f.options.setLiveObjectWorldCollisionTargetDormant,
    ).toHaveBeenLastCalledWith(loaded, false);
  });

  it('limits terrain row work while preserving flipped tiles', () => {
    const f = fixture(),
      gid = getTilesetByKey('forest')!.firstGid + 14;
    f.room.tileData.terrain[0][2] = gid | TILE_FLIP_X_FLAG | TILE_FLIP_Y_FLAG;
    f.room.tileData.terrain[1][3] = gid;
    f.presenter.populateTerrainLayerRows(
      f.room,
      f.terrain as unknown as Phaser.Tilemaps.TilemapLayer,
      -5,
      1,
    );
    expect(f.terrain.putTileAt).toHaveBeenCalledExactlyOnceWith(gid, 2, 0);
    expect(f.tile.flipX).toBe(true);
    expect(f.tile.flipY).toBe(true);
    f.presenter.populateTerrainLayerRows(
      f.room,
      f.terrain as unknown as Phaser.Tilemaps.TilemapLayer,
      ROOM_HEIGHT,
      ROOM_HEIGHT + 10,
    );
    expect(f.terrain.putTileAt).toHaveBeenCalledTimes(1);
  });

  it('removes an unleased texture only when it is present', () => {
    const f = fixture();
    f.scene.textures.exists.mockReturnValue(false);
    f.presenter.releaseTextureIfPresent('missing');
    expect(f.scene.textures.remove).not.toHaveBeenCalled();
    f.scene.textures.exists.mockReturnValue(true);
    f.presenter.releaseTextureIfPresent('released');
    expect(f.scene.textures.remove).toHaveBeenCalledExactlyOnceWith('released');
  });
});

describe('full-room backgrounds', () => {
  it('keeps the preparation room read live across the room-origin callback', () => {
    const f = fixture(),
      loaded = f.presenter.createDormantShell(f.identity);
    const replacement = createDefaultRoomSnapshot('1,0', { x: 1, y: 0 });
    replacement.background = 'solid:#abcdef';
    f.options.getRoomOrigin = () => {
      f.identity.room = replacement;
      return { x: 7, y: 9 };
    };
    f.presenter.prepareBackground(loaded, f.identity);
    expect(f.scene.add.rectangle).toHaveBeenCalledWith(
      7,
      9,
      ROOM_PX_WIDTH,
      ROOM_PX_HEIGHT,
      0xabcdef,
    );
  });

  it.each([
    'none',
    'solid:#abcdef',
    'forest',
    'custom:abcdefgh?fit=tile',
    'custom:abcdefgh?fit=stretch',
    'custom:abcdefgh?fit=center',
  ])(
    'creates and activates %s through the same dormant boundary',
    (background) => {
      const f = fixture();
      f.room.background = background;
      const loaded = f.presenter.createDormantShell(f.identity);
      f.presenter.prepareBackground(loaded, f.identity);
      const backgrounds = [
        loaded.backgroundColorRect,
        ...loaded.backgroundSprites.map((b) => b.sprite),
      ].filter(Boolean);
      expect(backgrounds.length).toBeGreaterThan(0);
      for (const object of backgrounds) {
        expect(object!.active).toBe(false);
        expect((object as unknown as { visible: boolean }).visible).toBe(false);
      }
      f.presenter.setPreparedRoomBackgroundActive(loaded, true);
      for (const object of backgrounds) expect(object!.active).toBe(true);
      f.presenter.updateFullRoomBackground(
        loaded,
        f.scene.cameras.main as unknown as Phaser.Cameras.Scene2D.Camera,
      );
    },
  );

  it('keeps the fallback starfield parallax and vertical lock unchanged', () => {
    const f = fixture();
    f.room.background = 'none';
    const loaded = f.presenter.createDormantShell(f.identity);
    f.presenter.prepareBackground(loaded, f.identity);
    f.presenter.setPreparedRoomBackgroundActive(loaded, true);
    f.presenter.updateFullRoomBackground(
      loaded,
      f.scene.cameras.main as unknown as Phaser.Cameras.Scene2D.Camera,
    );
    const first = loaded.backgroundSprites[0]
      .sprite as Phaser.GameObjects.TileSprite;
    const second = loaded.backgroundSprites[1]
      .sprite as Phaser.GameObjects.TileSprite;
    expect(first.tilePositionX).toBeCloseTo(0.7);
    expect(second.tilePositionX).toBeCloseTo((100 * 0.024) / 0.58);
    expect(first.tilePositionY).toBe(0);
    expect(second.tilePositionY).toBe(0);
  });

  it('skips background synchronization outside the camera view', () => {
    const f = fixture(),
      loaded = f.presenter.createDormantShell(f.identity);
    f.presenter.prepareBackground(loaded, f.identity);
    const camera = {
      ...f.scene.cameras.main,
      worldView: { left: 1000, right: 1640, top: 0, bottom: 352 },
    };
    f.presenter.updateFullRoomBackground(
      loaded,
      camera as unknown as Phaser.Cameras.Scene2D.Camera,
    );
    expect(f.rectangles[0].setPosition).not.toHaveBeenCalled();
  });

  it('rejects an unprepared custom background without starting an asynchronous upload', () => {
    const f = fixture();
    f.room.background = 'custom:abcdefgh?fit=stretch';
    f.scene.textures.exists.mockReturnValue(false);
    const load = vi.spyOn(backgrounds, 'ensureCustomBackgroundTexture');
    expect(() =>
      f.presenter.createRoomBackground(
        f.room,
        { x: 0, y: 0 },
        { dormant: true, requireCustomTextureReady: true },
      ),
    ).toThrow('Prepared custom background texture is missing for 0,0.');
    expect(load).not.toHaveBeenCalled();
    expect(f.rectangles[0].destroy).toHaveBeenCalledOnce();
    expect(f.images).toEqual([]);
  });

  it.each(['active', 'destroyed-room', 'destroyed-streamer'] as const)(
    'handles a late custom upload for %s using live lifecycle state',
    async (state) => {
      const f = fixture();
      f.room.background = 'custom:abcdefgh?fit=stretch';
      f.scene.textures.exists.mockReturnValue(false);
      let finish!: (key: string) => void;
      const pending = new Promise<string>((resolve) => {
        finish = resolve;
      });
      vi.spyOn(backgrounds, 'ensureCustomBackgroundTexture').mockReturnValue(
        pending,
      );
      const background = f.presenter.createRoomBackground(f.room, {
        x: 0,
        y: 0,
      });
      if (state === 'destroyed-room') background.colorRect!.destroy();
      if (state === 'destroyed-streamer') f.lifecycle.destroyed = true;
      f.scene.textures.exists.mockReturnValue(true);
      finish('custom_background_abcdefgh');
      await pending;
      await Promise.resolve();
      expect(f.scene.add.image).toHaveBeenCalledTimes(
        state === 'active' ? 1 : 0,
      );
      expect(background.sprites).toHaveLength(state === 'active' ? 1 : 0);
    },
  );
});

describe('full-room resource disposal', () => {
  const order = [
    'edge-walls',
    'live-objects',
    'terrain-collider',
    'inset-collider',
    'inset-clear',
    'inset-group',
    'terrain',
    'map',
    'background-color',
    'background-0',
    'background-1',
    'image',
    'foreground',
  ];
  function disposable(failures: Map<string, unknown>) {
    const f = fixture(),
      events: string[] = [];
    const op = (name: string) => () => {
      events.push(name);
      if (failures.has(name)) throw failures.get(name);
    };
    const loaded = {
      room: f.room,
      edgeWalls: [],
      liveObjects: [],
      terrainCollider: { destroy: op('terrain-collider') },
      terrainInsetCollider: { destroy: op('inset-collider') },
      terrainInsetBodies: {
        clear: op('inset-clear'),
        destroy: op('inset-group'),
      },
      terrainLayer: { destroy: op('terrain') },
      map: { destroy: op('map') },
      backgroundColorRect: { destroy: op('background-color') },
      backgroundSprites: [
        { sprite: { destroy: op('background-0') } },
        { sprite: { destroy: op('background-1') } },
      ],
      image: { destroy: op('image') },
      foregroundImage: { destroy: op('foreground') },
    } as unknown as LoadedFullRoom;
    f.options.destroyEdgeWalls = op('edge-walls');
    f.options.destroyLiveObjects = vi.fn(op('live-objects'));
    return { ...f, events, loaded };
  }
  it.each(order)(
    'attempts every cleanup and rethrows the first %s failure',
    (name) => {
      const first = new Error(name);
      const failures = new Map<string, unknown>([[name, first]]);
      if (name !== 'foreground') failures.set('foreground', new Error('later'));
      const f = disposable(failures);
      let caught: unknown;
      try {
        f.presenter.destroyLoadedRoomResources(f.loaded, true);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBe(first);
      expect(f.events).toEqual(order);
      expect(f.loaded.terrainCollider).toBeNull();
      expect(f.loaded.terrainInsetCollider).toBeNull();
      expect(f.loaded.terrainInsetBodies).toBeNull();
      expect(f.loaded.backgroundColorRect).toBeNull();
      expect(f.loaded.backgroundSprites).toEqual([]);
      expect(f.loaded.foregroundImage).toBeNull();
      expect(f.options.destroyLiveObjects).toHaveBeenCalledWith(f.loaded, {
        preserveTriggerState: true,
      });
    },
  );
  it('retains an undefined first thrown value while still cleaning later resources', () => {
    const f = disposable(
      new Map([
        ['edge-walls', undefined],
        ['image', new Error('later')],
      ]),
    );
    let thrown = false;
    try {
      f.presenter.destroyLoadedRoomResources(f.loaded);
    } catch (error) {
      thrown = true;
      expect(error).toBeUndefined();
    }
    expect(thrown).toBe(true);
    expect(f.events).toEqual(order);
  });
  it('honors the caller batch limit and destroys background sprites from the tail', () => {
    const f = disposable(new Map());
    expect(f.presenter.destroyBackgroundSpriteBatch(f.loaded, 1)).toBe(false);
    expect(f.events).toEqual(['background-1']);
    expect(f.loaded.backgroundSprites).toHaveLength(1);
    expect(f.presenter.destroyBackgroundSpriteBatch(f.loaded, 1)).toBe(true);
    expect(f.events).toEqual(['background-1', 'background-0']);
  });
});
