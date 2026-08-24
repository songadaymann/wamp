import { afterEach, describe, expect, it } from 'vitest';
import {
  createTestConstructionPreviewToken,
  presencePayload,
  PresenceServerHarness,
  roomPreviewPayload,
  sendPresence,
  sendRoomPreview,
  testIdentity,
} from './presenceServer.testHarness';

const SIGNING_SECRET = 'presence-server-test-secret';

let harness: PresenceServerHarness | null = null;

afterEach(() => {
  harness?.dispose();
  harness = null;
});

describe('PresenceServer construction preview shared-output contract', () => {
  it('omits the construction token and signing secret from broadcasts and snapshots', async () => {
    harness = new PresenceServerHarness();
    const identity = testIdentity('editor');
    const editor = await harness.connect('editor', { identity });
    const observer = await harness.connect('observer');
    sendPresence(harness, editor, presencePayload({ roomX: 1, roomY: 2, mode: 'edit' }));
    await harness.advance(250);
    observer.clearMessages();
    const token = await createTestConstructionPreviewToken(identity, { x: 1, y: 2 });

    sendRoomPreview(
      harness,
      editor,
      roomPreviewPayload({ roomX: 1, roomY: 2, token })
    );
    await harness.waitUntilPreviewStored('preview:1,2');
    await harness.advance(250);
    const lateObserver = await harness.connect('late-observer');

    const populationPreview = observer
      .messages<{ type?: string; roomPreviews?: Record<string, unknown> }>()
      .find((message) => message.type === 'populations')?.roomPreviews;
    const snapshotPreview = lateObserver
      .messages<{ type?: string; roomPreviews?: Record<string, unknown> }>()
      .find((message) => message.type === 'snapshot')?.roomPreviews;

    for (const sharedOutput of [populationPreview, snapshotPreview]) {
      expect(sharedOutput).toHaveProperty('1,2');
      expect(JSON.stringify(sharedOutput)).not.toContain(token);
      expect(JSON.stringify(sharedOutput)).not.toContain(SIGNING_SECRET);
      expect(sharedOutput?.['1,2']).not.toHaveProperty('constructionPreviewToken');
    }
  });
});
