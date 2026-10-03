import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

// Classroom accounts must not post public text, link personal accounts, or mint. Each of these
// paths was open before; keep the check next to the handler so it cannot silently disappear.
describe('school-managed accounts are blocked from public and personal-account actions', () => {
  it.each([
    ['../playlists/routes.ts', "assertNotSchoolRestricted(auth, 'create playlists')"],
    ['../playlists/routes.ts', "assertNotSchoolRestricted(auth, 'update playlists')"],
    ['../playlists/routes.ts', "assertNotSchoolRestricted(auth, 'add rooms to playlists')"],
    ['../wampOGram/routes.ts', "assertNotSchoolRestricted(auth, 'send Wamp-O-Grams')"],
    ['../agents/routes.ts', "assertUserNotSchoolManaged(env, session.user.id, 'create agents')"],
    ['../auth/routes.ts', "assertUserNotSchoolManaged(env, session.user.id, 'create API tokens')"],
    ['../auth/routes.ts', "assertNotSchoolRestricted(auth, 'change their display name')"],
    ['../auth/routes.ts', "assertNotSchoolRestricted(existingAuth, 'add an email address')"],
    ['../auth/routes.ts', "assertNotSchoolRestricted(existingAuth, 'link a wallet')"],
    ['../auth/request.ts', 'if (auth.school) {'],
  ])('%s keeps %s', (path, check) => {
    expect(read(path)).toContain(check);
  });
});
