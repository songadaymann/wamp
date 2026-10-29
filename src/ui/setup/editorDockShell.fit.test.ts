import { describe, expect, it, vi } from 'vitest';
import { EditorDockShellController } from './editorDockShell';

vi.mock('phaser', () => ({ default: {} }));

describe('phone More menu Fit room (F371)', () => {
  it('presses the live Fit control, which frames the room in either editor', () => {
    const fit = Object.assign(new EventTarget(), { dataset: { editorShellAction: 'fit' } as Record<string, string>, disabled: false });
    const liveFit = { disabled: false, click: vi.fn() };
    const doc = Object.assign(new EventTarget(), {
      body: { dataset: { appMode: 'editor', deviceClass: 'phone' } as Record<string, string> },
      getElementById: (id: string) => (id === 'btn-fit-screen' ? liveFit : null),
      querySelector: (selector: string) => (selector === '[data-editor-shell-action="fit"]' ? fit : null),
      querySelectorAll: (selector: string) => (selector === '[data-editor-shell-action]' ? [fit] : []),
    });
    const palette = new Proxy({}, { get: () => vi.fn() });
    new EditorDockShellController(palette as never, doc as never).init();
    fit.dispatchEvent(new Event('click'));
    expect(liveFit.click).toHaveBeenCalledOnce();
    liveFit.disabled = true;
    fit.dispatchEvent(new Event('click'));
    expect(liveFit.click).toHaveBeenCalledOnce();
  });
});
