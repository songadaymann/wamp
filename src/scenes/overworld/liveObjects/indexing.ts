export function buildLiveObjectKeyIndex<TLiveObject extends { key: string }>(
  liveObjects: Iterable<TLiveObject>,
): Map<string, TLiveObject> {
  const liveObjectByKey = new Map<string, TLiveObject>();
  for (const liveObject of liveObjects) {
    liveObjectByKey.set(liveObject.key, liveObject);
  }
  return liveObjectByKey;
}
