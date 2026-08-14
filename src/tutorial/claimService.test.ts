import { describe, expect, it, vi } from 'vitest';
import type { AuthDebugState } from '../auth/client';
import {
  createDefaultRoomRecord,
  createDefaultRoomSnapshot,
  createRoomSummaryFromRecord,
} from '../persistence/roomModel';
import { RoomApiError } from '../persistence/roomRepository';
import { TutorialClaimService } from './claimService';
import { rewriteTutorialSnapshotForClaim } from './snapshotTransplant';

const AUTH = {
  authenticated: true,
  user: { id: 'user-1' },
} as AuthDebugState;

function createHarness(input?: {
  auth?: AuthDebugState;
  remaining?: number | null;
  frontier?: boolean;
  saveDraft?: ReturnType<typeof vi.fn>;
  loadRoomCurrent?: ReturnType<typeof vi.fn>;
}) {
  const source = createDefaultRoomSnapshot('-10,-6', { x: -10, y: -6 });
  source.background = 'forest';
  const destination = { x: 4, y: 5 };
  const saveDraft = input?.saveDraft ?? vi.fn(async (snapshot) => {
    const record = createDefaultRoomRecord(snapshot.id, snapshot.coordinates);
    record.draft = snapshot;
    record.claimerUserId = 'user-1';
    return record;
  });
  const loadRoomCurrent = input?.loadRoomCurrent ?? vi.fn(async () => {
    throw new Error('not found');
  });
  const service = new TutorialClaimService({
    roomRepository: { saveDraft, loadRoomCurrent } as never,
    worldRepository: {
      loadClaimableFrontierWindow: vi.fn(async () => ({
        center: destination,
        radius: 0,
        rooms: input?.frontier === false ? [] : [{
          id: '4,5',
          coordinates: destination,
          state: 'frontier',
        }],
        roomDailyClaimLimit: 2,
        roomClaimsUsedToday: 0,
        roomClaimsRemainingToday: input?.remaining ?? 2,
      })) as never,
    },
    getAuthState: () => input?.auth ?? AUTH,
    now: () => new Date('2026-08-14T12:00:00.000Z'),
  });
  return { source, destination, service, saveDraft, loadRoomCurrent };
}

describe('TutorialClaimService', () => {
  it('retains the draft across sign-in and imports it after reload', async () => {
    const signedOut = createHarness({
      auth: { ...AUTH, authenticated: false, user: null },
    });
    expect(await signedOut.service.claim(signedOut.source, signedOut.destination))
      .toMatchObject({ ok: false, code: 'auth_required' });
    expect(signedOut.saveDraft).not.toHaveBeenCalled();

    const signedIn = createHarness();
    expect(await signedIn.service.claim(signedIn.source, signedIn.destination))
      .toMatchObject({ ok: true, recoveredAfterError: false });
    expect(signedIn.saveDraft).toHaveBeenCalledOnce();
  });

  it('rejects zero remaining claims and stale frontier selections before saving', async () => {
    const limited = createHarness({ remaining: 0 });
    expect(await limited.service.claim(limited.source, limited.destination))
      .toMatchObject({ ok: false, code: 'claim_limit' });
    expect(limited.saveDraft).not.toHaveBeenCalled();

    const stale = createHarness({ frontier: false });
    expect(await stale.service.claim(stale.source, stale.destination))
      .toMatchObject({ ok: false, code: 'stale_frontier' });
    expect(stale.saveDraft).not.toHaveBeenCalled();
  });

  it('recovers a successful import when the save response is lost', async () => {
    const source = createDefaultRoomSnapshot('-10,-6', { x: -10, y: -6 });
    source.background = 'forest';
    const transplanted = rewriteTutorialSnapshotForClaim(
      source,
      { x: 4, y: 5 },
      '2026-08-14T12:00:00.000Z',
    );
    const record = createDefaultRoomRecord('4,5', { x: 4, y: 5 });
    record.draft = transplanted;
    record.claimerUserId = 'user-1';
    record.claimerDisplayName = 'Builder';
    const harness = createHarness({
      saveDraft: vi.fn(async () => { throw new TypeError('Failed to fetch'); }),
      loadRoomCurrent: vi.fn(async () => ({
        summary: createRoomSummaryFromRecord(record),
        draft: transplanted,
        published: null,
      })),
    });
    harness.source.background = 'forest';

    expect(await harness.service.claim(harness.source, harness.destination))
      .toMatchObject({ ok: true, recoveredAfterError: true });
  });

  it('preserves the private draft when save and read-after-error recovery both fail', async () => {
    const harness = createHarness({
      saveDraft: vi.fn(async () => { throw new TypeError('Failed to fetch'); }),
    });
    expect(await harness.service.claim(harness.source, harness.destination))
      .toMatchObject({ ok: false, code: 'network' });
    expect(harness.source.id).toBe('-10,-6');
  });

  it('distinguishes a concurrent claim and a raced claim-limit failure', async () => {
    const concurrent = createHarness({
      saveDraft: vi.fn(async () => { throw new RoomApiError('claimed', 409); }),
    });
    expect(await concurrent.service.claim(concurrent.source, concurrent.destination))
      .toMatchObject({ ok: false, code: 'concurrent_claim' });

    const limited = createHarness({
      saveDraft: vi.fn(async () => { throw new RoomApiError('limit', 429); }),
    });
    expect(await limited.service.claim(limited.source, limited.destination))
      .toMatchObject({ ok: false, code: 'claim_limit' });
    expect(limited.source.id).toBe('-10,-6');
  });
});
