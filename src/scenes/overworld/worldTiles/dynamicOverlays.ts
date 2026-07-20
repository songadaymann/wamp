export interface WorldTileDynamicOverlayCandidate {
  draft: unknown | null;
  sharedPreview: unknown | null;
  summary: { state: 'published' | 'claimed_unpublished' | 'frontier' } | null;
}

export function shouldRenderLegacyWorldTileOverlay(
  candidate: WorldTileDynamicOverlayCandidate | null | undefined,
  optimisticPublished: boolean,
): boolean {
  return Boolean(
    candidate?.draft
    || (candidate?.sharedPreview && candidate.summary?.state !== 'published')
    || candidate?.summary?.state === 'claimed_unpublished'
    || optimisticPublished
  );
}

