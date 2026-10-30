import { afterEach, describe, expect, it } from 'vitest';
import { createDefaultEditorState, updateEditorState } from '../../config/editorState';
import { subscribeEditorUi, refreshEditorUi, requestEditorShellEscape, EDITOR_SHELL_ESCAPE_REQUESTED_EVENT } from './uiEvents';
const tick = () => new Promise<void>(resolve => queueMicrotask(resolve));
afterEach(async () => { updateEditorState(createDefaultEditorState()); await tick(); });

describe('typed editor UI signals', () => {
  it('updates actual UI subscribers after a state command without a manual window event', async () => {
    const target = new EventTarget() as Window, notices: unknown[] = [];
    const stop = subscribeEditorUi(target, detail => notices.push(detail));
    try { updateEditorState({ selectedObjectId: 'coin_gold' }); await tick(); expect(notices).toEqual([{}]); }
    finally { stop(); }
  });
  it('filters irrelevant state changes but retains explicit UI-only payloads', async () => {
    const target = new EventTarget() as Window, notices: unknown[] = [];
    const stop = subscribeEditorUi(target, detail => notices.push(detail), ['selectedObjectId']);
    try {
      updateEditorState({ zoom: 4 }); await tick(); expect(notices).toEqual([]);
      refreshEditorUi(target, { objectCategory: 'all' }); expect(notices).toEqual([{ objectCategory: 'all' }]);
      updateEditorState({ selectedObjectId: 'rock' }); await tick(); expect(notices).toHaveLength(2);
    } finally { stop(); }
  });
  it('removes state and window subscriptions on owner cleanup', async () => {
    const target = new EventTarget() as Window, notices: unknown[] = [];
    const stop = subscribeEditorUi(target, detail => notices.push(detail));
    updateEditorState({ activeTool: 'eraser' }); stop(); stop(); refreshEditorUi(target);
    await tick(); expect(notices).toEqual([]);
  });
  it('preserves synchronous Escape handling and the shared handled flag', () => {
    const target = new EventTarget() as Window, detail = { handled: false };
    target.addEventListener(EDITOR_SHELL_ESCAPE_REQUESTED_EVENT, event => { event.detail.handled = true; });
    requestEditorShellEscape(target, detail); expect(detail.handled).toBe(true);
    refreshEditorUi(null); // Closed/missing document windows are harmless.
  });
});
