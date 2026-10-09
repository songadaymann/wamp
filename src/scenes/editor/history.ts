export const EDITOR_HISTORY_LIMIT = 150;

export class EditorHistory<TAction> {
  private undoStack: TAction[] = [];
  private redoStack: TAction[] = [];

  constructor(private readonly onRecord?: (action: TAction) => void) {}

  reset(): void {
    this.undoStack = [];
    this.redoStack = [];
  }

  record(action: TAction): void {
    this.pushUndo(action);
    this.redoStack = [];
    this.onRecord?.(action);
  }

  takeUndo(): TAction | null {
    return this.undoStack.pop() ?? null;
  }

  takeRedo(): TAction | null {
    return this.redoStack.pop() ?? null;
  }

  pushUndo(action: TAction): void {
    this.undoStack.push(action);
    this.trim(this.undoStack);
  }

  pushRedo(action: TAction): void {
    this.redoStack.push(action);
    this.trim(this.redoStack);
  }

  private trim(stack: TAction[]): void {
    if (stack.length > EDITOR_HISTORY_LIMIT) stack.splice(0, stack.length - EDITOR_HISTORY_LIMIT);
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  getDebugSnapshot(): { undoCount: number; redoCount: number } {
    return {
      undoCount: this.undoStack.length,
      redoCount: this.redoStack.length,
    };
  }
}
