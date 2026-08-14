import { describe, expect, it, vi } from 'vitest';

vi.mock('../../visuals/starfield', () => ({
  createStarfieldTileSprite: vi.fn(),
  getStarfieldLayerConfig: vi.fn(),
}));

import { OverworldBackdropController } from './backdropController';

function createLayer(label: string, events: string[]) {
  const layer = {
    active: true,
    visible: true,
    alpha: 1,
    renderFlags: 15,
    cameraFilter: 0,
    displayList: {},
    list: [] as unknown[],
    setDepth: vi.fn((depth: number) => {
      events.push(`${label}.depth:${depth}`);
      return layer;
    }),
    setActive: vi.fn(() => layer),
    setVisible: vi.fn(() => layer),
    setAlpha: vi.fn(() => layer),
    add: vi.fn((objects: unknown | unknown[]) => {
      events.push(`${label}.add`);
      const additions = Array.isArray(objects) ? objects : [objects];
      for (const object of additions) {
        if (!layer.list.includes(object)) layer.list.push(object);
      }
      return layer;
    }),
    willRender: vi.fn(() => true),
    destroy: vi.fn(() => events.push(`${label}.destroy`)),
  };
  return layer;
}

function createCamera(label: string, events: string[]) {
  return {
    id: label === 'main' ? 1 : 2,
    visible: true,
    alpha: 1,
    transparent: false,
    scrollX: 120,
    scrollY: -60,
    ignore: vi.fn((object: unknown) => events.push(`${label}.ignore:${String(Boolean(object))}`)),
    setScroll: vi.fn((x: number, y: number) => {
      events.push(`${label}.scroll:${x},${y}`);
    }),
    setRoundPixels: vi.fn(() => events.push(`${label}.round`)),
    setSize: vi.fn((width: number, height: number) => {
      events.push(`${label}.size:${width}x${height}`);
    }),
  };
}

function createSprite(label: string, events: string[]) {
  return {
    tilePositionX: 0,
    tilePositionY: 0,
    setPosition: vi.fn((x: number, y: number) => events.push(`${label}.position:${x},${y}`)),
    setSize: vi.fn((width: number, height: number) =>
      events.push(`${label}.size:${width}x${height}`)),
    setTileScale: vi.fn((x: number, y: number) => events.push(`${label}.scale:${x},${y}`)),
    destroy: vi.fn(() => events.push(`${label}.destroy`)),
  };
}

function createHarness() {
  const events: string[] = [];
  const mainCamera = createCamera('main', events);
  const backdropCamera = createCamera('backdrop', events);
  const backdropLayer = createLayer('backdropLayer', events);
  const worldLayer = createLayer('worldLayer', events);
  const layers = [backdropLayer, worldLayer];
  const sprites = [createSprite('star0', events), createSprite('star1', events)];
  const worldObjects = [{ id: 'player' }, { id: 'terrain' }, { id: 'hud' }];
  const cameras = {
    main: mainCamera,
    cameras: [mainCamera],
    add: vi.fn(() => {
      events.push('camera.add');
      cameras.cameras.push(backdropCamera);
      return backdropCamera;
    }),
    remove: vi.fn((camera: unknown, destroy: boolean) => {
      events.push(`camera.remove:${destroy}`);
      const index = cameras.cameras.indexOf(camera as typeof mainCamera);
      if (index >= 0) cameras.cameras.splice(index, 1);
    }),
  };
  let layerIndex = 0;
  const scene = {
    scale: { width: 640, height: 352 },
    add: {
      layer: vi.fn(() => layers[layerIndex++]),
    },
    cameras,
  };
  const collectWorldObjects = vi.fn(() => worldObjects);
  const updateWorldBackgrounds = vi.fn(() => events.push('worldBackgrounds.update'));
  const controller = new OverworldBackdropController(
    {
      scene: scene as never,
      collectWorldObjects: collectWorldObjects as never,
      updateWorldBackgrounds,
    },
    {
      createStarfieldTileSprite: vi.fn((_scene, options) => {
        events.push(`star.create:${options.depth}:${options.alpha}`);
        return sprites.shift() as never;
      }),
      getStarfieldLayerConfig: (index) => index === 0
        ? { parallax: 0.04, tileScale: 1, alpha: 0.8 }
        : { parallax: 0.12, tileScale: 0.5, alpha: 0.25 },
    },
  );

  return {
    controller,
    events,
    scene,
    cameras,
    mainCamera,
    backdropCamera,
    backdropLayer,
    worldLayer,
    worldObjects,
    collectWorldObjects,
    updateWorldBackgrounds,
  };
}

describe('OverworldBackdropController', () => {
  it('creates the starfields and orders the backdrop camera before the main camera', () => {
    const harness = createHarness();

    harness.controller.create();

    expect(harness.events.slice(0, 6)).toEqual([
      'backdropLayer.depth:-1000',
      'worldLayer.depth:0',
      'star.create:-80:0.8',
      'star.create:-79:0.25',
      'backdropLayer.add',
      'camera.add',
    ]);
    expect(harness.cameras.cameras).toEqual([harness.backdropCamera, harness.mainCamera]);
    expect(harness.backdropCamera.setRoundPixels).toHaveBeenCalledOnce();
    expect(harness.controller.isCameraActive()).toBe(true);
    expect(harness.controller.getLayerCount()).toBe(2);
  });

  it('preserves parallax calculations and updates room backgrounds first', () => {
    const harness = createHarness();
    harness.controller.create();
    harness.events.length = 0;

    harness.controller.update();

    expect(harness.events[0]).toBe('worldBackgrounds.update');
    const starfields = harness.backdropLayer.list as Array<{
      tilePositionX: number;
      tilePositionY: number;
    }>;
    expect(starfields[0].tilePositionX).toBeCloseTo(4.8);
    expect(starfields[0].tilePositionY).toBeCloseTo(-2.4);
    expect(starfields[1].tilePositionX).toBeCloseTo(28.8);
    expect(starfields[1].tilePositionY).toBeCloseTo(-14.4);
    expect(harness.backdropCamera.setScroll).toHaveBeenLastCalledWith(0, 0);
  });

  it('resizes both starfield layers and the backdrop camera', () => {
    const harness = createHarness();
    harness.controller.create();
    harness.scene.scale.width = 375;
    harness.scene.scale.height = 667;

    harness.controller.resize();

    const starfields = harness.backdropLayer.list as Array<{
      setPosition: ReturnType<typeof vi.fn>;
      setSize: ReturnType<typeof vi.fn>;
      setTileScale: ReturnType<typeof vi.fn>;
    }>;
    expect(starfields[0].setPosition).toHaveBeenLastCalledWith(0, 0);
    expect(starfields[0].setSize).toHaveBeenLastCalledWith(375, 667);
    expect(starfields[0].setTileScale).toHaveBeenLastCalledWith(1, 1);
    expect(starfields[1].setTileScale).toHaveBeenLastCalledWith(0.5, 0.5);
    expect(harness.backdropCamera.setSize).toHaveBeenLastCalledWith(375, 667);
  });

  it('reapplies the complete collected object set on repeated synchronization', () => {
    const harness = createHarness();
    harness.controller.create();
    harness.worldLayer.add.mockClear();
    harness.collectWorldObjects.mockClear();

    harness.controller.syncIgnores();
    harness.controller.syncIgnores();

    expect(harness.mainCamera.transparent).toBe(true);
    expect(harness.collectWorldObjects).toHaveBeenCalledTimes(2);
    expect(harness.worldLayer.add).toHaveBeenNthCalledWith(1, harness.worldObjects);
    expect(harness.worldLayer.add).toHaveBeenNthCalledWith(2, harness.worldObjects);
    expect(harness.mainCamera.ignore).toHaveBeenCalledWith(harness.backdropLayer);
    expect(harness.backdropCamera.ignore).toHaveBeenCalledWith(harness.worldLayer);
    expect(harness.worldLayer.list).toEqual(harness.worldObjects);
  });

  it('reports the existing display-health contract', () => {
    const harness = createHarness();
    harness.controller.create();

    expect(harness.controller.getDisplayHealth()).toEqual({
      mainCamera: { id: 1, visible: true, alpha: 1 },
      backdropCamera: { id: 2, visible: true, alpha: 1 },
      worldLayer: expect.objectContaining({ childCount: 3, visibleToCamera: true }),
      backdropLayer: expect.objectContaining({ childCount: 2, visibleToCamera: true }),
    });
  });

  it('preserves reset and shutdown teardown ordering', () => {
    const resetHarness = createHarness();
    resetHarness.controller.create();
    resetHarness.events.length = 0;
    resetHarness.controller.reset();
    expect(resetHarness.events).toEqual([
      'camera.remove:true',
      'backdropLayer.destroy',
      'worldLayer.destroy',
    ]);
    expect(resetHarness.controller.isCameraActive()).toBe(false);
    expect(resetHarness.controller.getLayerCount()).toBe(0);

    const destroyHarness = createHarness();
    destroyHarness.controller.create();
    destroyHarness.events.length = 0;
    destroyHarness.controller.destroy();
    expect(destroyHarness.events).toEqual([
      'star0.destroy',
      'star1.destroy',
      'backdropLayer.destroy',
      'worldLayer.destroy',
      'camera.remove:true',
    ]);
  });
});
