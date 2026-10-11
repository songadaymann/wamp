import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./library', async (actual) => ({
  ...await actual<object>(),
  cloneMusicPhraseRecord: (value: { id: string } | null) => (value ? { ...value } : null),
}));

const responses = new Map<string, () => Response>();
const fetchMock = vi.fn(async (url: string | URL | Request) => {
  const id = decodeURIComponent(String(url).split('/').pop() ?? '');
  const respond = responses.get(id);
  return respond ? respond() : new Response('Phrase not found.', { status: 404 });
});

async function load() {
  vi.resetModules();
  vi.stubGlobal('fetch', fetchMock);
  return import('./libraryClient');
}
const ok = (id: string) => () => Response.json({ item: { id, instrumentId: 'saw' } });

afterEach(() => { vi.unstubAllGlobals(); fetchMock.mockClear(); responses.clear(); });

describe('loading an arrangement\'s phrases (F222)', () => {
  it('keeps the phrases that load when one is missing, instead of failing the whole arrangement', async () => {
    responses.set('a', ok('a')); responses.set('c', ok('c'));
    const { loadMusicPhrasesById } = await load();
    const phrases = await loadMusicPhrasesById(['a', 'b', 'c', 'a']);
    expect([...phrases.keys()].sort()).toEqual(['a', 'c']);
  });

  it('does not remember a failed request: the next load asks again', async () => {
    const { loadMusicPhrasesById } = await load();
    responses.set('a', ok('a'));
    await loadMusicPhrasesById(['a', 'b']);
    responses.set('b', ok('b'));
    const phrases = await loadMusicPhrasesById(['a', 'b']);
    expect([...phrases.keys()].sort()).toEqual(['a', 'b']);
    const requested = fetchMock.mock.calls.map((call) => String(call[0]).split('/').pop());
    expect(requested.filter((id) => id === 'a')).toHaveLength(1); // a success stays cached
    expect(requested.filter((id) => id === 'b')).toHaveLength(2);
  });

  it('still fails when no phrase could be loaded', async () => {
    const { loadMusicPhrasesById } = await load();
    await expect(loadMusicPhrasesById(['x', 'y'])).rejects.toThrow('Phrase not found.');
    await expect(loadMusicPhrasesById([])).resolves.toEqual(new Map());
  });
});
