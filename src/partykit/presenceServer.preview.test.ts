import { afterEach, describe, expect, it } from 'vitest';
import { createDefaultRoomSnapshot } from '../persistence/roomModel';
import {
  clearRoomPreview,
  createTestConstructionPreviewToken,
  type FakePresenceConnection,
  presencePayload,
  PresenceServerHarness,
  roomPreviewPayload,
  sendPresence,
  sendRoomPreview,
  testIdentity,
} from './presenceServer.testHarness';

const PREVIEW_TTL_MS = 120_000;

let harness: PresenceServerHarness | null = null;

afterEach(() => {
  harness?.room.storage.resumeImmediateMutationCompletion();
  harness?.dispose();
  harness = null;
});

describe('PresenceServer construction preview baseline', () => {
  it('accepts only an authorized draft whose token, user, room, and snapshot identity agree', async () => {
    harness = new PresenceServerHarness();
    const identity = testIdentity('editor');
    const editor = await connectEditor(harness, 'editor', 1, 2);
    const validToken = await createTestConstructionPreviewToken(identity, { x: 1, y: 2 });
    const wrongUserToken = await createTestConstructionPreviewToken(testIdentity('other'), {
      x: 1,
      y: 2,
    });
    const wrongRoomToken = await createTestConstructionPreviewToken(identity, { x: 9, y: 9 });
    const publishedSnapshot = {
      ...createDefaultRoomSnapshot('1,2', { x: 1, y: 2 }),
      status: 'published' as const,
      publishedAt: new Date(Date.now()).toISOString(),
    };
    const mismatchedSnapshot = createDefaultRoomSnapshot('8,8', { x: 1, y: 2 });
    const chat = await harness.connect('chat', { identity, channel: 'room-chat' });

    sendRoomPreview(harness, editor, roomPreviewPayload({ roomX: 1, roomY: 2 }));
    sendRoomPreview(
      harness,
      editor,
      roomPreviewPayload({ roomX: 1, roomY: 2, token: wrongUserToken })
    );
    sendRoomPreview(
      harness,
      editor,
      roomPreviewPayload({ roomX: 1, roomY: 2, token: wrongRoomToken })
    );
    sendRoomPreview(
      harness,
      editor,
      roomPreviewPayload({
        roomX: 1,
        roomY: 2,
        token: validToken,
        snapshot: publishedSnapshot,
      })
    );
    sendRoomPreview(
      harness,
      editor,
      roomPreviewPayload({
        roomX: 1,
        roomY: 2,
        token: validToken,
        snapshot: mismatchedSnapshot,
      })
    );
    sendRoomPreview(
      harness,
      chat,
      roomPreviewPayload({ roomX: 1, roomY: 2, token: validToken })
    );
    await harness.settleAsyncWork();

    expect(mutationOperations(harness)).toEqual([]);

    sendRoomPreview(
      harness,
      editor,
      roomPreviewPayload({ roomX: 1, roomY: 2, token: validToken })
    );
    await harness.waitUntilPreviewStored('preview:1,2');

    expect(mutationOperations(harness)).toEqual([
      expect.objectContaining({ type: 'put', key: 'preview:1,2', settled: true }),
    ]);
  });

  it('persists shared identity metadata without persisting the construction token', async () => {
    harness = new PresenceServerHarness();
    const identity = testIdentity('editor');
    const editor = await connectEditor(harness, 'editor', 3, 4);
    const token = await createTestConstructionPreviewToken(identity, { x: 3, y: 4 });

    sendRoomPreview(
      harness,
      editor,
      roomPreviewPayload({ roomX: 3, roomY: 4, token, timestamp: Date.now() - 50 })
    );
    await harness.waitUntilPreviewStored('preview:3,4');

    const stored = harness.room.storage.peek<Record<string, unknown>>('preview:3,4');
    expect(stored).toMatchObject({
      roomId: '3,4',
      roomCoordinates: { x: 3, y: 4 },
      userId: identity.userId,
      displayName: identity.displayName,
      shardId: harness.room.id,
      timestamp: Date.now() - 50,
      snapshot: {
        id: '3,4',
        coordinates: { x: 3, y: 4 },
        status: 'draft',
        publishedAt: null,
      },
    });
    expect(stored).not.toHaveProperty('constructionPreviewToken');
    expect(JSON.stringify(stored)).not.toContain(token);
  });

  it('does not await storage put or delete before changing the shared in-memory view', async () => {
    harness = new PresenceServerHarness();
    const identity = testIdentity('editor');
    const editor = await connectEditor(harness, 'editor', 1, 2);
    const observer = await harness.connect('observer');
    const token = await createTestConstructionPreviewToken(identity, { x: 1, y: 2 });
    await harness.advance(250);
    editor.clearMessages();
    observer.clearMessages();
    harness.room.storage.clearOperationLog();
    harness.room.storage.deferMutationCompletion();

    sendRoomPreview(
      harness,
      editor,
      roomPreviewPayload({ roomX: 1, roomY: 2, token })
    );
    await harness.waitUntil(
      () =>
        mutationOperations(activeHarness()).some(
          (operation) => operation.type === 'put' && operation.key === 'preview:1,2'
        ),
      'deferred preview put'
    );

    expect(mutationOperations(harness)).toEqual([
      expect.objectContaining({ type: 'put', key: 'preview:1,2', settled: false }),
    ]);
    expect(harness.room.storage.peek('preview:1,2')).toBeUndefined();
    await harness.advance(250);
    expect(latestRoomPreviews(observer)).toHaveProperty('1,2');

    expect(harness.room.storage.releaseNextMutation()).toBe(true);
    await harness.waitUntilPreviewStored('preview:1,2');
    expect(harness.room.storage.peek('preview:1,2')).toBeDefined();

    observer.clearMessages();
    harness.room.storage.clearOperationLog();
    clearRoomPreview(harness, editor, { roomX: 1, roomY: 2, timestamp: Date.now() });

    expect(mutationOperations(harness)).toEqual([
      expect.objectContaining({ type: 'delete', key: 'preview:1,2', settled: false }),
    ]);
    await harness.advance(250);
    expect(latestRoomPreviews(observer)).toEqual({});
    expect(harness.room.storage.peek('preview:1,2')).toBeDefined();

    expect(harness.room.storage.releaseNextMutation()).toBe(true);
    await harness.waitUntil(
      () => activeHarness().room.storage.peek('preview:1,2') === undefined,
      'deferred preview delete'
    );
    expect(harness.room.storage.peek('preview:1,2')).toBeUndefined();
  });

  it('keeps a preview through exactly 120 seconds and prunes it one millisecond later', async () => {
    harness = new PresenceServerHarness();
    const createdAt = Date.now();
    const identity = testIdentity('editor');
    const editor = await connectEditor(harness, 'editor', 1, 2);
    const token = await createTestConstructionPreviewToken(identity, { x: 1, y: 2 });
    sendRoomPreview(
      harness,
      editor,
      roomPreviewPayload({ roomX: 1, roomY: 2, token, timestamp: createdAt })
    );
    await harness.waitUntilPreviewStored('preview:1,2');
    await harness.reactivate();
    harness.room.storage.clearOperationLog();

    harness.setTime(createdAt + PREVIEW_TTL_MS);
    const boundaryViewer = await harness.connect('boundary-viewer');
    expect(latestRoomPreviews(boundaryViewer)).toHaveProperty('1,2');
    expect(mutationOperations(harness)).toEqual([]);

    harness.setTime(createdAt + PREVIEW_TTL_MS + 1);
    const expiredViewer = await harness.connect('expired-viewer');
    await harness.waitUntil(
      () =>
        mutationOperations(activeHarness()).some(
          (operation) =>
            operation.type === 'delete' &&
            operation.key === 'preview:1,2' &&
            operation.settled
        ),
      'expired preview delete'
    );
    expect(latestRoomPreviews(expiredViewer)).toEqual({});
    expect(mutationOperations(harness)).toEqual([
      expect.objectContaining({ type: 'delete', key: 'preview:1,2', settled: true }),
    ]);
  });

  it('protects a newer persisted preview from an older clear but treats an equal timestamp as current', async () => {
    harness = new PresenceServerHarness();
    const previewTimestamp = Date.now() + 1_000;
    const identity = testIdentity('editor');
    const editor = await connectEditor(harness, 'editor', 1, 2);
    const token = await createTestConstructionPreviewToken(identity, { x: 1, y: 2 });
    sendRoomPreview(
      harness,
      editor,
      roomPreviewPayload({ roomX: 1, roomY: 2, token, timestamp: previewTimestamp })
    );
    await harness.waitUntilPreviewStored('preview:1,2');
    await harness.reactivate();
    const clearer = await harness.connect('clearer');
    await harness.advance(250);
    clearer.clearMessages();
    harness.room.storage.clearOperationLog();

    clearRoomPreview(harness, clearer, {
      roomX: 1,
      roomY: 2,
      timestamp: previewTimestamp - 1,
    });
    expect(mutationOperations(harness)).toEqual([]);
    expect(harness.room.storage.peek('preview:1,2')).toBeDefined();

    clearRoomPreview(harness, clearer, {
      roomX: 1,
      roomY: 2,
      timestamp: previewTimestamp,
    });
    await harness.settleAsyncWork();
    expect(mutationOperations(harness)).toEqual([
      expect.objectContaining({ type: 'delete', key: 'preview:1,2', settled: true }),
    ]);
    await harness.advance(250);
    expect(latestRoomPreviews(clearer)).toEqual({});
  });

  it('deletes the old room before persisting the new room when an editor moves', async () => {
    harness = new PresenceServerHarness();
    const identity = testIdentity('editor');
    const editor = await connectEditor(harness, 'editor', 1, 2);
    const firstToken = await createTestConstructionPreviewToken(identity, { x: 1, y: 2 });
    const secondToken = await createTestConstructionPreviewToken(identity, { x: 3, y: 4 });
    sendRoomPreview(
      harness,
      editor,
      roomPreviewPayload({ roomX: 1, roomY: 2, token: firstToken })
    );
    await harness.waitUntilPreviewStored('preview:1,2');
    await harness.advance(250);
    editor.clearMessages();
    harness.room.storage.clearOperationLog();

    sendPresence(
      harness,
      editor,
      presencePayload({ roomX: 3, roomY: 4, mode: 'edit' })
    );
    sendRoomPreview(
      harness,
      editor,
      roomPreviewPayload({ roomX: 3, roomY: 4, token: secondToken })
    );
    await harness.waitUntilPreviewStored('preview:3,4');

    expect(mutationOperations(harness).map((operation) => [operation.type, operation.key])).toEqual([
      ['delete', 'preview:1,2'],
      ['put', 'preview:3,4'],
    ]);
    await harness.advance(250);
    expect(Object.keys(latestRoomPreviews(editor))).toEqual(['3,4']);
  });

  it('reactivates valid shared previews and asynchronously deletes invalid or expired storage', async () => {
    harness = new PresenceServerHarness();
    const now = Date.now();
    harness.room.storage.seed('preview:5,6', storedPreview(5, 6, now));
    harness.room.storage.seed(
      'preview:7,8',
      storedPreview(7, 8, now - PREVIEW_TTL_MS - 1)
    );
    harness.room.storage.seed('preview:invalid', { roomId: 'invalid' });
    harness.room.storage.clearOperationLog();
    harness.room.storage.deferMutationCompletion();

    await harness.reactivate();

    expect(harness.room.storage.operations).toEqual([
      { type: 'list', prefix: 'preview:', settled: true },
      expect.objectContaining({ type: 'delete', key: 'preview:7,8', settled: false }),
      expect.objectContaining({ type: 'delete', key: 'preview:invalid', settled: false }),
    ]);
    const viewer = await harness.connect('viewer');
    expect(Object.keys(latestRoomPreviews(viewer))).toEqual(['5,6']);
    expect(harness.room.storage.peek('preview:7,8')).toBeDefined();

    harness.room.storage.releaseAllMutations();
    await harness.settleAsyncWork();
    expect(harness.room.storage.peek('preview:7,8')).toBeUndefined();
    expect(harness.room.storage.peek('preview:invalid')).toBeUndefined();
  });

  it('cleans up shared previews exactly once on explicit leave and socket close', async () => {
    harness = new PresenceServerHarness();
    const identity = testIdentity('editor');
    const editor = await connectEditor(harness, 'editor', 1, 2);
    const observer = await harness.connect('observer');
    const token = await createTestConstructionPreviewToken(identity, { x: 1, y: 2 });
    sendRoomPreview(
      harness,
      editor,
      roomPreviewPayload({ roomX: 1, roomY: 2, token })
    );
    await harness.waitUntilPreviewStored('preview:1,2');
    await harness.advance(250);
    observer.clearMessages();
    harness.room.storage.clearOperationLog();

    harness.server.onMessage(
      JSON.stringify({ type: 'presence:leave' }),
      editor.asPartyConnection()
    );
    await harness.settleAsyncWork();
    expect(deleteKeys(harness)).toEqual(['preview:1,2']);
    await harness.advance(250);
    expect(latestRoomPreviews(observer)).toEqual({});

    sendPresence(harness, editor, presencePayload({ roomX: 1, roomY: 2, mode: 'edit' }));
    sendRoomPreview(
      harness,
      editor,
      roomPreviewPayload({ roomX: 1, roomY: 2, token })
    );
    await harness.waitUntilPreviewStored('preview:1,2');
    await harness.advance(250);
    observer.clearMessages();
    harness.room.storage.clearOperationLog();

    harness.close(editor);
    await harness.settleAsyncWork();
    expect(deleteKeys(harness)).toEqual(['preview:1,2']);
    await harness.advance(250);
    expect(latestRoomPreviews(observer)).toEqual({});
  });
});

function activeHarness(): PresenceServerHarness {
  if (!harness) {
    throw new Error('Expected presence harness to be initialized');
  }
  return harness;
}

async function connectEditor(
  activeHarness: PresenceServerHarness,
  id: string,
  roomX: number,
  roomY: number
): Promise<FakePresenceConnection> {
  const connection = await activeHarness.connect(id, { identity: testIdentity(id) });
  sendPresence(
    activeHarness,
    connection,
    presencePayload({ roomX, roomY, mode: 'edit' })
  );
  await activeHarness.advance(250);
  connection.clearMessages();
  activeHarness.room.storage.clearOperationLog();
  return connection;
}

function latestRoomPreviews(
  connection: FakePresenceConnection
): Record<string, Record<string, unknown>> {
  const message = connection
    .messages<{ type?: string; roomPreviews?: Record<string, Record<string, unknown>> }>()
    .filter((candidate) => candidate.type === 'snapshot' || candidate.type === 'populations')
    .at(-1);
  return message?.roomPreviews ?? {};
}

function mutationOperations(activeHarness: PresenceServerHarness) {
  return activeHarness.room.storage.operations.filter(
    (operation) => operation.type === 'put' || operation.type === 'delete'
  );
}

function deleteKeys(activeHarness: PresenceServerHarness): string[] {
  return mutationOperations(activeHarness)
    .filter((operation) => operation.type === 'delete')
    .map((operation) => operation.key);
}

function storedPreview(roomX: number, roomY: number, timestamp: number) {
  const roomId = `${roomX},${roomY}`;
  return {
    roomId,
    roomCoordinates: { x: roomX, y: roomY },
    snapshot: createDefaultRoomSnapshot(roomId, { x: roomX, y: roomY }),
    timestamp,
    userId: 'stored-user',
    displayName: 'Stored User',
    shardId: 'stored-shard',
  };
}
