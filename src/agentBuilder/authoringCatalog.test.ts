import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BACKGROUND_GROUPS,
  GAME_OBJECTS,
  TILESETS,
  isClimbableObjectConfig,
} from '../config';
import { ROOM_GOAL_TYPES } from '../goals/roomGoals';
import type { Env } from '../cloudflare/worker/core/types';
import worker from '../cloudflare/worker';
import {
  AUTHORING_CATALOG_CACHE_CONTROL,
  AUTHORING_CATALOG_SCHEMA_VERSION,
  getAuthoringCatalog,
  renderAuthoringDocuments,
} from './authoringCatalog';
import { getAgentTilesetCatalogResponse } from './tilesetCatalog';
import { ROOM_DRAFT_COMMAND_TYPES } from '../cloudflare/worker/rooms/commandCore';
import { writeAuthoringDocuments } from './authoringDocumentsWriter';
import { WORLD_TILE_AUTHORING_ASSET_CONTRACT_HASH } from '../worldTiles/assetContract';

describe('authoring catalog', () => {
  it('has one entry for every canonical built-in registry item', () => {
    const catalog = getAuthoringCatalog();
    expect(catalog.schemaVersion).toBe(2);
    expect(catalog.rendererAssetContractHash).toBe(WORLD_TILE_AUTHORING_ASSET_CONTRACT_HASH);
    expect(catalog.tilesets.map((entry) => entry.key)).toEqual(TILESETS.map((entry) => entry.key));
    expect(catalog.objects.map((entry) => entry.id)).toEqual(GAME_OBJECTS.map((entry) => entry.id));
    expect(catalog.backgrounds.groups.map((entry) => entry.id)).toEqual(BACKGROUND_GROUPS.map((entry) => entry.id));
    expect(catalog.goals.map((entry) => entry.type)).toEqual(ROOM_GOAL_TYPES);
  });

  it('exposes every tileset independently of optional build styles', () => {
    const catalog = getAuthoringCatalog();
    for (const entry of catalog.tilesets) {
      expect(entry.assetPath).toBeTruthy();
      expect(entry.tileCount).toBeGreaterThan(0);
      expect(
        entry.collisionLocalIndices.full.length
        + entry.collisionLocalIndices.decoratedTop.length
        + entry.collisionLocalIndices.none.length,
      ).toBe(entry.tileCount);
      expect(entry.disabledEditorLocalIndices.length).toBeLessThan(entry.tileCount);
    }
    expect(catalog.tilesets.find((entry) => entry.key === 'cybertext')?.assetPath).toContain('CyberText.png');
    expect(catalog.tilesets.find((entry) => entry.key === 'cybercity yellow')?.rows).toBe(7);
    expect(catalog.tilesets.find((entry) => entry.key === 'essentials')?.buildStyles).toEqual([]);

    const boygame = catalog.tilesets.find((entry) => entry.key === 'boygame');
    expect(boygame).toMatchObject({
      name: 'Boygame',
      assetPath: expect.stringContaining('boygame.png'),
      imageWidth: 128,
      imageHeight: 112,
      columns: 8,
      rows: 7,
      tileCount: 56,
      gidStart: 1801,
      gidEnd: 1856,
    });
    expect(boygame?.disabledEditorLocalIndices).toContain(17);
    expect(boygame?.disabledEditorLocalIndices).not.toContain(10);
    expect(boygame?.collisionLocalIndices.full).toContain(10);
    expect(boygame?.buildStyles).toContainEqual(expect.objectContaining({
      id: 'boygame_ruins',
      surfaceLocalIndices: [10],
    }));

    const jungleVines = catalog.tilesets.find((entry) => entry.key === 'jungle-vines');
    expect(jungleVines).toMatchObject({
      name: 'Jungle Vines',
      assetPath: expect.stringContaining('jungle-vines.png'),
      imageWidth: 144,
      imageHeight: 128,
      columns: 9,
      rows: 8,
      tileCount: 72,
      gidStart: 2001,
      gidEnd: 2072,
    });
    expect(jungleVines?.collisionLocalIndices.none).toHaveLength(72);
    expect(jungleVines?.disabledEditorLocalIndices).toContain(32);
    expect(jungleVines?.disabledEditorLocalIndices).not.toContain(35);
  });

  it('derives current object capabilities and marks spawn_point non-placeable', () => {
    const objects = new Map(getAuthoringCatalog().objects.map((entry) => [entry.id, entry]));
    expect(objects.get('spawn_point')?.capabilities.placeable).toBe(false);
    expect(objects.get('jimothy')?.capabilities.npc?.modes).toEqual(['idle', 'wander', 'patrol', 'follow']);
    expect(objects.get('jimothy')?.capabilities.signText.supported).toBe(true);
    expect(objects.get('portal_a')?.capabilities.links.targetObjectIds).toEqual(['portal_b']);
    expect(objects.get('moving_platform')?.capabilities.links).toMatchObject({ ordered: true, maximumTargets: 12 });
    expect(objects.get('floor_trigger')?.capabilities.links.targetObjectIds).toContain('door_locked_narrow');
    expect(objects.get('crate')?.capabilities.container.allowedObjectIds).toContain('kitkat');
    expect(objects.get('block_switch')).toBeDefined();
    expect(objects.get('switch_block_on')).toBeDefined();
    expect(objects.get('swordsman_ai')?.capabilities.swordsman?.objectiveModes).toEqual(['duel', 'collect']);
    expect(objects.get('police_patrolman')?.capabilities.police).toMatchObject({
      behaviorModes: ['hunter', 'patrol'],
      defaults: { behaviorMode: 'hunter', patrolShoots: false },
    });
    expect(objects.get('policewoman')?.capabilities.police).toBeTruthy();
    expect(objects.get('boygame_coin')).toMatchObject({ category: 'collectible', frameCount: 4, behavior: 'animated' });
    expect(objects.get('boygame_heart')).toMatchObject({ category: 'collectible', frameCount: 9, behavior: 'animated' });
    expect(objects.get('boygame_wall_torch')).toMatchObject({ category: 'decoration', frameCount: 4, behavior: 'animated' });

    expect(GAME_OBJECTS.find((entry) => entry.id === 'boygame_coin')?.animationFrames).toEqual([0, 1, 3, 1]);
    expect(GAME_OBJECTS.find((entry) => entry.id === 'boygame_heart')?.animationFrames).toEqual([0, 1, 4, 5, 6, 7, 6, 5, 4, 1]);
    expect(GAME_OBJECTS.find((entry) => entry.id === 'boygame_wall_torch')?.lightEmission).toMatchObject({
      glowColor: 0x9bbc0f,
      flicker: {
        radiusAmplitude: 0.06,
        alphaAmplitude: 0.08,
        speedHz: 1.25,
      },
    });

    const jungleObjects = GAME_OBJECTS.filter((entry) => entry.id.startsWith('jungle_'));
    expect(jungleObjects).toHaveLength(15);
    expect(jungleObjects.filter(isClimbableObjectConfig).map((entry) => entry.id)).toEqual([
      'jungle_climbing_vine_1',
      'jungle_climbing_vine_2',
      'jungle_climbing_vine_3',
      'jungle_climbing_vine_4',
      'jungle_climbing_vine_5',
      'jungle_climbing_vine_6',
    ]);
    expect(jungleObjects.filter((entry) => entry.category === 'decoration')).toHaveLength(9);
    expect(
      GAME_OBJECTS
        .filter((entry) => entry.category === 'decoration')
        .every((entry) => Boolean(entry.decorationPaletteGroup)),
    ).toBe(true);
    const treePackObjects = GAME_OBJECTS.filter((entry) => entry.id.startsWith('tree_pack_'));
    expect(treePackObjects).toHaveLength(221);
    expect(treePackObjects.every((entry) => (
      entry.category === 'decoration'
      && entry.decorationPaletteGroup === 'trees'
      && entry.displayScale === 0.5
      && entry.bodyWidth === 0
      && entry.bodyHeight === 0
    ))).toBe(true);
    expect(treePackObjects.filter((entry) => entry.treePaletteFamily === 'bonsai')).toHaveLength(21);
    expect(treePackObjects.filter((entry) => entry.treePaletteFamily === 'basic')).toHaveLength(20);
    expect(treePackObjects.filter((entry) => entry.decorationPaletteSubgroup === 'woodland')).toHaveLength(80);
    expect(treePackObjects.filter((entry) => entry.decorationPaletteSubgroup === 'tropical')).toHaveLength(60);
    expect(treePackObjects.filter((entry) => entry.decorationPaletteSubgroup === 'blossom')).toHaveLength(20);
    expect(treePackObjects.filter((entry) => entry.decorationPaletteSubgroup === 'bonsai')).toHaveLength(41);
    expect(treePackObjects.filter((entry) => entry.decorationPaletteSubgroup === 'winter')).toHaveLength(20);
    expect(GAME_OBJECTS.filter((entry) => entry.decorationPaletteGroup === 'trees')).toHaveLength(226);
    expect(GAME_OBJECTS.filter((entry) => entry.treePaletteFamily === 'classic')).toHaveLength(5);
    expect(GAME_OBJECTS.filter((entry) => entry.decorationPaletteGroup === 'vines')).toHaveLength(9);
    expect(isClimbableObjectConfig(GAME_OBJECTS.find((entry) => entry.id === 'ladder'))).toBe(true);
    expect(isClimbableObjectConfig(GAME_OBJECTS.find((entry) => entry.id === 'jungle_loop_vine'))).toBe(false);

    expect(BACKGROUND_GROUPS.find((entry) => entry.id === 'jungle_vines')).toMatchObject({
      name: 'Jungle Vines',
      bgColor: '#d2f7bb',
      layers: expect.arrayContaining([
        expect.objectContaining({ key: 'jungle_vines_0', width: 384, height: 176, scrollFactor: 0 }),
        expect.objectContaining({ key: 'jungle_vines_5', width: 384, height: 176, scrollFactor: 0.6 }),
      ]),
    });
    expect(BACKGROUND_GROUPS.find((entry) => entry.id === 'jungle_vines')?.layers).toHaveLength(6);
  });

  it('keeps the legacy tileset route projection stable', () => {
    const legacy = getAgentTilesetCatalogResponse();
    const unified = getAuthoringCatalog();
    expect(legacy.tilesets).toEqual(unified.tilesets.map((entry) => ({
      key: entry.key,
      name: entry.name,
      gidStart: entry.gidStart,
      gidEnd: entry.gidEnd,
      decoratedTopLocalIndices: entry.decoratedTopLocalIndices,
      decoratedTopGids: entry.decoratedTopGids,
      nonCollidingLocalIndices: entry.nonCollidingLocalIndices,
      nonCollidingGids: entry.nonCollidingGids,
      buildStyles: entry.buildStyles,
    })));
  });

  it('renders complete registry-derived Markdown and keeps OpenAPI command enums in parity', () => {
    const documents = renderAuthoringDocuments();
    for (const object of GAME_OBJECTS) expect(documents['agent-room-authoring.md']).toContain(`\`${object.id}\``);
    for (const tileset of TILESETS) expect(documents['agent-tilesets.md']).toContain(`\`${tileset.key}\``);
    for (const goalType of ROOM_GOAL_TYPES) expect(documents['agent-room-authoring.md']).toContain(`\`${goalType}\``);

    const openapi = JSON.parse(readFileSync(resolve(process.cwd(), 'public/openapi.json'), 'utf8')) as {
      info: { version: string };
      components: {
        schemas: {
          AuthoringCatalog: { properties: { schemaVersion: { const: number } } };
          RoomDraftCommand: { oneOf: Array<{ properties: { type: { const: string } } }> };
        };
      };
    };
    expect(openapi.info.version).toBe('0.9.0');
    expect(openapi.components.schemas.AuthoringCatalog.properties.schemaVersion.const)
      .toBe(AUTHORING_CATALOG_SCHEMA_VERSION);
    expect(openapi.components.schemas.RoomDraftCommand.oneOf.map((schema) => schema.properties.type.const))
      .toEqual(ROOM_DRAFT_COMMAND_TYPES);
  });

  it('writes byte-identical Pages Markdown from the Worker renderers', () => {
    const outputDirectory = mkdtempSync(join(tmpdir(), 'wamp-authoring-docs-'));
    try {
      const documents = renderAuthoringDocuments();
      writeAuthoringDocuments(outputDirectory);
      for (const [filename, contents] of Object.entries(documents)) {
        expect(readFileSync(resolve(outputDirectory, filename), 'utf8')).toBe(contents);
      }
    } finally {
      rmSync(outputDirectory, { recursive: true, force: true });
    }
  });
});

describe('authoring catalog routes', () => {
  const env = {} as Env;

  it('serves the unified catalog with CORS and a short public cache lifetime', async () => {
    const response = await worker.fetch(new Request('https://api.wamp.land/api/authoring/catalog'), env);
    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    expect(response.headers.get('cache-control')).toBe(AUTHORING_CATALOG_CACHE_CONTROL);
    expect(await response.json()).toEqual(getAuthoringCatalog());
  });

  it('serves legacy tilesets and generated Markdown from the same contracts', async () => {
    const tilesetsResponse = await worker.fetch(new Request('https://api.wamp.land/api/tilesets'), env);
    expect(tilesetsResponse.headers.get('cache-control')).toBe(AUTHORING_CATALOG_CACHE_CONTROL);
    expect(await tilesetsResponse.json()).toEqual(getAgentTilesetCatalogResponse());

    const documents = renderAuthoringDocuments();
    for (const filename of Object.keys(documents) as Array<keyof typeof documents>) {
      const response = await worker.fetch(new Request(`https://api.wamp.land/${filename}`), env);
      expect(response.headers.get('content-type')).toContain('text/markdown');
      expect(await response.text()).toBe(documents[filename]);
    }
  });
});
