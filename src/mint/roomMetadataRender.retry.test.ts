import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDefaultRoomSnapshot } from '../persistence/roomModel';
import { renderRoomSnapshotToPngDataUrl } from './roomMetadataRender';

afterEach(() => vi.unstubAllGlobals());

describe('artwork render retry after an asset outage', () => {
  it('retries the failed image and renders a strict PNG when the asset becomes available', async () => {
    let loads = 0;
    const drawImage = vi.fn();
    const context = { fillRect: vi.fn(), clearRect: vi.fn(), drawImage, save: vi.fn(), restore: vi.fn(), translate: vi.fn(), scale: vi.fn() };
    vi.stubGlobal('document', { createElement: () => ({ getContext: () => context, toDataURL: () => 'data:image/png;base64,rendered' }) });
    vi.stubGlobal('Image', class {
      width = 640; height = 352; onload?: () => void; onerror?: () => void;
      set src(_value: string) { const attempt = ++loads; queueMicrotask(() => attempt === 1 ? this.onerror?.() : this.onload?.()); }
    });
    const room = createDefaultRoomSnapshot('1,2', { x: 1, y: 2 }); room.background = 'none'; room.tileData.terrain[21][0] = 1;
    const options = { tilePixelSize: 2, includeBackground: false, strictAssets: true };
    await expect(renderRoomSnapshotToPngDataUrl(room, options)).rejects.toThrow('Failed to load asset');
    expect(drawImage).not.toHaveBeenCalled();
    await expect(renderRoomSnapshotToPngDataUrl(room, options)).resolves.toBe('data:image/png;base64,rendered');
    expect(loads).toBe(2); expect(drawImage).toHaveBeenCalledOnce();
  });
});
