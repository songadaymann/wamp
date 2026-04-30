import Phaser from 'phaser';

export type RendererQuery = 'auto' | 'canvas' | 'webgl';

export function parseBooleanQuery(value: string | null): boolean {
  if (!value) return false;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

export function normalizeRendererQuery(value: string | null): RendererQuery {
  if (!value) return 'auto';

  switch (value.toLowerCase()) {
    case 'canvas':
      return 'canvas';
    case 'webgl':
      return 'webgl';
    default:
      return 'auto';
  }
}

export function resolveRendererType(renderer: RendererQuery): number {
  switch (renderer) {
    case 'canvas':
      return Phaser.CANVAS;
    case 'webgl':
      return Phaser.WEBGL;
    default:
      return Phaser.AUTO;
  }
}
