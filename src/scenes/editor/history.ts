export class EditorHistory<TAction> {
  private undoStack: TAction[] = [];
  private redoStack: TAction[] = [];

  reset(): void {
    this.undoStack = [];
    this.redoStack = [];
  }

  record(action: TAction): void {
    this.undoStack.push(action);
    this.redoStack = [];
  }

  takeUndo(): TAction | null {
    return this.undoStack.pop() ?? null;
  }

  takeRedo(): TAction | null {
    return this.redoStack.pop() ?? null;
  }

  pushUndo(action: TAction): void {
    this.undoStack.push(action);
  }

  pushRedo(action: TAction): void {
    this.redoStack.push(action);
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
