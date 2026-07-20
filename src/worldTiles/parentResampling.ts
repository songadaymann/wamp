/**
 * Reduces an RGBA image by exactly 2x using a premultiplied-alpha box filter.
 *
 * Pyramid parents need a representative color for every covered source area.
 * Nearest-neighbor sampling can promote a one-pixel highlight into the entire
 * low-LOD game tile, which changes the perceived palette at overview zooms.
 */
export function downsampleWorldTileParentRgba(
  source: Uint8ClampedArray,
  sourceWidth: number,
  sourceHeight: number,
): Uint8ClampedArray<ArrayBuffer> {
  if (
    !Number.isSafeInteger(sourceWidth)
    || !Number.isSafeInteger(sourceHeight)
    || sourceWidth <= 0
    || sourceHeight <= 0
    || sourceWidth % 2 !== 0
    || sourceHeight % 2 !== 0
    || source.length !== sourceWidth * sourceHeight * 4
  ) {
    throw new Error('World tile parent source must be a positive even-sized RGBA image.');
  }

  const outputWidth = sourceWidth / 2;
  const outputHeight = sourceHeight / 2;
  const output = new Uint8ClampedArray(outputWidth * outputHeight * 4);
  for (let outputY = 0; outputY < outputHeight; outputY += 1) {
    const sourceY = outputY * 2;
    for (let outputX = 0; outputX < outputWidth; outputX += 1) {
      const sourceX = outputX * 2;
      let alphaSum = 0;
      let premultipliedRed = 0;
      let premultipliedGreen = 0;
      let premultipliedBlue = 0;
      for (let offsetY = 0; offsetY < 2; offsetY += 1) {
        for (let offsetX = 0; offsetX < 2; offsetX += 1) {
          const sourceIndex = (
            (sourceY + offsetY) * sourceWidth
            + sourceX
            + offsetX
          ) * 4;
          const alpha = source[sourceIndex + 3] ?? 0;
          alphaSum += alpha;
          premultipliedRed += (source[sourceIndex] ?? 0) * alpha;
          premultipliedGreen += (source[sourceIndex + 1] ?? 0) * alpha;
          premultipliedBlue += (source[sourceIndex + 2] ?? 0) * alpha;
        }
      }

      const outputIndex = (outputY * outputWidth + outputX) * 4;
      if (alphaSum > 0) {
        output[outputIndex] = Math.round(premultipliedRed / alphaSum);
        output[outputIndex + 1] = Math.round(premultipliedGreen / alphaSum);
        output[outputIndex + 2] = Math.round(premultipliedBlue / alphaSum);
      }
      output[outputIndex + 3] = Math.round(alphaSum / 4);
    }
  }
  return output;
}
