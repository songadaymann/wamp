import type { RoomSnapshot } from '../persistence/roomModel';
import { buildRoomTokenMetadata, type BuiltRoomTokenMetadata, type RoomTokenMetadataBuildOptions } from './roomMetadata';
import { renderRoomSnapshotToPngDataUrl } from './roomMetadataRender';

// Fresh URI storage must fit Base's transaction gas cap, not just the API body limit.
// Leave headroom for storage writes, calldata and the surrounding contract execution.
const MAX_ARTWORK_TOKEN_URI_LENGTH = 20_000;
// Power-of-two sampling scales evenly to 640×352 without fractional pixel edges.
const TILE_PIXEL_SIZES = [16, 8, 4, 2] as const;

export function buildPixelSharpRoomImage(pngDataUrl: string): string {
  if (!/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(pngDataUrl)) {
    throw new Error('Room artwork must be an embedded PNG.');
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="352" viewBox="0 0 640 352"><image width="640" height="352" href="${pngDataUrl}" style="image-rendering:pixelated"/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/** Keep the complete room payload and strict assets; only vary the artwork sampling. */
export async function buildRoomTokenArtwork(
  snapshot: RoomSnapshot,
  options: RoomTokenMetadataBuildOptions,
): Promise<BuiltRoomTokenMetadata> {
  for (const tilePixelSize of TILE_PIXEL_SIZES) {
    const png = await renderRoomSnapshotToPngDataUrl(snapshot, { tilePixelSize, strictAssets: true });
    const built = await buildRoomTokenMetadata(snapshot, buildPixelSharpRoomImage(png), options);
    if (built.tokenUri.length <= MAX_ARTWORK_TOKEN_URI_LENGTH) return built;
  }
  throw new Error('This room is too large to store its artwork safely in one transaction. No artwork transaction was requested.');
}
