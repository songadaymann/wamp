import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProgressionLane, ProgressionSummary } from '../progression/model';
import type { UserProfileResponse } from '../profiles/model';
import { createProfileRepository, type ProfileRepository } from '../profiles/profileRepository';
import { invalidateStaleWhileRevalidateCache } from '../api/staleWhileRevalidateCache';
import { loadSeenRewardProgression, saveSeenRewardProgression } from '../progression/rewardStingSeenState';
import { dispatchProgressionFeedback } from '../progression/progressionFeedback';
import { capturePublishProgression, reportPublishProgression } from './feedback';
import { RewardStingCatchupController } from '../ui/setup/rewardStingCatchup';

const state = vi.hoisted(() => ({ userId: 'builder' as string | null }));
vi.mock('../auth/client', () => ({ AUTH_SESSION_REFRESHED_EVENT:'session', getAuthDebugState: () => ({ authenticated: !!state.userId, user: { id: state.userId } }) }));
vi.mock('../progression/progressionFeedback', () => ({ dispatchProgressionFeedback: vi.fn() }));
vi.mock('../ui/setup/profileEvents', () => ({ PROFILE_INVALIDATED_EVENT:'invalidated', requestProfileInvalidation: vi.fn() }));
vi.mock('../avatars/debug', () => ({ appendCryptopunkUnlockOverrideHeaders: vi.fn() }));

function progression(bxp: number): ProgressionSummary {
  const lane = (lane: ProgressionLane, xp: number) => ({ lane, xp, level: 1, currentLevelStartXp: 0, nextLevelXp: 100,
    progressFraction: xp / 100, medalLabel: '', medalTint: '', emblem: '', crown: false, ribbons: 0 });
  return { founderNumber: null, player: lane('player', 0), builder: lane('builder', bxp), curator: lane('curator', 0),
    builderCaps: { trustTier: 'T0', claimLimitPerDay: 4, publishLimitPerDay: 4, objectLimit: 20, collectibleLimit: 20, expandedRoomCellLimit: 2, overrideActive: false },
    featuredBadges: [], badgeCount: 0, trophyCount: 0, recentTrophies: [] };
}
function repository(bxp: number) {
  const loadProfile = vi.fn(async () => ({ progression: progression(bxp) } as UserProfileResponse));
  return { loadProfile, loadProfileByUsername: vi.fn(), updateMyProfile: vi.fn() } satisfies ProfileRepository;
}
const options = () => ({ userId: 'builder', previousProgression: progression(10), contentType: 'room' as const, contentId: '1,2', title: 'Treasure Hunt' });

beforeEach(() => {
  vi.clearAllMocks(); state.userId = 'builder';
  const values = new Map<string, string>();
  vi.stubGlobal('window', { localStorage: { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) } });
});
afterEach(() => { vi.unstubAllGlobals(); invalidateStaleWhileRevalidateCache('profile:'); });

describe('publish progression', () => {
  it('uses fresh profiles and labels only the change around publication, then remembers it for catch-up', async () => {
    const repo = repository(10), previous = await capturePublishProgression('builder', repo);
    repo.loadProfile.mockResolvedValue({ progression: progression(35) } as UserProfileResponse);
    await reportPublishProgression({ ...options(), previousProgression: previous }, repo);
    expect(repo.loadProfile).toHaveBeenCalledWith('builder', { fresh: true });
    expect(dispatchProgressionFeedback).toHaveBeenCalledWith(expect.objectContaining({ reason: 'Published Treasure Hunt',
      previousProgression: progression(10), currentProgression: progression(35) }));
    expect(loadSeenRewardProgression('builder')).toEqual(progression(35));
    await reportPublishProgression({ ...options(), previousProgression: previous }, repo);
    expect(vi.mocked(dispatchProgressionFeedback).mock.lastCall?.[0].previousProgression?.builder.xp).toBe(35);
  });
  it('discards a reply after sign-out or identity switch', async () => {
    const repo = repository(35); state.userId = 'other';
    await reportPublishProgression(options(), repo);
    expect(dispatchProgressionFeedback).not.toHaveBeenCalled(); expect(loadSeenRewardProgression('builder')).toBeNull();
  });
  it('cannot replace a newer action with an older profile', async () => {
    saveSeenRewardProgression('builder', progression(60));
    await reportPublishProgression(options(), repository(35));
    expect(dispatchProgressionFeedback).not.toHaveBeenCalled(); expect(loadSeenRewardProgression('builder')?.builder.xp).toBe(60);
  });
  it('leaves successful publishing independent of an unavailable before/after profile', async () => {
    const repo = repository(35); repo.loadProfile.mockRejectedValue(new Error('offline'));
    expect(await capturePublishProgression('builder', repo)).toBeNull();
    await expect(reportPublishProgression(options(), repo)).resolves.toBeUndefined();
    await reportPublishProgression({ ...options(), previousProgression: null }, repository(35));
    expect(dispatchProgressionFeedback).not.toHaveBeenCalled(); expect(loadSeenRewardProgression('builder')).toBeNull();
  });
  it('bypasses a cached profile for an explicit fresh read', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ progression: progression(10) })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ progression: progression(35) })));
    vi.stubGlobal('fetch', fetchMock);
    const repo = createProfileRepository();
    expect((await repo.loadProfile('builder')).progression.builder.xp).toBe(10);
    expect((await repo.loadProfile('builder', { fresh: true })).progression.builder.xp).toBe(35);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.lastCall?.[1]).toEqual(expect.objectContaining({ cache: 'no-store', signal: expect.any(AbortSignal) }));
  });
  it('a delayed startup catch-up cannot undo already-seen publish XP', async () => {
    let resolve!: (profile: UserProfileResponse) => void;
    const repo=repository(10); repo.loadProfile.mockImplementationOnce(()=>new Promise(done=>{resolve=done;}));
    const win=new EventTarget(); const controller=new RewardStingCatchupController(repo,win as Window,window.localStorage,
      {load:vi.fn()} as unknown as import('../activity/repository').ActivityRepository);
    controller.init(); win.dispatchEvent(new CustomEvent('session',{detail:{authenticated:true,user:{id:'builder'}}}));
    saveSeenRewardProgression('builder',progression(35)); resolve({progression:progression(10)} as UserProfileResponse);
    await Promise.resolve(); await Promise.resolve();
    expect(loadSeenRewardProgression('builder')?.builder.xp).toBe(35); expect(dispatchProgressionFeedback).not.toHaveBeenCalled(); controller.destroy();
  });
});
