import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

/** Synthetic account for focusing a permitted chat field; every API write stays intercepted. */
export async function installMobileSignedFixture(context, { roomChat = false } = {}) {
  const recorded = JSON.parse(gunzipSync(readFileSync('scripts/fixtures/mobile-smoke-api.json.gz')).toString());
  const session = JSON.parse(recorded.entries.find(entry => entry.path === '/api/auth/session').text);
  const profile = JSON.parse(recorded.entries.find(entry => entry.path.endsWith('/summary')).text);
  const userId = 'mobile-smoke-fixture';
  const json = (route, body) => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': route.request().headers().origin ?? '*', 'access-control-allow-credentials': 'true' }, body: JSON.stringify(body) });
  await context.route('**/api/auth/session', route => json(route, { ...session, partykitHost: roomChat ? 'presence.invalid' : '', partykitParty: 'presence', authenticated: true, user: { id: userId, email: null, walletAddress: null, displayName: 'Mobile Test' }, schoolManaged: false, school: null, chatModeration: { role: 'player', banned: false } }));
  await context.route(`**/api/profiles/${userId}/summary`, route => json(route, { ...profile, userId, displayName: 'Mobile Test', username: null, bio: null, avatarUrl: null, selectedAvatarId: 'default-player', avatarChoices: [] }));
  await context.route('**/api/settings/me', route => json(route, { settings: null, updatedAt: null }));
  await context.route('**/api/lost-songs/progress**', route => json(route, { roomIds: [], total: 0 }));
  await context.route('**/api/leaderboards/rooms/discover**', route => json(route, { sort: 'unrated', results: [], totalCount: 0, difficultyFilter: null }));
  await context.route('**/api/me/guest-progress', route => json(route, { userId, clears: [], totalClears: 0 }));
}
