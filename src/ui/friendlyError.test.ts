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

class Box {
  classes = new Set<string>(['hidden']); attributes = new Map<string, string>(); children: Box[] = [];
  tag: string; type = ''; className = ''; disabled = false; writes = 0; private text = '';
  ownerDocument = { createElement: (tag: string) => new Box(tag) };
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
  it('makes an error an alert and a progress or success line polite status', () => {
    const line = box();
    setLiveMessage(line, 'Room Rush could not start. Please retry.');
    expect(line.getAttribute('role')).toBe('alert');
    expect(line.classes.has('hidden')).toBe(false);
    setLiveMessage(line, 'Signed. Thanks for visiting WAMP.', 'status');
    expect(line.getAttribute('role')).toBe('status');
    expect(line.textContent).toBe('Signed. Thanks for visiting WAMP.');
    setLiveMessage(line, null);
    expect(line.textContent).toBe('');
    expect(line.classes.has('hidden')).toBe(true);
  });

  it('leaves an unchanged message alone, so a re-render does not read it twice', () => {
    const line = box();
    setLiveMessage(line, 'Name this phrase first.');
    setLiveMessage(line, 'Name this phrase first.');
    setLiveMessage(line, 'Name this phrase first.');
    expect(line.writes).toBe(1);
    setLiveMessage(line, 'That name is taken.');
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
});
