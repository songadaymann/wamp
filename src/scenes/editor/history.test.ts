import { describe, expect, it } from 'vitest';
import { EditorHistory, EDITOR_HISTORY_LIMIT } from './history';

describe('EditorHistory', () => {
  it('drops only the oldest edits and retains the latest 150 in order', () => {
    const committed: number[] = [];
    const history = new EditorHistory<number>(a => committed.push(a));
    for (let i = 0; i < EDITOR_HISTORY_LIMIT + 25; i++) history.record(i);
    expect(history.getDebugSnapshot()).toEqual({ undoCount: 150, redoCount: 0 });
    expect(committed).toHaveLength(175);
    const undone: number[] = [];
    while (history.canUndo()) { const action = history.takeUndo()!; undone.push(action); history.pushRedo(action); }
    expect(undone).toEqual(Array.from({ length: 150 }, (_, i) => 174 - i));
    for (let i = 25; i < 175; i++) { expect(history.takeRedo()).toBe(i); history.pushUndo(i); }
    expect(history.getDebugSnapshot()).toEqual({ undoCount: 150, redoCount: 0 });
  });
  it('bounds both transfer stacks even when directly populated', () => {
    const history = new EditorHistory<number>();
    for (let i = 0; i < 200; i++) { history.pushUndo(i); history.pushRedo(i); }
    expect(history.getDebugSnapshot()).toEqual({ undoCount: 150, redoCount: 150 });
    history.record(200);
    expect(history.getDebugSnapshot()).toEqual({ undoCount: 150, redoCount: 0 });
  });
  it('notifies only committed edits, not undo-stack transfers or resets', () => {
    const recorded: string[] = [];
    const history = new EditorHistory<string>(action => recorded.push(action));
    history.record('tiles'); history.takeUndo(); history.pushRedo('tiles');
    history.takeRedo(); history.pushUndo('tiles'); history.reset();
    expect(recorded).toEqual(['tiles']);
  });
  it('records in order and clears redo only when a new edit is recorded', () => {
    const history = new EditorHistory<string>();
    history.record('tile');
    history.record('object');
    expect(history.getDebugSnapshot()).toEqual({ undoCount: 2, redoCount: 0 });

    expect(history.takeUndo()).toBe('object');
    history.pushRedo('object-reverse');
    expect(history.getDebugSnapshot()).toEqual({ undoCount: 1, redoCount: 1 });

    history.record('goal');
    expect(history.getDebugSnapshot()).toEqual({ undoCount: 2, redoCount: 0 });
    expect(history.takeRedo()).toBeNull();
  });

  it('supports the runtime undo-redo transfer without interpreting actions', () => {
    const history = new EditorHistory<{ kind: string; value: number }>();
    history.record({ kind: 'music', value: 1 });
    const undoAction = history.takeUndo();
    expect(undoAction).toEqual({ kind: 'music', value: 1 });
    history.pushRedo({ kind: 'music', value: 0 });

    const redoAction = history.takeRedo();
    expect(redoAction).toEqual({ kind: 'music', value: 0 });
    history.pushUndo({ kind: 'music', value: 1 });
    expect(history.getDebugSnapshot()).toEqual({ undoCount: 1, redoCount: 0 });
  });

  it('resets both directions and returns null at empty boundaries', () => {
    const history = new EditorHistory<number>();
    history.record(1);
    history.pushRedo(2);
    history.reset();
    expect(history.canUndo()).toBe(false);
    expect(history.canRedo()).toBe(false);
    expect(history.takeUndo()).toBeNull();
    expect(history.takeRedo()).toBeNull();
  });
});
