export function resolvePencilStampOrigin(
  start: { x: number; y: number },
  current: { x: number; y: number },
  width: number,
  height: number,
  continuous: boolean,
): { x: number; y: number } {
  if (continuous || (width <= 1 && height <= 1)) {
    return { x: current.x, y: current.y };
  }

  return {
    x: start.x + Math.floor((current.x - start.x) / width) * width,
    y: start.y + Math.floor((current.y - start.y) / height) * height,
  };
}
