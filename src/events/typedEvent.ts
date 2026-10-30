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
