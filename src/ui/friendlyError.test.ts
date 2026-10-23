import { describe, expect, it } from 'vitest';
import { friendlyError, renderFriendlyError, setLiveMessage } from './friendlyError';

describe('friendly errors', () => {
  it.each(['Failed to fetch', 'Load failed', 'Unexpected token < in JSON', 'HTTP 503', '{"error":"server"}'])
    ('replaces transport details (%s) with an action and next step', (message) => {
      expect(friendlyError('load your profile', { error: new Error(message) }))
        .toBe("Couldn't load your profile. Please try again.");
    });
  it('preserves useful server validation and permission explanations', () => {
    expect(friendlyError('create a playlist', { error: new Error('This playlist URL is already taken.') }))
      .toBe('This playlist URL is already taken. Please try again.');
    expect(friendlyError('save your profile', { error: new Error('Sign in to save your profile'), nextStep: 'Sign in, then save again.' }))
      .toBe('Sign in to save your profile. Sign in, then save again.');
  });
});

const frames: Array<() => void> = [];
const view = { requestAnimationFrame: (callback: () => void) => frames.push(callback) };
// setLiveMessage waits until a frame has been drawn after the current one: two animation frames.
const drawFrames = () => { for (let n = 0; n < 2; n++) for (const callback of frames.splice(0)) callback(); };
class Box {
  classes = new Set<string>(['hidden']); attributes = new Map<string, string>(); children: Box[] = [];
  tag: string; type = ''; className = ''; disabled = false; writes = 0; private text = '';
  ownerDocument = { createElement: (tag: string) => new Box(tag), defaultView: view };
  classList = { contains: (c: string) => this.classes.has(c), toggle: (c: string, on: boolean) => { if (on) this.classes.add(c); else this.classes.delete(c); return on; } };
  constructor(tag = 'div') { this.tag = tag; }
  get textContent() { return this.text + this.children.map(child => child.textContent).join(''); }
  set textContent(value: string) { this.text = value; this.children = []; this.writes++; }
  setAttribute(name: string, value: string) { this.attributes.set(name, value); }
  getAttribute(name: string) { return this.attributes.get(name) ?? null; }
  replaceChildren() { this.children = []; this.text = ''; }
  append(child: Box) { this.children.push(child); }
  addEventListener() {}
}
const box = () => new Box() as Box & HTMLElement;

describe('menu error and status lines reach screen readers (F471)', () => {
  it('shows an error at once as an alert, and changes a shown line in place', () => {
    const line = box();
    setLiveMessage(line, 'Room Rush could not start. Please retry.');
    expect(line.getAttribute('role')).toBe('alert');
    expect(line.classes.has('hidden')).toBe(false);
    expect(line.textContent).toBe('Room Rush could not start. Please retry.');
    setLiveMessage(line, 'Signed. Thanks for visiting WAMP.', 'status');
    expect(line.getAttribute('role')).toBe('status');
    expect(line.textContent).toBe('Signed. Thanks for visiting WAMP.');
    setLiveMessage(line, null);
    expect(line.textContent).toBe('');
    expect(line.classes.has('hidden')).toBe(true);
  });

  it('shows a polite status line empty first, and writes it once that has been drawn', () => {
    const line = box();
    setLiveMessage(line, 'Signing guestbook...', 'status');
    expect(line.getAttribute('role')).toBe('status');
    expect(line.classes.has('hidden')).toBe(false);
    expect(line.textContent).toBe('');
    drawFrames();
    expect(line.textContent).toBe('Signing guestbook...');
  });

  it('reads the same message again when the player causes it again', () => {
    const line = box();
    setLiveMessage(line, 'Add your name and message first.');
    setLiveMessage(line, 'Add your name and message first.');
    expect(line.textContent).toBe('');
    expect(line.classes.has('hidden')).toBe(false);
    drawFrames();
    expect(line.textContent).toBe('Add your name and message first.');
  });

  it('drops a waiting write when a newer message or a clear comes first', () => {
    const line = box();
    setLiveMessage(line, 'Starting Room Rush...', 'status');
    setLiveMessage(line, 'Room Rush is not available yet.');
    expect(line.textContent).toBe('Room Rush is not available yet.');
    drawFrames();
    expect(line.textContent).toBe('Room Rush is not available yet.');
    setLiveMessage(line, 'Room Rush is not available yet.');
    setLiveMessage(line, null);
    drawFrames();
    expect(line.textContent).toBe('');
    expect(line.classes.has('hidden')).toBe(true);
  });

  it('leaves unchanged words alone on a line redrawn every update', () => {
    const line = box();
    for (let n = 0; n < 3; n++) setLiveMessage(line, 'Name this phrase first.', 'error', { rerender: true });
    drawFrames();
    expect(line.writes).toBe(1);
    setLiveMessage(line, 'That name is taken.', 'error', { rerender: true });
    expect(line.writes).toBe(2);
    setLiveMessage(null, 'ignored');
  });

  it('alerts the error text in a retryable box, without the Try again label', () => {
    const banner = box();
    renderFriendlyError(banner, "Couldn't load room explorer. Please try again.", () => {});
    expect(banner.getAttribute('role')).toBeNull();
    const [message, retry] = banner.children;
    expect(message.getAttribute('role')).toBe('alert');
    expect(message.textContent).toBe("Couldn't load room explorer. Please try again.");
    expect(retry.tag).toBe('button');
    expect(retry.getAttribute('role')).toBeNull();
    expect(banner.classes.has('hidden')).toBe(false);
    renderFriendlyError(banner, null);
    expect(banner.children).toEqual([]);
    expect(banner.classes.has('hidden')).toBe(true);
  });

  it('reads a link to copy by hand as polite status, not an alert', () => {
    const banner = box();
    renderFriendlyError(banner, 'https://wamp.example/playlist/best', undefined, 'status');
    const [message] = banner.children;
    expect(message.getAttribute('role')).toBe('status');
    drawFrames();
    expect(banner.textContent).toBe('https://wamp.example/playlist/best');
  });
});
