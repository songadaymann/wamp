export type WorldTileAvailability =
  | { state: 'pending' }
  | { state: 'failed' }
  | { state: 'ready-empty' }
  | { state: 'ready-image'; decoded: boolean; gpuReady: boolean; stale?: boolean };

export function isWorldTileDisplayable(
  availability: WorldTileAvailability | undefined,
): availability is Extract<WorldTileAvailability, { state: 'ready-empty' | 'ready-image' }> {
  return availability?.state === 'ready-empty' || (
    availability?.state === 'ready-image' &&
    availability.decoded &&
    availability.gpuReady
  );
}
