export function getTilesetPaletteAvailableWidth(containerWidth: number): number {
  return Math.max(0, containerWidth - 4);
}

export function getTilesetPaletteScale(
  availableWidth: number,
  imageWidth: number,
  maxScale = Number.POSITIVE_INFINITY,
): number | null {
  if (!(availableWidth > 0) || !(imageWidth > 0)) {
    return null;
  }
  return Math.min(maxScale, Math.max(1, availableWidth / imageWidth));
}
