import { afterEach, describe, expect, it, vi } from 'vitest';
import { guestRunClaimCopy } from './guestRunClaimCopy';
import { loadGuestRunProgress, recordGuestRunClear, updateGuestRunClearStatus } from './guestRunProgress';
import type { RoomPostRunRatingRequestDetail } from './postRunRatingEvents';

afterEach(() => vi.unstubAllGlobals());
function storage() {
  const entries = new Map<string, string>();
  vi.stubGlobal('window', { localStorage: { getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => entries.set(key, value) } });
  return entries;
}
function detail(clientRunId = 'client'): RoomPostRunRatingRequestDetail {
  return { contentType: 'room', contentId: '-2,3', roomCoordinates: { x: -2, y: 3 }, contentTitle: 'Clear', version: 1,
    elapsedMs: 1000, deaths: 0, score: null, previousViewerRank: null, autoSuggestedDifficulty: 'easy',
    guestProgress: { clientRunId, attemptId: null, status: 'queued', durable: true, reason: null } };
}
describe('guest clear history and truthful claim copy', () => {
  it('updates the right captured clear after a reconnect without duplicating it', () => {
    storage(); recordGuestRunClear(detail('first')); recordGuestRunClear(detail('second'));
    const result = { ...detail('first').guestProgress!, attemptId: 'server-attempt', status: 'saved' as const };
    updateGuestRunClearStatus(result);
    const records = loadGuestRunProgress().records;
    expect(records).toHaveLength(2); expect(records.find(record => record.guestProgress?.clientRunId === 'first')?.guestProgress).toEqual(result);
    expect(records[0].guestProgress?.status).toBe('queued'); expect(records[0].roomCoordinates).toEqual({ x: -2, y: 3 });
    recordGuestRunClear({ ...detail('first'), guestProgress: result }); expect(loadGuestRunProgress().totalClears).toBe(2);
  });
  it('preserves legacy records as unverified replay history', () => {
    const entries = storage(); entries.set('wamp_guest_run_progress_v1', JSON.stringify({ records: [{
      id: 'legacy', contentType: 'room', contentId: '0,0', contentTitle: 'Old clear', version: 1,
      elapsedMs: 1000, deaths: 0, score: 0, potentialPxp: 999999, completedAt: '2026-10-01T00:00:00Z',
    }] }));
    const legacy = loadGuestRunProgress().records[0]; expect(legacy.id).toBe('legacy'); expect(legacy.guestProgress).toBeUndefined();
    const copy = guestRunClaimCopy(legacy.guestProgress); expect(copy.button).toBe('Sign In');
    expect(copy.copy).toContain('replay'); expect(JSON.stringify(copy)).not.toContain('999999');
  });
  it('offers Save Progress only for a server-acknowledged clear and never claims awarded XP or ranks', () => {
    const pending = guestRunClaimCopy(detail().guestProgress); expect(pending.heading).toContain('waiting'); expect(pending.button).toBe('Sign In');
    const volatile = guestRunClaimCopy({ ...detail().guestProgress!, durable: false }); expect(volatile.copy).toContain('tab open');
    const saved = guestRunClaimCopy({ ...detail().guestProgress!, status: 'saved' }); expect(saved.button).toBe('Save Progress'); expect(saved.copy).toContain('14 days');
    for (const copy of [pending, volatile, saved, guestRunClaimCopy(undefined)]) {
      expect(JSON.stringify(copy)).not.toMatch(/You earned|leaderboard progress|20 XP|40 XP/);
    }
  });
  it('clears still complete when storage is blocked', () => {
    vi.stubGlobal('window', { get localStorage() { throw new Error('Blocked'); } });
    expect(recordGuestRunClear(detail()).totalClears).toBe(1); expect(loadGuestRunProgress().totalClears).toBe(0);
    expect(() => updateGuestRunClearStatus(detail().guestProgress!)).not.toThrow();
  });
});
