import { describe, expect, it, vi } from 'vitest';
vi.mock('phaser', () => ({ default: {} }));
vi.mock('../../auth/client', () => ({ AUTH_STATE_CHANGED_EVENT: 'auth', getAuthDebugState: () => ({ authenticated: false, user: null }), refreshAuthSession: vi.fn() }));
vi.mock('./profileCollection', async (original) => ({
  ...await original<typeof import('./profileCollection')>(),
  createProfileCollectionController: () => ({ sync: vi.fn() }),
}));
vi.mock('./collectionAttribution', () => ({ CollectionAttributionController: class { refresh() {} } }));
import { ProfileModalController } from './profileModal';

class Item extends EventTarget {
  classes = new Set<string>(); attributes = new Map<string, string>(); focused = false;
  classList = { contains: (c: string) => this.classes.has(c), add: (c: string) => this.classes.add(c), remove: (c: string) => this.classes.delete(c),
    toggle: (c: string, on = !this.classes.has(c)) => { if (on) this.classes.add(c); else this.classes.delete(c); return on; } };
  constructor(public id = '') { super(); }
  setAttribute(name: string, value: string) { this.attributes.set(name, value); }
  getAttribute(name: string) { return this.attributes.get(name) ?? null; }
  click() { this.dispatchEvent(new Event('click')); }
  focus() { this.focused = true; }
}
const TAB_ORDER = ['rooms', 'collection', 'playlists', 'progress', 'stats'];
function fixture() {
  const items = new Map<string, Item>();
  const get = (id: string) => { if (!items.has(id)) items.set(id, new Item(id)); return items.get(id)!; };
  const tab = (name: string) => get(`btn-profile-tab-${name}`);
  tab('collection').classes.add('hidden');
  const tabList = { querySelectorAll: (selector: string) => selector === '[role="tab"]:not(.hidden)'
    ? TAB_ORDER.map(tab).filter(item => item.getAttribute('role') === 'tab' && !item.classes.has('hidden')) : [] };
  for (const name of TAB_ORDER) Object.assign(tab(name), { parentElement: tabList });
  const doc = Object.assign(new EventTarget(), { getElementById: get, querySelectorAll: () => [] });
  const win = Object.assign(new EventTarget(), { location: { pathname: '/' } });
  const profile = new ProfileModalController({} as never, {} as never, {} as never, doc as unknown as Document, win as unknown as Window, {} as never, {} as never);
  profile.init();
  const state = profile as unknown as Record<string, unknown> & { renderTabs(): void };
  state.renderTabs();
  return { tab, get, state };
}
function press(target: Item, key: string) {
  const event = Object.assign(new Event('keydown', { cancelable: true }), { key });
  target.dispatchEvent(event);
  return event;
}

describe('profile tabs are a tab list (F464)', () => {
  it('gives each tab its role and panel, and only the selected tab a Tab stop', () => {
    const f = fixture();
    expect(f.tab('rooms').getAttribute('role')).toBe('tab');
    expect(f.tab('rooms').getAttribute('aria-controls')).toBe('profile-rooms-panel');
    expect(f.get('profile-stats-panel').getAttribute('role')).toBe('tabpanel');
    expect(f.get('profile-stats-panel').getAttribute('aria-labelledby')).toBe('btn-profile-tab-stats');
    expect(TAB_ORDER.map(name => f.tab(name).getAttribute('aria-selected'))).toEqual(['true', 'false', 'false', 'false', 'false']);
    expect(TAB_ORDER.map(name => f.tab(name).getAttribute('tabindex'))).toEqual(['0', '-1', '-1', '-1', '-1']);
  });

  it('moves the selection with the arrow keys, Home and End, skipping a hidden tab', () => {
    const f = fixture();
    expect(press(f.tab('rooms'), 'ArrowRight').defaultPrevented).toBe(true);
    expect(f.tab('playlists').getAttribute('aria-selected')).toBe('true');
    expect(f.tab('playlists').getAttribute('tabindex')).toBe('0');
    expect(f.tab('playlists').focused).toBe(true);
    press(f.tab('playlists'), 'End');
    expect(f.tab('stats').getAttribute('aria-selected')).toBe('true');
    press(f.tab('stats'), 'ArrowRight');
    expect(f.tab('rooms').getAttribute('aria-selected')).toBe('true');
    press(f.tab('rooms'), 'ArrowLeft');
    expect(f.tab('stats').getAttribute('aria-selected')).toBe('true');
    press(f.tab('stats'), 'Home');
    expect(f.tab('rooms').getAttribute('aria-selected')).toBe('true');
    expect(press(f.tab('rooms'), 'Enter').defaultPrevented).toBe(false);
  });

  it('gives the Tab stop to the first shown tab while a hidden Collection tab is still selected', () => {
    const f = fixture();
    Object.assign(f.state, { activeTab: 'collection', loading: true });
    f.state.renderTabs();
    expect(f.tab('collection').getAttribute('aria-selected')).toBe('true');
    expect(TAB_ORDER.map(name => f.tab(name).getAttribute('tabindex'))).toEqual(['0', '-1', '-1', '-1', '-1']);
  });
});
