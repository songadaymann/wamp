import { afterEach, describe, expect, it } from 'vitest';
import { handleAllActivity } from './routes';
import { award, fixture } from './testDatabase';
const opened: ReturnType<typeof fixture>[] = [];
afterEach(() => { for (const f of opened.splice(0)) f.sqlite.close(); });
describe('community activity API', () => {
  it('serves published events without a session or private preferences', async () => {
    const f = fixture(); opened.push(f); award(f, 'a');
    const url = new URL('https://api.wamp.land/api/activity');
    const response = await handleAllActivity(new Request(url), url, f.env);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    const data = await response.json() as { entries: unknown[] };
    expect(data.entries).toHaveLength(1); expect(data).not.toHaveProperty('preferences');
  });
  it.each(['0', '-1', 'NaN', '1.5', '9007199254740992', ''])('rejects invalid cursor %s', async before => {
    const f = fixture(); opened.push(f);
    const url = new URL(`https://api.wamp.land/api/activity?before=${before}`);
    await expect(handleAllActivity(new Request(url), url, f.env)).rejects.toMatchObject({ status: 400 });
  });
});
