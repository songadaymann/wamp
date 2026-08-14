import { describe, expect, it } from 'vitest';
import { EditorHistory } from './history';

describe('EditorHistory', () => {
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
