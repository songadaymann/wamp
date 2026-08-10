import { describe, expect, it } from 'vitest';
import {
  LAYER_NAMES,
  ROOM_HEIGHT,
  ROOM_WIDTH,
  TILESETS,
  decodeTileDataValue,
  getTilesetByKey,
  isTilesetLocalTileEditorEnabled,
  type PlacedObject,
} from '../../../config';
import { createDefaultRoomSnapshot } from '../../../persistence/roomModel';
import { HttpError } from '../core/http';
import {
  MAX_ROOM_DRAFT_COMMANDS,
  MAX_ROOM_DRAFT_TILE_WRITES,
  MAX_SET_TILES_PER_COMMAND,
  applyRoomDraftCommands,
  normalizeRoomDraftCommandsRequestBody,
} from './commandCore';
import { parseRoomDraftCommandsRequest } from './commands';

function blankRoom() {
  return createDefaultRoomSnapshot('0,0', { x: 0, y: 0 });
}

function normalize(commands: unknown[]) {
  return normalizeRoomDraftCommandsRequestBody({ base: 'blank', commands });
}

describe('room draft command tiles', () => {
  it('rejects command request bodies larger than 2 MB before JSON parsing', async () => {
    const request = new Request('https://api.wamp.land/api/rooms/0,0/draft/commands', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ base: 'blank', commands: [{ type: 'set_title', title: 'x'.repeat(2 * 1024 * 1024) }] }),
    });
    await expect(parseRoomDraftCommandsRequest(request)).rejects.toMatchObject({ status: 413 });
  });

  it('stamps an editor-enabled local tile from every canonical tileset', () => {
    const commands = TILESETS.map((tileset, index) => ({
      type: 'set_tiles',
      tilesetKey: tileset.key,
      layer: 'terrain',
      tiles: [{
        tileX: index,
        tileY: 0,
        localIndex: Array.from({ length: tileset.tileCount }, (_, localIndex) => localIndex)
          .find((localIndex) => isTilesetLocalTileEditorEnabled(tileset, localIndex)),
      }],
    }));
    const body = normalize(commands);
    const result = applyRoomDraftCommands(blankRoom(), body.commands);
    for (let index = 0; index < TILESETS.length; index += 1) {
      const tileset = TILESETS[index];
      expect(decodeTileDataValue(result.snapshot.tileData.terrain[0][index]).gid).toBe(tileset.firstGid + commands[index].tiles[0].localIndex!);
    }
  });

  it('supports every layer, flips, and deterministic later-write wins ordering', () => {
    const body = normalize([
      ...LAYER_NAMES.map((layer, index) => ({
        type: 'set_tiles', tilesetKey: 'cybercity yellow', layer,
        tiles: [{ tileX: index, tileY: 1, localIndex: 2, flipX: true, flipY: true }],
      })),
      {
        type: 'set_tiles', tilesetKey: 'forest', layer: 'terrain',
        tiles: [
          { tileX: 5, tileY: 5, localIndex: 1 },
          { tileX: 5, tileY: 5, localIndex: 2 },
        ],
      },
    ]);
    const result = applyRoomDraftCommands(blankRoom(), body.commands).snapshot;
    for (let index = 0; index < LAYER_NAMES.length; index += 1) {
      expect(decodeTileDataValue(result.tileData[LAYER_NAMES[index]][1][index])).toMatchObject({
        gid: getTilesetByKey('cybercity yellow')!.firstGid + 2,
        flipX: true,
        flipY: true,
      });
    }
    expect(decodeTileDataValue(result.tileData.terrain[5][5]).gid).toBe(getTilesetByKey('forest')!.firstGid + 2);
  });

  it('preserves legacy platform/fill behavior and supports layered erase/clear', () => {
    const body = normalize([
      { type: 'platform', tilesetKey: 'forest', styleId: 'forest_flat', row: 10, colStart: 2, colEnd: 5, depth: 2 },
      { type: 'fill_rect', tilesetKey: 'forest', styleId: 'forest_flat', role: 'fill', tileX: 8, tileY: 8, width: 2, height: 2 },
      { type: 'set_tiles', tilesetKey: 'cybertext', layer: 'foreground', tiles: [{ tileX: 1, tileY: 1, localIndex: 0 }] },
      { type: 'erase_rect', layer: 'foreground', tileX: 1, tileY: 1, width: 1, height: 1 },
      { type: 'clear_layer', layer: 'background' },
    ]);
    const room = applyRoomDraftCommands(blankRoom(), body.commands).snapshot;
    expect(room.tileData.terrain[10].slice(2, 6).every((gid) => gid > 0)).toBe(true);
    expect(room.tileData.terrain[11].slice(2, 6).every((gid) => gid > 0)).toBe(true);
    expect(room.tileData.terrain[8][8]).toBeGreaterThan(0);
    expect(room.tileData.foreground[1][1]).toBe(-1);
    expect(room.tileData.background.flat().every((gid) => gid === -1)).toBe(true);
  });

  it('rejects disabled/out-of-range tiles and all declared limits', () => {
    const special = getTilesetByKey('special')!;
    const disabled = Array.from({ length: special.tileCount }, (_, index) => index)
      .find((index) => !isTilesetLocalTileEditorEnabled(special, index));
    expect(disabled).toBeDefined();
    expect(() => normalize([{ type: 'set_tiles', tilesetKey: 'special', layer: 'terrain', tiles: [{ tileX: 0, tileY: 0, localIndex: disabled }] }])).toThrow(HttpError);
    expect(() => normalize([{ type: 'set_tiles', tilesetKey: 'forest', layer: 'terrain', tiles: [{ tileX: 0, tileY: 0, localIndex: 999 }] }])).toThrow(/outside tileset/);
    expect(() => normalize(Array.from({ length: MAX_ROOM_DRAFT_COMMANDS + 1 }, () => ({ type: 'clear_goal' })))).toThrow(/at most 512/);
    expect(() => normalize([{ type: 'set_tiles', tilesetKey: 'forest', layer: 'terrain', tiles: Array.from({ length: MAX_SET_TILES_PER_COMMAND + 1 }, () => ({ tileX: 0, tileY: 0, localIndex: 0 })) }])).toThrow(/at most 880/);
    expect(() => normalize(Array.from({ length: 4 }, (_, index) => ({ type: 'clear_layer', layer: LAYER_NAMES[index % LAYER_NAMES.length] })))).toThrow(`${MAX_ROOM_DRAFT_TILE_WRITES}`);
  });
});

describe('room draft command objects and goals', () => {
  it('resolves refs for links, ordered paths, containers, signs, NPCs, Sword Hunters, and NPC quests', () => {
    const body = normalize([
      { type: 'place_object', ref: 'door', objectId: 'door_locked', tileX: 10, tileY: 10 },
      { type: 'place_object', ref: 'plate', objectId: 'floor_trigger', tileX: 8, tileY: 10 },
      { type: 'configure_object', target: { ref: 'plate' }, linkedTargets: [{ ref: 'door' }] },
      { type: 'place_object', ref: 'portal-a', objectId: 'portal_a', tileX: 2, tileY: 10 },
      { type: 'place_object', ref: 'portal-b', objectId: 'portal_b', tileX: 35, tileY: 10 },
      { type: 'configure_object', target: { ref: 'portal-a' }, linkedTargets: [{ ref: 'portal-b' }] },
      { type: 'place_object', ref: 'stop-1', objectId: 'moving_platform_endpoint', tileX: 12, tileY: 6 },
      { type: 'place_object', ref: 'stop-2', objectId: 'moving_platform_endpoint', tileX: 20, tileY: 6 },
      { type: 'place_object', ref: 'platform', objectId: 'moving_platform', tileX: 10, tileY: 6 },
      { type: 'configure_object', target: { ref: 'platform' }, linkedTargets: [{ ref: 'stop-1' }, { ref: 'stop-2' }] },
      { type: 'place_object', ref: 'crate', objectId: 'crate', tileX: 15, tileY: 10 },
      { type: 'configure_object', target: { ref: 'crate' }, containedObjectId: 'kitkat' },
      { type: 'place_object', ref: 'sign', objectId: 'sign', tileX: 3, tileY: 10 },
      { type: 'configure_object', target: { ref: 'sign' }, signText: 'Catalog parity!' },
      { type: 'place_object', ref: 'jim', objectId: 'jimothy', tileX: 25, tileY: 10, facing: 'left' },
      { type: 'configure_object', target: { ref: 'jim' }, npcMode: 'follow', npcPushable: false, npcCanJumpFall: true, npcPlayerCollision: false, npcFriendlyFire: false, npcName: 'Guide Jim', npcDefeatMode: 'respawn', signText: 'Follow me.' },
      { type: 'place_object', ref: 'hunter', objectId: 'swordsman_ai', tileX: 30, tileY: 10 },
      { type: 'configure_object', target: { ref: 'hunter' }, swordsmanObjectiveMode: 'collect', swordsmanDefeatMode: 'invincible' },
      { type: 'set_goal', goal: { type: 'npc_quest', questType: 'escort', npc: { ref: 'jim' }, destination: { tileX: 38, tileY: 10 } } },
    ]);
    const result = applyRoomDraftCommands(blankRoom(), body.commands);
    const byRef = (ref: string) => result.snapshot.placedObjects.find((placed) => placed.instanceId === result.commandRefs[ref])!;
    expect(byRef('plate').triggerTargetInstanceId).toBe(result.commandRefs.door);
    expect(byRef('portal-a').triggerTargetInstanceId).toBe(result.commandRefs['portal-b']);
    expect(byRef('platform').linkedTargetInstanceIds).toEqual([result.commandRefs['stop-1'], result.commandRefs['stop-2']]);
    expect(byRef('crate').containedObjectId).toBe('kitkat');
    expect(byRef('sign').signText).toBe('Catalog parity!');
    expect(byRef('jim')).toMatchObject({ npcMode: 'follow', npcPushable: false, npcCanJumpFall: true, npcPlayerCollision: false, npcFriendlyFire: false, npcName: 'Guide Jim', npcDefeatMode: 'respawn', signText: 'Follow me.' });
    expect(byRef('hunter')).toMatchObject({ swordsmanObjectiveMode: 'collect', swordsmanDefeatMode: 'invincible' });
    expect(result.snapshot.goal).toMatchObject({ type: 'npc_quest', questType: 'escort', npcInstanceId: result.commandRefs.jim });
  });

  it('supports collect_race plus every NPC quest variant and defaults', () => {
    const collectRace = applyRoomDraftCommands(blankRoom(), normalize([{ type: 'set_goal', goal: { type: 'collect_race', timeLimitMs: 9000 } }]).commands);
    expect(collectRace.snapshot.goal).toEqual({ type: 'collect_race', timeLimitMs: 9000 });

    const variants = [
      { questType: 'protect', expected: { durationMs: 30_000, requiredCount: 1, destination: null } },
      { questType: 'escort', destination: { tileX: 10, tileY: 10 }, expected: { durationMs: 30_000, requiredCount: 1 } },
      { questType: 'give', requiredCount: 5, expected: { durationMs: 30_000, requiredCount: 5, destination: null } },
    ] as const;
    for (const variant of variants) {
      const commands = [
        { type: 'place_object', ref: 'npc', objectId: 'jimothy', tileX: 5, tileY: 5 },
        { type: 'set_goal', goal: { type: 'npc_quest', questType: variant.questType, npc: { ref: 'npc' }, ...('destination' in variant ? { destination: variant.destination } : {}), ...('requiredCount' in variant ? { requiredCount: variant.requiredCount } : {}) } },
      ];
      expect(applyRoomDraftCommands(blankRoom(), normalize(commands).commands).snapshot.goal).toMatchObject({ type: 'npc_quest', questType: variant.questType, ...variant.expected });
    }
  });

  it('supports existing instance selectors, removal, and configuration clearing', () => {
    const room = blankRoom();
    const existing: PlacedObject = { id: 'sign', x: 24, y: 16, instanceId: 'obj_existing', signText: 'old' };
    room.placedObjects.push(existing);
    const body = normalize([
      { type: 'configure_object', target: { instanceId: 'obj_existing' }, signText: null, layer: 'foreground' },
      { type: 'remove_object', target: { instanceId: 'obj_existing' } },
    ]);
    expect(applyRoomDraftCommands(room, body.commands).snapshot.placedObjects).toEqual([]);
    expect(room.placedObjects).toEqual([existing]);
  });

  it('rejects invalid refs, capabilities, combinations, and duplicate refs', () => {
    expect(() => normalize([{ type: 'configure_object', target: { ref: 'later' }, signText: 'nope' }, { type: 'place_object', ref: 'later', objectId: 'sign', tileX: 1, tileY: 1 }])).toThrow(/earlier place_object/);
    expect(() => normalize([{ type: 'place_object', ref: 'same', objectId: 'sign', tileX: 1, tileY: 1 }, { type: 'place_object', ref: 'same', objectId: 'sign', tileX: 2, tileY: 1 }])).toThrow(/already used/);
    expect(() => normalize([{ type: 'place_object', objectId: 'coin_gold', tileX: 1, tileY: 1, facing: 'left' }])).toThrow(/not supported/);
    expect(() => normalize([{ type: 'clear_goal', surprise: true }])).toThrow(/unsupported field/);

    const invalidLink = normalize([
      { type: 'place_object', ref: 'portal', objectId: 'portal_a', tileX: 1, tileY: 1 },
      { type: 'place_object', ref: 'coin', objectId: 'coin_gold', tileX: 2, tileY: 1 },
      { type: 'configure_object', target: { ref: 'portal' }, linkedTargets: [{ ref: 'coin' }] },
    ]);
    expect(() => applyRoomDraftCommands(blankRoom(), invalidLink.commands)).toThrow(/not a valid link target/);

    const invalidContainer = normalize([
      { type: 'place_object', ref: 'crate', objectId: 'crate', tileX: 1, tileY: 1 },
      { type: 'configure_object', target: { ref: 'crate' }, containedObjectId: 'slime_blue' },
    ]);
    expect(() => applyRoomDraftCommands(blankRoom(), invalidContainer.commands)).toThrow(/cannot be stored/);
  });

  it('keeps application atomic when a later command fails', () => {
    const base = blankRoom();
    const body = normalize([
      { type: 'set_title', title: 'must not leak' },
      { type: 'place_object', ref: 'coin', objectId: 'coin_gold', tileX: 1, tileY: 1 },
      { type: 'configure_object', target: { ref: 'coin' }, containedObjectId: 'gem' },
    ]);
    expect(() => applyRoomDraftCommands(base, body.commands)).toThrow(/not a container/);
    expect(base.title).not.toBe('must not leak');
    expect(base.placedObjects).toEqual([]);
  });

  it('allows an ordered 12-stop path and rejects a thirteenth target', () => {
    const placements = Array.from({ length: 12 }, (_, index) => ({ type: 'place_object', ref: `stop-${index}`, objectId: 'moving_platform_endpoint', tileX: index, tileY: 2 }));
    const valid = normalize([
      ...placements,
      { type: 'place_object', ref: 'platform', objectId: 'moving_platform', tileX: 15, tileY: 2 },
      { type: 'configure_object', target: { ref: 'platform' }, linkedTargets: placements.map((_, index) => ({ ref: `stop-${index}` })) },
    ]);
    const result = applyRoomDraftCommands(blankRoom(), valid.commands);
    expect(result.snapshot.placedObjects.find((placed) => placed.instanceId === result.commandRefs.platform)?.linkedTargetInstanceIds).toHaveLength(12);
    expect(() => normalize([
      ...placements,
      { type: 'place_object', ref: 'stop-12', objectId: 'moving_platform_endpoint', tileX: 12, tileY: 2 },
      { type: 'place_object', ref: 'platform', objectId: 'moving_platform', tileX: 15, tileY: 2 },
      { type: 'configure_object', target: { ref: 'platform' }, linkedTargets: Array.from({ length: 13 }, (_, index) => ({ ref: `stop-${index}` })) },
    ])).toThrow(/at most 12/);
  });

  it('enforces room coordinate bounds for tiles and rectangles', () => {
    expect(() => normalize([{ type: 'set_tiles', tilesetKey: 'forest', layer: 'terrain', tiles: [{ tileX: ROOM_WIDTH, tileY: 0, localIndex: 0 }] }])).toThrow(/less than 40/);
    expect(() => normalize([{ type: 'erase_rect', tileX: 0, tileY: ROOM_HEIGHT - 1, width: 1, height: 2 }])).toThrow(/exceeds room bounds/);
  });
});
