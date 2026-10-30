import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('phaser', () => ({ default: {} }));
vi.mock('../../mint/roomMetadataRender', () => ({ renderRoomSnapshotToPngDataUrl: vi.fn() }));
vi.mock('../../auth/client', () => ({ AUTH_STATE_CHANGED_EVENT: 'auth', getAuthDebugState: () => ({ authenticated: true, user: { id: 'me' } }) }));
import { ExploreModalController } from './exploreModal';

class Item extends EventTarget {
  classes = new Set<string>(); attributes = new Map<string, string>(); dataset: Record<string, string> = {};
  disabled = false; title = ''; textContent = ''; className = '';
  classList = { contains: (c: string) => this.classes.has(c), add: (c: string) => this.classes.add(c), remove: (c: string) => this.classes.delete(c),
    toggle: (c: string, on = !this.classes.has(c)) => { if (on) this.classes.add(c); else this.classes.delete(c); return on; } };
  setAttribute(name: string, value: string) { this.attributes.set(name, value); }
  getAttribute(name: string) { return this.attributes.get(name) ?? null; }
  removeAttribute(name: string) { this.attributes.delete(name); }
  replaceChildren() {} appendChild<T>(child: T) { return child; }
}
const button = (data: Record<string, string>) => Object.assign(new Item(), { dataset: data });
function fixture() {
  const filters = ['', 'easy', 'medium', 'hard', 'extreme'].map(exploreDifficulty => button({ exploreDifficulty }));
  const sorts = ['featured', 'popular', 'quality', 'protected', 'builders', 'guestRooms'].map(exploreSort => button({ exploreSort }));
  const builderSorts = ['alphabet', 'rooms', 'recent'].map(exploreBuilderSort => button({ exploreBuilderSort }));
  const items = new Map<string, Item>();
  const doc = Object.assign(new EventTarget(), {
    documentElement: { dataset: { wallet: 'yes' } },
    getElementById: (id: string) => { if (!items.has(id)) items.set(id, new Item()); return items.get(id); },
    querySelectorAll: (selector: string) => selector.startsWith('#explore-filters') ? filters
      : selector.startsWith('#explore-sorts') ? sorts : selector.startsWith('#explore-builder-sorts') ? builderSorts : [],
    createElement: () => new Item(),
  });
  const explore = new ExploreModalController({} as never, {} as never, {} as never, doc as unknown as Document, {} as never);
  const state = explore as unknown as Record<string, unknown> & { render(): void; loadDiscoveryResults(): Promise<void>; handleAuthStateChanged(event: Event): void };
  const pressed = (items: Item[], key: string) => items.filter(item => item.getAttribute('aria-pressed') === 'true').map(item => item.dataset[key]);
  return { filters, sorts, builderSorts, state, pressed, doc, explore };
}

describe('Explore shows which filter and sort are on (F464)', () => {
  it('marks the picked difficulty and sort, including Popular, for sight and screen readers', () => {
    const f = fixture();
    Object.assign(f.state, { discoverFilter: 'medium', discoverSort: 'popular', loading: true });
    f.state.render();
    expect(f.pressed(f.filters, 'exploreDifficulty')).toEqual(['medium']);
    expect(f.pressed(f.sorts, 'exploreSort')).toEqual(['popular']);
    expect(f.filters.every(item => item.getAttribute('aria-pressed') !== null)).toBe(true);
    for (const item of [...f.filters, ...f.sorts]) {
      expect(item.classes.has('active')).toBe(item.getAttribute('aria-pressed') === 'true');
    }
    expect(f.pressed(f.builderSorts, 'exploreBuilderSort')).toEqual([]);
  });

  it('marks All by default and moves the pressed sort to Builders and its A-Z order', () => {
    const f = fixture();
    Object.assign(f.state, { loading: true });
    f.state.render();
    expect(f.pressed(f.filters, 'exploreDifficulty')).toEqual(['']);
    expect(f.pressed(f.sorts, 'exploreSort')).toEqual(['featured']);
    Object.assign(f.state, { exploreMode: 'builders' });
    f.state.render();
    expect(f.pressed(f.sorts, 'exploreSort')).toEqual(['builders']);
    expect(f.pressed(f.builderSorts, 'exploreBuilderSort')).toEqual(['alphabet']);
  });
});


afterEach(() => vi.unstubAllGlobals());
describe('Protected Explore requires a connected wallet (F479)', () => {
  it.each([false, true])('does not show Protected for an installed but disconnected wallet (%s)', connected => {
    const f = fixture();
    Object.assign(f.state, { loading: true, authState: { walletConnected: connected, walletAddress: connected ? '0xowner' : null },
      roomDiscovery: { protectedDiscoveryAvailable: true } });
    f.state.render();
    expect(f.sorts.find(button => button.dataset.exploreSort === 'protected')?.classes.has('hidden')).toBe(!connected);
  });

  it('ignores a programmatic protected pick without a connected wallet', () => {
    vi.stubGlobal('window', new EventTarget());
    const f = fixture(), load = vi.fn(); Object.assign(f.state, { runRepository: { loadRoomDiscovery: load } });
    f.explore.init(); f.sorts.find(button => button.dataset.exploreSort === 'protected')?.dispatchEvent(new Event('click'));
    expect(load).not.toHaveBeenCalled(); expect(f.state.discoverSort).toBe('featured');
    f.explore.destroy();
  });

  it('resets on disconnect and rejects a delayed Protected response', async () => {
    const f = fixture(); vi.spyOn(f.state, 'render').mockImplementation(() => {});
    let resolveProtected!: (value: unknown) => void;
    const featured = { results: [], protectedDiscoveryAvailable: true, marker: 'featured' };
    const load = vi.fn().mockImplementationOnce(() => new Promise(resolve => { resolveProtected = resolve; }))
      .mockResolvedValue(featured);
    Object.assign(f.state, { discoverSort: 'protected', authState: { walletConnected: true, walletAddress: '0xowner' },
      runRepository: { loadRoomDiscovery: load } });
    const pending = f.state.loadDiscoveryResults();
    f.state.handleAuthStateChanged(new CustomEvent('auth', { detail: { authenticated: true, user: { id: 'me' }, walletConnected: false, walletAddress: null } }));
    await Promise.resolve(); await Promise.resolve();
    resolveProtected({ results: [], marker: 'protected' }); await pending;
    expect(load.mock.calls.map(call => call[1])).toEqual(['protected', 'featured']);
    expect(f.state.discoverSort).toBe('featured'); expect(f.state.roomDiscovery).toBe(featured);
  });
});
