export interface ProgressivePreviewBatchOptions<TPrepared> {
  batchIds: readonly string[];
  selectCurrentRoomIds: (roomIds: ReadonlySet<string>) => ReadonlySet<string>;
  loadSnapshots: (roomIds: readonly string[]) => Promise<void>;
  prepareLoaded: (roomIds: ReadonlySet<string>) => Promise<TPrepared>;
  mergeLoaded: (prepared: TPrepared, roomIds: ReadonlySet<string>) => void;
}

function intersectRoomIds(
  orderedRoomIds: Iterable<string>,
  selectedRoomIds: ReadonlySet<string>,
): Set<string> {
  return new Set([...orderedRoomIds].filter((roomId) => selectedRoomIds.has(roomId)));
}

/**
 * Re-evaluates a progressive legacy-preview batch at every asynchronous
 * boundary so a tiled-world cutover cannot rehydrate or reattach canonical
 * published previews after coarse coverage becomes available.
 */
export async function processProgressivePreviewBatch<TPrepared>(
  options: ProgressivePreviewBatchOptions<TPrepared>,
): Promise<void> {
  const candidates = new Set(options.batchIds);
  const requestedRoomIds = intersectRoomIds(
    candidates,
    options.selectCurrentRoomIds(candidates),
  );
  if (requestedRoomIds.size === 0) return;

  await options.loadSnapshots([...requestedRoomIds]);

  const preparedRoomIds = intersectRoomIds(
    requestedRoomIds,
    options.selectCurrentRoomIds(requestedRoomIds),
  );
  if (preparedRoomIds.size === 0) return;
  const prepared = await options.prepareLoaded(preparedRoomIds);

  const mergedRoomIds = intersectRoomIds(
    preparedRoomIds,
    options.selectCurrentRoomIds(preparedRoomIds),
  );
  if (mergedRoomIds.size === 0) return;
  options.mergeLoaded(prepared, mergedRoomIds);
}
