import { describe, expect, it } from 'vitest';
import { createAuthState, getAuthStateSnapshot, transitionAuthState, type AuthDebugState } from './sessionState';
import type { AuthSessionResponse, AuthUser } from './model';

const user: AuthUser = { id: 'account-a', displayName: 'Player A', email: 'player@example.invalid', walletAddress: null };
const school = { classroomId: 'class', classroomSlug: 'music-class', classroomName: 'Music', studentId: 'student', studentUsername: 'student1' };
const fresh = () => createAuthState({ storageBackend: 'remote', testResetEnabled: false });
function session(state: AuthDebugState, response: Partial<AuthSessionResponse>, preserveGuestStatus = false) {
  return transitionAuthState(state, { type: 'session', session: { authenticated: true, user, ...response }, preserveGuestStatus });
}
function freezeState(state: AuthDebugState) {
  Object.freeze(state.user); Object.freeze(state.school); Object.freeze(state.chatModeration);
  return Object.freeze(state);
}

describe('auth account transitions', () => {
  it('starts independent guests with injected deployment settings and no account privileges', () => {
    const a = fresh(), b = createAuthState({ storageBackend: 'local', testResetEnabled: true });
    expect(a).toMatchObject({ authenticated: false, user: null, source: null, loading: false,
      storageBackend: 'remote', testResetEnabled: false, roomDailyClaimLimit: null,
      roomClaimsUsedToday: 0, roomClaimsRemainingToday: null, chatModeration: { role: 'none', banned: false } });
    a.chatModeration.banned = true;
    expect(b).toMatchObject({ storageBackend: 'local', testResetEnabled: true, chatModeration: { banned: false } });
  });

  it.each(['session', 'api_token', null] as const)('accepts a server session source %s without changing runtime configuration', source => {
    const initial = { ...fresh(), walletConnected: true, walletAddress: '0xabc',
      walletProjectConfigured: true, walletProjectSource: 'runtime' as const, partykitHost: 'presence.invalid' };
    const next = session(freezeState(initial), { source });
    expect(next).toMatchObject({ authenticated: true, user, source, status: '', walletConnected: true,
      walletAddress: '0xabc', walletProjectConfigured: true, partykitHost: 'presence.invalid' });
    expect(initial.user).toBeNull();
  });

  it('copies server account and school records, preserves zero quotas, and replaces them across accounts', () => {
    const response = { authenticated: true, user: { ...user }, source: 'session' as const, schoolManaged: true,
      school: { ...school }, roomDailyClaimLimit: 0, roomClaimsUsedToday: 4, roomClaimsRemainingToday: 0,
      chatModeration: { role: 'owner' as const, banned: true } };
    const signed = session(fresh(), response);
    response.user.displayName = 'mutated'; response.school.classroomName = 'mutated'; response.chatModeration.banned = false;
    expect(signed).toMatchObject({ user: { displayName: 'Player A' }, school: { classroomName: 'Music' },
      roomDailyClaimLimit: 0, roomClaimsUsedToday: 4, roomClaimsRemainingToday: 0, chatModeration: { banned: true } });
    const switched = session(freezeState(signed), { user: { ...user, id: 'account-b' } });
    expect(switched).toMatchObject({ user: { id: 'account-b' }, source: null, schoolManaged: false, school: null,
      roomDailyClaimLimit: null, roomClaimsUsedToday: 0, roomClaimsRemainingToday: null, chatModeration: { role: 'none', banned: false } });
  });

  it.each(['', 'Use email or wallet.', 'Signed in as Player', 'Signed in with wallet 0x1', 'Wallet linked to Player'])('clears generic signed-in status %j', status => {
    expect(session({ ...fresh(), status }, {}).status).toBe('');
  });
  it.each(['Email added to your account.', 'Display name saved.', 'Wallet linked.', 'Signed in with email.', 'Failed to send sign-in link.'])('preserves useful status %j', status => {
    expect(session({ ...fresh(), status }, {}).status).toBe(status);
  });

  it('expires a session to a guest and clears account context, including school and quotas', () => {
    const signed = session(fresh(), { source: 'session', schoolManaged: true, school, roomDailyClaimLimit: 8,
      roomClaimsUsedToday: 3, roomClaimsRemainingToday: 5, chatModeration: { role: 'admin', banned: true } });
    expect(session(freezeState(signed), { authenticated: false, user: null })).toMatchObject({ authenticated: false,
      user: null, source: null, schoolManaged: false, school: null, roomDailyClaimLimit: null,
      roomClaimsUsedToday: 0, roomClaimsRemainingToday: null, chatModeration: { role: 'none', banned: false }, status: 'Use email or wallet.' });
  });
  it('preserves an auth-result status when the caller requests it', () => {
    const initial = { ...fresh(), status: 'That sign-in link is invalid or expired.' };
    expect(session(initial, { authenticated: false, user: null }, true).status).toBe(initial.status);
  });
  it('does not invent a sign-out on network failure, but discards stale session metadata', () => {
    const initial = session(fresh(), { source: 'session', schoolManaged: true, school, roomDailyClaimLimit: 8,
      roomClaimsUsedToday: 3, roomClaimsRemainingToday: 5, chatModeration: { role: 'owner', banned: true } });
    const next = transitionAuthState(freezeState(initial), { type: 'session-failed' });
    expect(next).toMatchObject({ authenticated: true, user, status: 'Failed to load account session.', source: null,
      schoolManaged: false, school: null, roomDailyClaimLimit: null, roomClaimsUsedToday: 0,
      roomClaimsRemainingToday: null, chatModeration: { role: 'none', banned: false } });
    expect(session(next, { source: 'session' })).toMatchObject({ authenticated: true, user, source: 'session' });
  });

  it.each(['sign_in', 'link_email'] as const)('requests %s without granting identity before the verified session returns', purpose => {
    const initial = purpose === 'link_email' ? session(fresh(), { user: { ...user, email: null, walletAddress: '0xabc' } }) : fresh();
    const waiting = transitionAuthState(freezeState(initial), { type: 'email-requested',
      response: { ok: true, purpose, delivery: 'email' }, debugMagicLink: null });
    const verified = transitionAuthState(waiting, { type: 'email-verified' });
    expect(waiting.status).toBe('');
    expect(verified).toMatchObject({ authenticated: initial.authenticated, user: initial.user,
      status: 'Signed in with email.', debugMagicLink: null });
    expect(session(verified, {}).user?.email).toBe(user.email);
  });
  it.each([['sign_in', 'Debug sign-in link generated below.'], ['link_email', 'Debug email verification link generated below.']] as const)('retains a normalized debug link for %s', (purpose, status) => {
    const waiting = transitionAuthState(fresh(), { type: 'email-requested', response: { ok: true, purpose, delivery: 'debug' },
      debugMagicLink: 'https://api.invalid/api/auth/verify?token=example' });
    expect(waiting).toMatchObject({ authenticated: false, status, debugMagicLink: 'https://api.invalid/api/auth/verify?token=example' });
    expect(transitionAuthState(waiting, { type: 'email-verified' }).debugMagicLink).toBeNull();
  });

  it('signs out without stale account data while preserving the connected wallet and deployment settings', () => {
    const initial = { ...session(fresh(), { schoolManaged: true, school, source: 'session', roomDailyClaimLimit: 5,
      roomClaimsUsedToday: 4, roomClaimsRemainingToday: 1, chatModeration: { role: 'owner', banned: true } }),
      walletConnected: true, walletAddress: '0xabc', walletProjectConfigured: true, debugMagicLink: 'debug' };
    const next = transitionAuthState(freezeState(initial), { type: 'signed-out' });
    expect(next).toMatchObject({ authenticated: false, user: null, source: null, schoolManaged: false, school: null,
      debugMagicLink: null, roomDailyClaimLimit: null, roomClaimsUsedToday: 0, roomClaimsRemainingToday: null,
      chatModeration: { role: 'none', banned: false }, status: 'Signed out.', walletConnected: true,
      walletAddress: '0xabc', walletProjectConfigured: true, storageBackend: 'remote' });
    expect(transitionAuthState(initial, { type: 'signed-out', status: 'Reset complete.' }).status).toBe('Reset complete.');
  });
  it.each([false, true])('accepts verified wallet identity (linked=%s) without mutating the response', linkedWallet => {
    const response = { authenticated: true as const, linkedWallet, user: { ...user, walletAddress: '0xabc' } };
    const next = transitionAuthState(fresh(), { type: 'wallet-verified', response }); response.user.displayName = 'changed';
    expect(next).toMatchObject({ authenticated: true, user: { displayName: 'Player A', walletAddress: '0xabc' },
      source: 'session', debugMagicLink: null, status: linkedWallet ? 'Wallet linked.' : 'Wallet sign-in complete.' });
  });
  it('updates a verified display name and exposes snapshots without writable account references', () => {
    const signed = session(fresh(), { schoolManaged: true, school });
    const renamed = transitionAuthState(freezeState(signed), { type: 'display-name', user: { ...user, displayName: 'Renamed' } });
    const snapshot = getAuthStateSnapshot(renamed);
    snapshot.user!.displayName = 'outside'; snapshot.school!.classroomName = 'outside'; snapshot.chatModeration.role = 'owner';
    expect(renamed).toMatchObject({ status: 'Display name saved.', user: { displayName: 'Renamed' },
      school: { classroomName: 'Music' }, chatModeration: { role: 'none' } });
    expect(getAuthStateSnapshot(fresh())).toMatchObject({ user: null, school: null });
  });

  it.each(['none', 'admin', 'owner'] as const)('normalizes valid moderation role %s and requires a literal ban flag', role => {
    const next = transitionAuthState(fresh(), { type: 'moderation', viewer: { role, banned: true } });
    expect(next.chatModeration).toEqual({ role, banned: true });
    expect(session(next, { chatModeration: { role, banned: 1 as unknown as boolean } }).chatModeration).toEqual({ role, banned: false });
  });
  it('drops malformed moderation values instead of carrying previous privileges', () => {
    const initial = session(fresh(), { chatModeration: { role: 'owner', banned: true } });
    expect(session(initial, { chatModeration: { role: 'invalid', banned: true } as never }).chatModeration).toEqual({ role: 'none', banned: false });
  });
  it('sets and releases loading without overwriting status on completion or mutating the previous state', () => {
    const initial = freezeState(fresh());
    const loading = transitionAuthState(initial, { type: 'loading', loading: true, status: 'Sending sign-in link...' });
    expect(loading).toMatchObject({ loading: true, status: 'Sending sign-in link...' });
    expect(transitionAuthState(loading, { type: 'loading', loading: false })).toMatchObject({ loading: false, status: loading.status });
    expect(transitionAuthState(loading, { type: 'loading', loading: false, status: '' }).status).toBe(loading.status);
    expect(initial.loading).toBe(false);
  });
  it.each([['email', 'Email sign-in complete.'], ['email-linked', 'Email added to your account.'],
    ['school', 'Classroom sign-in complete.'], ['invalid', 'That sign-in link is invalid or expired.']])('handles auth result %s', (result, status) => {
    expect(transitionAuthState(fresh(), { type: 'query', result }).status).toBe(status);
  });
  it.each([null, 'unknown'])('leaves unknown query result %s alone', result => {
    const initial = freezeState(fresh()); expect(transitionAuthState(initial, { type: 'query', result })).toBe(initial);
  });
});
