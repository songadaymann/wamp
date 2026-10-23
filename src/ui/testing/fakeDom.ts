import { vi } from 'vitest';

/**
 * A small DOM for dialog tests, since vitest runs in Node: elements with classes, attributes and
 * dataset, selectors without combinators, focus, events that capture and bubble, mutation
 * observers delivered as microtasks, z-index, and animation frames run on demand.
 */

type Callback = (event: FakeEvent) => void;
type Listener = { callback: Callback; capture: boolean };
type Matcher = (element: FakeElement) => boolean;

export class FakeEvent {
  defaultPrevented = false;
  propagationStopped = false;
  immediateStopped = false;
  target: FakeNode | null = null;
  relatedTarget: FakeNode | null = null;
  readonly key: string;
  readonly shiftKey: boolean;
  readonly bubbles: boolean;
  readonly repeat = false;
  readonly ctrlKey = false;
  readonly metaKey = false;
  readonly altKey = false;

  constructor(readonly type: string, init: { key?: string; shiftKey?: boolean; bubbles?: boolean } = {}) {
    this.key = init.key ?? '';
    this.shiftKey = init.shiftKey ?? false;
    this.bubbles = init.bubbles ?? true;
  }

  preventDefault(): void { this.defaultPrevented = true; }
  stopPropagation(): void { this.propagationStopped = true; }
  stopImmediatePropagation(): void { this.propagationStopped = true; this.immediateStopped = true; }
}

class FakeEventTarget {
  private readonly listeners = new Map<string, Listener[]>();

  addEventListener(type: string, callback: Callback, options?: boolean | { capture?: boolean }): void {
    const capture = typeof options === 'boolean' ? options : Boolean(options?.capture);
    const list = this.listeners.get(type) ?? [];
    if (!list.some((listener) => listener.callback === callback && listener.capture === capture)) list.push({ callback, capture });
    this.listeners.set(type, list);
  }

  removeEventListener(type: string, callback: Callback, options?: boolean | { capture?: boolean }): void {
    const capture = typeof options === 'boolean' ? options : Boolean(options?.capture);
    const list = this.listeners.get(type) ?? [];
    const index = list.findIndex((listener) => listener.callback === callback && listener.capture === capture);
    if (index >= 0) list.splice(index, 1);
  }

  invoke(event: FakeEvent, phase: 'capture' | 'bubble' | 'target'): void {
    const list = this.listeners.get(event.type) ?? [];
    for (const listener of [...list]) {
      if (event.immediateStopped) return;
      if (!list.includes(listener)) continue;
      if (phase === 'capture' && !listener.capture) continue;
      if (phase === 'bubble' && listener.capture) continue;
      listener.callback.call(this, event);
    }
  }
}

export class FakeNode extends FakeEventTarget {
  parentNode: FakeNode | null = null;
  readonly children: FakeElement[] = [];
  readonly registrations = new Map<FakeMutationObserver, MutationObserverInit>();

  get ownerDocument(): FakeDocument | null {
    let node: FakeNode | null = this;
    while (node && !(node instanceof FakeDocument)) node = node.parentNode;
    return node;
  }

  get isConnected(): boolean { return this.ownerDocument !== null; }

  append(...nodes: FakeNode[]): void {
    const added = nodes.flatMap((node) => node instanceof FakeFragment ? node.children.splice(0) : [node]);
    for (const node of added) {
      node.parentNode?.detach(node);
      node.parentNode = this;
      this.children.push(node as FakeElement);
    }
    notifyChildList(this, added, []);
  }

  replaceChildren(...nodes: FakeNode[]): void {
    for (const child of [...this.children]) child.remove();
    this.append(...nodes);
  }

  remove(): void { this.parentNode?.detach(this, true); }

  replaceWith(...nodes: FakeNode[]): void {
    const parent = this.parentNode;
    if (!parent) return;
    const added = nodes.flatMap((node) => node instanceof FakeFragment ? node.children.splice(0) : [node]);
    const index = parent.children.indexOf(this as unknown as FakeElement);
    this.parentNode = null;
    parent.children.splice(index, 1, ...(added as FakeElement[]));
    for (const node of added) node.parentNode = parent;
    notifyChildList(parent, added, [this]);
  }

  detach(child: FakeNode, notify = false): void {
    const doc = this.ownerDocument;
    const index = this.children.indexOf(child as FakeElement);
    if (index < 0) return;
    this.children.splice(index, 1);
    child.parentNode = null;
    // Focus inside a removed subtree falls back to the page.
    if (doc && child.contains(doc.activeElement)) doc.activeElement = doc.body;
    if (notify) notifyChildList(this, [], [child]);
  }

  contains(node: unknown): boolean {
    for (let current = node as FakeNode | null; current; current = current.parentNode) if (current === this) return true;
    return false;
  }

  querySelectorAll(selector: string): FakeElement[] {
    const matches = compileSelector(selector);
    const found: FakeElement[] = [];
    const visit = (node: FakeNode): void => {
      for (const child of node.children) {
        if (matches(child)) found.push(child);
        visit(child);
      }
    };
    visit(this);
    return found;
  }

  querySelector(selector: string): FakeElement | null { return this.querySelectorAll(selector)[0] ?? null; }

  dispatchEvent(event: FakeEvent): boolean {
    event.target = this;
    const path: FakeNode[] = [];
    for (let node: FakeNode | null = this; node; node = node.parentNode) path.push(node);
    for (const node of [...path].reverse().slice(0, -1)) {
      node.invoke(event, 'capture');
      if (event.propagationStopped) return !event.defaultPrevented;
    }
    this.invoke(event, 'target');
    if (event.bubbles) {
      for (const node of path.slice(1)) {
        if (event.propagationStopped) break;
        node.invoke(event, 'bubble');
      }
    }
    return !event.defaultPrevented;
  }
}

export class FakeFragment extends FakeNode {}

export class FakeElement extends FakeNode {
  readonly localName: string;
  readonly attributes = new Map<string, string>();
  textContent = '';
  zIndex: number | undefined;
  readonly isContentEditable = false;
  readonly classList = {
    contains: (name: string): boolean => this.classNames().includes(name),
    add: (...names: string[]): void => this.setClasses([...new Set([...this.classNames(), ...names])]),
    remove: (...names: string[]): void => this.setClasses(this.classNames().filter((name) => !names.includes(name))),
    toggle: (name: string, force?: boolean): boolean => {
      const on = force ?? !this.classList.contains(name);
      if (on) this.classList.add(name); else this.classList.remove(name);
      return on;
    },
  };

  readonly dataset: Record<string, string | undefined> = new Proxy({}, {
    get: (_target, key) => typeof key === 'string' ? this.getAttribute(dataAttribute(key)) ?? undefined : undefined,
    set: (_target, key, value) => { this.setAttribute(dataAttribute(String(key)), String(value)); return true; },
    deleteProperty: (_target, key) => { this.removeAttribute(dataAttribute(String(key))); return true; },
    has: (_target, key) => typeof key === 'string' && this.hasAttribute(dataAttribute(key)),
  });

  constructor(tagName: string) {
    super();
    this.localName = tagName.toLowerCase();
  }

  get tagName(): string { return this.localName.toUpperCase(); }
  get id(): string { return this.getAttribute('id') ?? ''; }
  set id(value: string) { this.setAttribute('id', value); }
  get className(): string { return this.getAttribute('class') ?? ''; }
  set className(value: string) { this.setAttribute('class', value); }
  get type(): string { return this.getAttribute('type') ?? ''; }
  set type(value: string) { this.setAttribute('type', value); }
  get tabIndex(): number {
    const own = this.getAttribute('tabindex');
    if (own !== null) return Number(own);
    return ['button', 'input', 'select', 'textarea'].includes(this.localName) || (this.localName === 'a' && this.hasAttribute('href')) ? 0 : -1;
  }
  set tabIndex(value: number) { this.setAttribute('tabindex', String(value)); }

  set innerHTML(markup: string) {
    this.replaceChildren(...parseMarkup(markup));
  }

  getAttribute(name: string): string | null { return this.attributes.get(name) ?? null; }
  hasAttribute(name: string): boolean { return this.attributes.has(name); }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, String(value));
    notifyAttribute(this, name);
  }

  removeAttribute(name: string): void {
    if (!this.attributes.delete(name)) return;
    notifyAttribute(this, name);
  }

  matches(selector: string): boolean { return compileSelector(selector)(this); }

  closest(selector: string): FakeElement | null {
    const matches = compileSelector(selector);
    for (let node: FakeNode | null = this; node instanceof FakeElement; node = node.parentNode) if (matches(node)) return node;
    return null;
  }

  /** Laid out when on the page and not inside `.hidden` (WAMP hides with that class). */
  getClientRects(): object[] { return this.isConnected && this.closest('.hidden') === null ? [{}] : []; }

  focus(): void { this.ownerDocument?.focusOn(this); }

  blur(): void {
    const doc = this.ownerDocument;
    if (doc?.activeElement === this) doc.activeElement = doc.body;
  }

  click(): void { this.dispatchEvent(new FakeEvent('click')); }

  private classNames(): string[] { return this.className.split(/\s+/).filter(Boolean); }
  private setClasses(names: string[]): void { this.setAttribute('class', names.join(' ')); }
}

export class FakeInput extends FakeElement {}
export class FakeTemplate extends FakeElement {
  readonly content = new FakeFragment();
}

function createElement(tagName: string): FakeElement {
  const tag = tagName.toLowerCase();
  if (tag === 'template') return new FakeTemplate(tag);
  if (tag === 'input') return new FakeInput(tag);
  return new FakeElement(tag);
}

export class FakeWindow extends FakeEventTarget {
  private frames: (() => void)[] = [];
  readonly location = { search: '', pathname: '/' };

  requestAnimationFrame(callback: () => void): number { this.frames.push(callback); return this.frames.length; }
  cancelAnimationFrame(): void {}
  setTimeout(callback: () => void, ms?: number): number { return setTimeout(callback, ms) as unknown as number; }
  clearTimeout(id: number): void { clearTimeout(id); }
  getComputedStyle(element: FakeElement): { zIndex: string } { return { zIndex: element.zIndex === undefined ? 'auto' : String(element.zIndex) }; }

  runFrames(): void {
    const frames = this.frames;
    this.frames = [];
    for (const frame of frames) frame();
  }
}

export class FakeDocument extends FakeNode {
  readonly body = new FakeElement('body');
  readonly defaultView = new FakeWindow();
  readonly visibilityState = 'visible';
  activeElement: FakeElement | null;

  constructor() {
    super();
    this.body.parentNode = this;
    this.children.push(this.body);
    this.activeElement = this.body;
  }

  getElementById(id: string): FakeElement | null { return this.querySelector(`#${id}`); }

  createElement(tagName: string): FakeElement { return createElement(tagName); }

  createDocumentFragment(): FakeFragment { return new FakeFragment(); }

  focusOn(element: FakeElement): void {
    if (this.activeElement === element || !element.isConnected) return;
    const previous = this.activeElement;
    this.activeElement = element;
    const event = new FakeEvent('focusin');
    // As in browsers, focusin names the element focus left, or null when it came from the page.
    event.relatedTarget = previous === this.body ? null : previous;
    element.dispatchEvent(event);
  }
}

class FakeMutationObserver {
  private records: object[] = [];
  private scheduled = false;
  private readonly nodes = new Set<FakeNode>();

  constructor(private readonly callback: (records: object[], observer: FakeMutationObserver) => void) {}

  observe(node: FakeNode, options: MutationObserverInit): void {
    node.registrations.set(this, options);
    this.nodes.add(node);
  }

  disconnect(): void {
    for (const node of this.nodes) node.registrations.delete(this);
    this.nodes.clear();
    this.records = [];
  }

  queue(record: object): void {
    this.records.push(record);
    if (this.scheduled) return;
    this.scheduled = true;
    queueMicrotask(() => {
      this.scheduled = false;
      const records = this.records;
      this.records = [];
      if (records.length) this.callback(records, this);
    });
  }
}

function notifyAttribute(element: FakeElement, name: string): void {
  const notified = new Set<FakeMutationObserver>();
  for (let node: FakeNode | null = element; node; node = node.parentNode) {
    for (const [observer, options] of node.registrations) {
      if (notified.has(observer) || !options.attributes || (node !== element && !options.subtree)) continue;
      if (options.attributeFilter && !options.attributeFilter.includes(name)) continue;
      notified.add(observer);
      observer.queue({ type: 'attributes', target: element, attributeName: name, addedNodes: [], removedNodes: [] });
    }
  }
}

function notifyChildList(parent: FakeNode, addedNodes: FakeNode[], removedNodes: FakeNode[]): void {
  const notified = new Set<FakeMutationObserver>();
  for (let node: FakeNode | null = parent; node; node = node.parentNode) {
    for (const [observer, options] of node.registrations) {
      if (notified.has(observer) || !options.childList || (node !== parent && !options.subtree)) continue;
      notified.add(observer);
      observer.queue({ type: 'childList', target: parent, addedNodes, removedNodes });
    }
  }
}

function dataAttribute(key: string): string {
  return `data-${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`;
}

function splitList(source: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    if (char === '(' || char === '[') depth++;
    else if (char === ')' || char === ']') depth--;
    else if (char === ',' && depth === 0) { parts.push(source.slice(start, index)); start = index + 1; }
  }
  parts.push(source.slice(start));
  return parts.map((part) => part.trim()).filter(Boolean);
}

function compileSelector(selector: string): Matcher {
  const compounds = splitList(selector).map(compileCompound);
  return (element) => compounds.some((matches) => matches(element));
}

function compileCompound(source: string): Matcher {
  const tests: Matcher[] = [];
  let rest = source;
  while (rest) {
    let match: RegExpExecArray | null;
    if ((match = /^\*/.exec(rest))) {
      // Any element.
    } else if ((match = /^[a-zA-Z][\w-]*/.exec(rest))) {
      const tag = match[0].toLowerCase();
      tests.push((element) => element.localName === tag);
    } else if ((match = /^#([\w-]+)/.exec(rest))) {
      const id = match[1];
      tests.push((element) => element.id === id);
    } else if ((match = /^\.([\w-]+)/.exec(rest))) {
      const name = match[1];
      tests.push((element) => element.classList.contains(name));
    } else if ((match = /^\[([\w-]+)(?:([*^]?=)(["'])(.*?)\3)?(\s+i)?\]/.exec(rest))) {
      const [, name, operator, , expected = '', insensitive] = match;
      tests.push((element) => {
        const actual = element.getAttribute(name);
        if (actual === null) return false;
        if (!operator) return true;
        const value = insensitive ? actual.toLowerCase() : actual;
        const wanted = insensitive ? expected.toLowerCase() : expected;
        return operator === '=' ? value === wanted : operator === '*=' ? value.includes(wanted) : value.startsWith(wanted);
      });
    } else if (rest.startsWith(':not(')) {
      let depth = 0;
      let end = 4;
      for (; end < rest.length; end++) {
        if (rest[end] === '(') depth++;
        else if (rest[end] === ')' && --depth === 0) break;
      }
      const inner = compileSelector(rest.slice(5, end));
      tests.push((element) => !inner(element));
      match = [rest.slice(0, end + 1)] as unknown as RegExpExecArray;
    } else {
      throw new Error(`fakeDom does not support the selector "${source}"`);
    }
    rest = rest.slice(match[0].length);
  }
  return (element) => tests.every((matches) => matches(element));
}

const VOID_TAGS = new Set(['input', 'br', 'img', 'hr']);

/** Enough of HTML for markup written in code: tags, quoted or bare attributes, and text. */
function parseMarkup(markup: string): FakeElement[] {
  const roots: FakeElement[] = [];
  const stack: FakeElement[] = [];
  for (const token of markup.matchAll(/<(\/?)([a-zA-Z][\w-]*)([^>]*)>|([^<]+)/g)) {
    const [, closing, tag, attributeText, text] = token;
    const parent = stack[stack.length - 1];
    if (text !== undefined) {
      if (parent && text.trim()) parent.textContent += text.trim();
      continue;
    }
    if (closing) { stack.pop(); continue; }
    const element = createElement(tag);
    for (const [, name, value = ''] of attributeText.matchAll(/([^\s=/]+)(?:="([^"]*)")?/g)) element.attributes.set(name, value);
    if (parent) { element.parentNode = parent; parent.children.push(element); } else roots.push(element);
    if (!VOID_TAGS.has(element.localName)) stack.push(element);
  }
  return roots;
}

export type FakeDom = {
  doc: FakeDocument;
  win: FakeWindow;
  /** Lets mutation observers, then animation frames (dialog focus), run. */
  settle(): Promise<void>;
  /** Presses a key on the focused element, as a browser would. */
  press(key: string, init?: { shiftKey?: boolean }): FakeEvent;
  element(tag: string, attributes?: Record<string, string>, ...children: FakeElement[]): FakeElement;
};

/** Points `document`, `window` and the DOM classes the code under test uses at a new fake page. */
export function installFakeDom(): FakeDom {
  const doc = new FakeDocument();
  const win = doc.defaultView;
  const globals: Record<string, unknown> = {
    document: doc,
    window: win,
    Node: FakeNode,
    Element: FakeElement,
    HTMLElement: FakeElement,
    HTMLInputElement: FakeInput,
    HTMLTemplateElement: FakeTemplate,
    HTMLTextAreaElement: class extends FakeElement {},
    HTMLSelectElement: class extends FakeElement {},
    MutationObserver: FakeMutationObserver,
    requestAnimationFrame: (callback: () => void) => win.requestAnimationFrame(callback),
    cancelAnimationFrame: () => undefined,
  };
  for (const [name, value] of Object.entries(globals)) vi.stubGlobal(name, value);
  const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
  return {
    doc,
    win,
    async settle() {
      for (let pass = 0; pass < 3; pass++) {
        await flush();
        win.runFrames();
      }
      await flush();
    },
    press(key, init = {}) {
      const event = new FakeEvent('keydown', { key, shiftKey: init.shiftKey });
      (doc.activeElement ?? doc.body).dispatchEvent(event);
      if (key === 'Tab' && !event.defaultPrevented) tabByDefault(doc, Boolean(init.shiftKey));
      return event;
    },
    element(tag, attributes = {}, ...children) {
      const element = doc.createElement(tag);
      for (const [name, value] of Object.entries(attributes)) element.attributes.set(name, value);
      element.children.push(...children);
      for (const child of children) child.parentNode = element;
      return element;
    },
  };
}

/** The browser's own Tab move when no handler took the key: the next tabbable control in the page. */
function tabByDefault(doc: FakeDocument, backward: boolean): void {
  const tabbable = doc.querySelectorAll('button, a[href], input, [tabindex]')
    .filter((element) => element.tabIndex >= 0 && element.getClientRects().length > 0);
  const index = tabbable.indexOf(doc.activeElement as FakeElement);
  const next = backward ? tabbable[(index <= 0 ? tabbable.length : index) - 1] : tabbable[(index + 1) % tabbable.length];
  next?.focus();
}
