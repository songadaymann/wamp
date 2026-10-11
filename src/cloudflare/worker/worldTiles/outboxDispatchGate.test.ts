import { describe, expect, it } from 'vitest';
import { requestMayQueueWorldTiles } from './routes';

describe('world-tile outbox dispatch gate (F039)', () => {
  it('dispatches after writes that can publish rooms or change backgrounds', () => {
    for (const path of ['/api/rooms/3%2C4/publish', '/api/rooms/3%2C4/draft', '/api/courses', '/api/courses/abc/publish',
      '/api/expanded-rooms', '/api/background-images/x/status', '/api/worlds/w/publish', '/api/guest-room-drafts/claim',
      '/api/agents/rooms/1,2/publish', '/api/admin/rooms/1,2/unpublish', '/api/test/reset']) {
      expect(requestMayQueueWorldTiles('POST', path), path).toBe(true);
    }
    expect(requestMayQueueWorldTiles('DELETE', '/api/background-images/x')).toBe(true);
  });

  it('skips reads, preflights and writes that never queue tiles', () => {
    for (const path of ['/api/guest-activity/heartbeat', '/api/chat/messages', '/api/guest-replays/start',
      '/api/rooms/snapshots/query', '/api/runs/a/finish', '/api/presence/identity-token', '/api/bug-reports', '/api/nope']) {
      expect(requestMayQueueWorldTiles('POST', path), path).toBe(false);
    }
    expect(requestMayQueueWorldTiles('GET', '/api/rooms/3%2C4')).toBe(false);
    expect(requestMayQueueWorldTiles('OPTIONS', '/api/rooms/3%2C4/publish')).toBe(false);
  });
});
