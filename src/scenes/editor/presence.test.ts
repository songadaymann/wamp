import { beforeEach, describe, expect, it, vi } from 'vitest';
const auth = vi.hoisted(() => ({ authenticated: false }));
const presence = vi.hoisted(() => ({ activity: vi.fn(), preview: vi.fn() }));
vi.mock('../../auth/client', () => ({ getAuthDebugState: () => auth }));
vi.mock('../../api/request', () => ({ apiRequest: vi.fn() }));
vi.mock('../../presence/worldPresence', () => ({
  resolveWorldPresenceConfig: () => ({}), resolveWorldPresenceIdentity: () => ({ userId: null }),
  WorldPresenceClient: class {
    setSubscribedShards(): void {} destroy(): void {}
    updateLocalPresence = presence.activity;
    updateLocalRoomPreview = presence.preview;
  },
}));
import { apiRequest } from '../../api/request';
import { createDefaultRoomSnapshot } from '../../persistence/roomModel';
import { EditorPresenceController } from './presence';

beforeEach(() => { vi.clearAllMocks(); auth.authenticated = false; });
describe('Guest starter presence', () => {
  it('keeps guest editing activity while never requesting an account-only preview token', () => {
    const controller = new EditorPresenceController({ getRoomCoordinates: () => ({ x: 24, y: 9 }), getEntrySource: () => 'world',
      getPublishedVersion: () => 0, exportRoomSnapshot: () => createDefaultRoomSnapshot(), isPlaying: () => false, isSceneActive: () => true });
    controller.initialize(); for (let i = 0; i < 20; i++) controller.sync();
    expect(presence.activity).toHaveBeenCalledWith(expect.objectContaining({ mode: 'edit' }));
    expect(apiRequest).not.toHaveBeenCalled(); controller.destroy();
  });
});
