import { describe, expect, it, vi } from 'vitest';
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
    getElementById: (id: string) => { if (!items.has(id)) items.set(id, new Item()); return items.get(id); },
    querySelectorAll: (selector: string) => selector.startsWith('#explore-filters') ? filters
      : selector.startsWith('#explore-sorts') ? sorts : selector.startsWith('#explore-builder-sorts') ? builderSorts : [],
    createElement: () => new Item(),
  });
  const explore = new ExploreModalController({} as never, {} as never, {} as never, doc as unknown as Document, {} as never);
  const state = explore as unknown as Record<string, unknown> & { render(): void };
  const pressed = (items: Item[], key: string) => items.filter(item => item.getAttribute('aria-pressed') === 'true').map(item => item.dataset[key]);
  return { filters, sorts, builderSorts, state, pressed };
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
