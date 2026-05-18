export const PLAYLIST_OPEN_REQUEST_EVENT = 'playlist-open-request';

export interface PlaylistOpenRequestDetail {
  slug: string;
}

export function requestPlaylistOpen(slug: string, windowObj: Window = window): boolean {
  const normalizedSlug = slug.trim();
  if (!normalizedSlug) {
    return false;
  }

  windowObj.dispatchEvent(
    new CustomEvent<PlaylistOpenRequestDetail>(PLAYLIST_OPEN_REQUEST_EVENT, {
      detail: { slug: normalizedSlug },
    }),
  );
  return true;
}
