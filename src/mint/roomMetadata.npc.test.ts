import { describe, expect, it } from 'vitest';
import { createDefaultRoomSnapshot } from '../persistence/roomModel';
import {
  buildRoomSnapshotFromMintedPayload,
  buildRoomTokenMetadata,
  extractWampRoomPayloadFromTokenUri,
} from './roomMetadata';

describe('minted NPC room metadata', () => {
  it('round-trips NPC settings and linked quest instance IDs', async () => {
    const snapshot = createDefaultRoomSnapshot('3,4', { x: 3, y: 4 });
    snapshot.placedObjects = [{
      id: 'jimothy',
      x: 120,
      y: 240,
      instanceId: 'npc-1',
      facing: 'left',
      layer: 'terrain',
      signText: 'Meet me at the flag.',
      npcMode: 'patrol',
      npcPushable: true,
      npcCanJumpFall: true,
      npcPlayerCollision: false,
      npcFriendlyFire: false,
      npcName: '',
      npcDefeatMode: 'respawn',
    }];
    snapshot.goal = {
      type: 'npc_quest',
      questType: 'escort',
      npcInstanceId: 'npc-1',
      durationMs: 30_000,
      requiredCount: 3,
      destination: { x: 300, y: 320 },
      timeLimitMs: null,
    };

    const metadata = await buildRoomTokenMetadata(
      snapshot,
      'data:image/png;base64,AA==',
      {
        origin: 'https://example.test',
        chainId: 8453,
        contractAddress: '0x0000000000000000000000000000000000000001',
        tokenId: '1',
      },
    );
    const restored = buildRoomSnapshotFromMintedPayload(
      extractWampRoomPayloadFromTokenUri(metadata.tokenUri),
    );

    expect(restored.goal).toMatchObject({
      type: 'npc_quest',
      questType: 'escort',
      npcInstanceId: 'npc-1',
      destination: { x: 300, y: 320 },
    });
    expect(restored.placedObjects[0]).toMatchObject({
      id: 'jimothy',
      instanceId: 'npc-1',
      facing: 'left',
      layer: 'terrain',
      signText: 'Meet me at the flag.',
      npcMode: 'patrol',
      npcPushable: true,
      npcCanJumpFall: true,
      npcPlayerCollision: false,
      npcFriendlyFire: false,
      npcName: '',
      npcDefeatMode: 'respawn',
    });
  });
});
