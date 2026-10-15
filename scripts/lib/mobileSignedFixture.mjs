import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

/** Synthetic account for input, editor and Activity checks; every API write stays intercepted. */
export async function installMobileSignedFixture(context, { roomChat = false, roomEditor = false, activity = false } = {}) {
  const recorded = JSON.parse(gunzipSync(readFileSync('scripts/fixtures/mobile-smoke-api.json.gz')).toString());
  const session = JSON.parse(recorded.entries.find(entry => entry.path === '/api/auth/session').text);
  const profile = JSON.parse(recorded.entries.find(entry => entry.path.endsWith('/summary')).text);
  const userId = 'mobile-smoke-fixture';
  const json = (route, body) => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': route.request().headers().origin ?? '*', 'access-control-allow-credentials': 'true' }, body: JSON.stringify(body) });
  if (roomEditor) {
    const snapshot = JSON.parse(recorded.entries.find(entry => entry.path === '/api/rooms/0%2C0/published').text);
    const summary = { ...JSON.parse(recorded.entries.find(entry => entry.path === '/api/rooms/0%2C0/summary').text), claimerUserId: userId, mintedTokenId: null, mintedOwnerWalletAddress: null, permissions: { canSaveDraft: true, canPublish: true, canRevert: false, canMint: false } };
    let draft = { ...snapshot, music: null };
    const reply = (route, body) => json(route, body);
    await context.route(url => url.pathname === '/api/music/phrases', route => reply(route, { items: [], nextCursor: null }));
    await context.route(url => url.pathname === '/api/rooms/0%2C0/summary', route => reply(route, summary));
    await context.route(url => url.pathname === '/api/rooms/0%2C0/current', route => reply(route, { summary, draft, published: snapshot }));
    await context.route(url => url.pathname === '/api/rooms/0%2C0/draft', route => {
      if (route.request().method() === 'OPTIONS') return route.fallback();
      if (route.request().method() !== 'PUT') throw new Error('Only isolated editor draft saves are expected');
      draft = route.request().postDataJSON();
      return reply(route, { summary: { ...summary, draftVersion: draft.version, draftUpdatedAt: draft.updatedAt }, draft, published: snapshot });
    });
    await context.route(url => /^\/api\/rooms\/[^/]+\/published$/.test(url.pathname) && url.pathname !== '/api/rooms/0%2C0/published', route => {
      const id = decodeURIComponent(new URL(route.request().url()).pathname.split('/')[3]);
      const [x, y] = id.split(',').map(Number);
      return reply(route, { ...snapshot, id, coordinates: { x, y }, title: 'Fixture neighbor', goal: null, music: null });
    });
    await context.route(url => url.pathname === '/api/world', route => { const q = new URL(route.request().url()).searchParams; return reply(route, { center: { x: Number(q.get('x') ?? 0), y: Number(q.get('y') ?? 0) }, radius: Number(q.get('radius') ?? 1), rooms: [] }); });
  }
  await context.route(url => url.pathname === '/api/me/activity', route => json(route, { entries: [], unreadCount: activity ? 3 : 0, latestId: 0, nextBefore: null, preferences: { weeklyDigest: false, dethroneAlerts: false, dailyFeatures: false, emailAvailable: false } }));
  await context.route('**/api/auth/session', route => json(route, { ...session, source: 'session', partykitHost: roomChat ? 'presence.invalid' : '', partykitParty: 'presence', authenticated: true, user: { id: userId, email: null, walletAddress: null, displayName: 'Mobile Test' }, schoolManaged: false, school: null, chatModeration: { role: 'player', banned: false } }));
  await context.route(`**/api/profiles/${userId}/summary`, route => json(route, { ...profile, userId, displayName: 'Mobile Test', username: null, bio: null, avatarUrl: null, selectedAvatarId: 'default-player', avatarChoices: [] }));
  await context.route('**/api/settings/me', route => json(route, { settings: null, updatedAt: null }));
  await context.route('**/api/lost-songs/progress**', route => json(route, { roomIds: [], total: 0 }));
  await context.route('**/api/leaderboards/rooms/discover**', route => json(route, { sort: 'unrated', results: [], totalCount: 0, difficultyFilter: null }));
  await context.route('**/api/me/guest-progress', route => json(route, { userId, clears: [], totalClears: 0 }));
}
