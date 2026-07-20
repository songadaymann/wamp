export function dispatchTypedEvent<TDetail>(
  target: EventTarget,
  type: string,
  detail: TDetail,
): boolean {
  return target.dispatchEvent(new CustomEvent<TDetail>(type, { detail }));
}

export function dispatchSignal(target: EventTarget, type: string): boolean {
  return target.dispatchEvent(new Event(type));
}

export function listenForTypedEvent<TDetail>(
  target: EventTarget,
  type: string,
  listener: (event: CustomEvent<TDetail>) => void,
): () => void {
  const eventListener = listener as EventListener;
  target.addEventListener(type, eventListener);
  return () => target.removeEventListener(type, eventListener);
}
