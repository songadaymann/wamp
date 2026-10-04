import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../auth/client', () => ({ AUTH_STATE_CHANGED_EVENT: 'auth-state-changed', AUTH_SESSION_REFRESHED_EVENT: 'auth-session-refreshed', getAuthDebugState: () => ({ authenticated: false }) }));
import { ActivityInboxController } from './activityInbox';
import type { AuthDebugState } from '../../auth/client';
import type { ActivityResponse } from '../../activity/model';
class Element extends EventTarget {
  classes = new Set(['hidden']); children: Element[] = []; textContent = ''; checked = false; disabled = false;
  isConnected = true; attributes = new Map<string, string>(); href = ''; className = '';
  classList = { add: (name: string) => this.classes.add(name), remove: (name: string) => this.classes.delete(name), contains: (name: string) => this.classes.has(name),
    toggle: (name: string, enabled?: boolean) => { const next = enabled ?? !this.classes.has(name); if (next) this.classes.add(name); else this.classes.delete(name); return next; } };
  setAttribute(name: string, value: string) { this.attributes.set(name, value); }
  replaceChildren(...children: Element[]) { this.children = children; }
  append(...children: Element[]) { this.children.push(...children); }
  focus() {}
  querySelectorAll() { return []; }
}
function auth(id: string | null = 'builder') { return { authenticated: Boolean(id), source: 'session', user: id ? { id } : null } as AuthDebugState; }
function response(id = 1, before: number | null = null): ActivityResponse {
  return { latestId: id, unreadCount: 1, nextBefore: before, preferences: { weeklyDigest: false, dethroneAlerts: false, emailAvailable: true },
    entries: [{ id, kind: 'completion', actorName: 'tkinter', contentTitle: `Room ${id}`, contentVersion: 1, contentPath: '/r/0/0',
      qualityStars: null, createdAt: '2026-10-04T17:00:00Z', unread: true }] };
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
async function settle() { for (let i = 0; i < 8; i++) await Promise.resolve(); }
const controllers: ActivityInboxController[] = [];
function fixture(search = '', initialUser: string | null = 'builder') {
  vi.useFakeTimers(); vi.stubGlobal('HTMLElement', Element);
  const elements = new Map<string, Element>();
  const doc = Object.assign(new EventTarget(), { visibilityState: 'visible', activeElement: null,
    getElementById: (id: string) => { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); }, createElement: () => new Element() });
  const win = Object.assign(new EventTarget(), { setInterval, clearInterval, location: { search } });
  const repository = { load: vi.fn().mockResolvedValue(response()), markSeen: vi.fn().mockResolvedValue(undefined),
    savePreferences: vi.fn().mockResolvedValue(response().preferences) };
  const controller = new ActivityInboxController(doc as unknown as Document, win as unknown as Window, repository, () => auth(initialUser));
  controllers.push(controller); controller.init();
  const click = (id: string) => elements.get(id)?.dispatchEvent(new Event('click'));
  const session = (id: string | null) => win.dispatchEvent(new CustomEvent('auth-state-changed', { detail: auth(id) }));
  return { controller, elements, repository, click, session, win };
}
afterEach(() => { for (const controller of controllers.splice(0)) controller.destroy(); vi.useRealTimers(); vi.unstubAllGlobals(); });
describe('activity inbox lifecycle', () => {
  it('opens an email link once after sign-in and keeps it closed on later session refreshes', async () => {
    const f = fixture('?activity=1', null); await settle();
    expect(f.repository.load).not.toHaveBeenCalled();
    f.session('builder'); await settle();
    expect(f.elements.get('activity-modal')?.classList.contains('hidden')).toBe(false);
    expect(f.repository.markSeen).toHaveBeenCalledExactlyOnceWith(1);
    f.click('btn-activity-close'); f.session('builder'); await settle();
    expect(f.elements.get('activity-modal')?.classList.contains('hidden')).toBe(true);
  });
  it('keeps background activity unread, opens a concrete list and acknowledges only its snapshot', async () => {
    const f = fixture(); await settle(); expect(f.repository.markSeen).not.toHaveBeenCalled();
    expect(f.elements.get('activity-unread-count')?.textContent).toBe('1');
    f.click('btn-activity-open'); await settle();
    expect(f.elements.get('activity-list')?.children[0].children[0].textContent).toBe('tkinter cleared Room 1');
    expect(f.repository.markSeen).toHaveBeenCalledExactlyOnceWith(1);
    expect(f.elements.get('activity-unread-count')?.classList.contains('hidden')).toBe(true);
  });
  it('discards old-account replies after sign-out and clears private rendered content', async () => {
    const f = fixture(); await settle(); const old = deferred<ActivityResponse>(); f.repository.load.mockReturnValueOnce(old.promise);
    f.click('btn-activity-open'); f.session(null); old.resolve(response(9)); await settle();
    expect(f.elements.get('activity-modal')?.classList.contains('hidden')).toBe(true);
    expect(f.elements.get('activity-list')?.children.length).toBe(0);
    expect(f.repository.markSeen).not.toHaveBeenCalled(); expect(f.elements.get('btn-activity-open')?.classList.contains('hidden')).toBe(true);
  });
  it('does not overwrite a reopened inbox with a late old reply', async () => {
    const f = fixture(); await settle(); const old = deferred<ActivityResponse>(); f.repository.load.mockReturnValueOnce(old.promise);
    f.click('btn-activity-open'); f.click('btn-activity-close'); f.repository.load.mockResolvedValueOnce(response(12));
    f.click('btn-activity-open'); await settle(); old.resolve(response(3)); await settle();
    expect(f.elements.get('activity-list')?.children[0].children[0].textContent).toBe('tkinter cleared Room 12');
    expect(f.repository.markSeen).toHaveBeenCalledExactlyOnceWith(12);
  });
  it('appends older pages without acknowledging new events, and makes load/save failures retryable', async () => {
    const f = fixture(); await settle(); f.repository.load.mockResolvedValueOnce(response(5, 5)); f.click('btn-activity-open'); await settle();
    f.repository.load.mockResolvedValueOnce(response(2)); f.click('btn-activity-more'); await settle();
    expect(f.elements.get('activity-list')?.children.length).toBe(2); expect(f.repository.markSeen).toHaveBeenCalledTimes(1);
    f.repository.savePreferences.mockRejectedValueOnce(new Error('Offline')); f.click('btn-activity-save'); await settle();
    expect(f.elements.get('activity-preferences-status')?.textContent).toBe('Preferences were not saved. Try again.');
    f.repository.load.mockRejectedValueOnce(new Error('Offline')); f.click('btn-activity-retry'); await settle();
    expect(f.elements.get('btn-activity-retry')?.classList.contains('hidden')).toBe(false);
  });
  it('ignores late preference replies after an account switch and removes polling/listeners on destroy', async () => {
    const f = fixture(); await settle(); f.click('btn-activity-open'); await settle();
    const old = deferred<ActivityResponse['preferences']>(); f.repository.savePreferences.mockReturnValueOnce(old.promise); f.click('btn-activity-save');
    f.session('p2'); await settle(); old.resolve({ ...response().preferences, weeklyDigest: true }); await settle();
    expect(f.elements.get('activity-modal')?.classList.contains('hidden')).toBe(true);
    const calls = f.repository.load.mock.calls.length; f.controller.destroy(); vi.advanceTimersByTime(120000); f.win.dispatchEvent(new Event('online')); await settle();
    expect(f.repository.load.mock.calls.length).toBe(calls);
  });
});
