const pending = new Set<object>();
const listeners = new Set<() => void>();
const notify = (): void => { for (const listener of listeners) listener(); };

export function hasPendingDialog(): boolean { return pending.size > 0; }

export function beginPendingDialog(): () => void {
  const token = {};
  pending.add(token); notify();
  return () => { if (pending.delete(token)) notify(); };
}

export function subscribePendingDialogs(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
