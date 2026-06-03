import type { ProfilePublishedRoomEntry } from '../../profiles/model';
import { ROOM_DIFFICULTY_LABELS } from '../../runs/model';

type ProfileRoomElements = {
  roomsList: HTMLElement | null;
  roomsEmpty: HTMLElement | null;
};

type ProfileRoomRenderOptions = {
  canEdit: boolean;
  playlistBusy: boolean;
  hasPlaylists: boolean;
  hasSelectedPlaylist: boolean;
  formatShortDate: (value: string) => string;
  onOpenRoom: (room: ProfilePublishedRoomEntry) => void;
  onAddRoomToPlaylist: (room: ProfilePublishedRoomEntry) => void;
  observeRoomPreview: (
    room: ProfilePublishedRoomEntry,
    previewEl: HTMLElement,
    imageEl: HTMLImageElement,
    fallbackEl: HTMLElement,
  ) => void;
};

export function renderProfileRooms(
  doc: Document,
  elements: ProfileRoomElements,
  rooms: ProfilePublishedRoomEntry[],
  options: ProfileRoomRenderOptions,
): void {
  if (!elements.roomsList) {
    return;
  }

  elements.roomsEmpty?.classList.toggle('hidden', rooms.length > 0);
  elements.roomsList.replaceChildren(
    ...rooms.map((room) => createRoomRow(doc, room, options)),
  );
}

export function getProfileRoomTitle(room: ProfilePublishedRoomEntry): string {
  return (
    room.expandedRoom?.title?.trim()
    || room.roomTitle?.trim()
    || `Room ${room.roomCoordinates.x},${room.roomCoordinates.y}`
  );
}

function createRoomRow(
  doc: Document,
  room: ProfilePublishedRoomEntry,
  options: ProfileRoomRenderOptions,
): HTMLElement {
  const button = doc.createElement('button');
  button.type = 'button';
  button.className = 'profile-room-card';
  button.addEventListener('click', () => {
    options.onOpenRoom(room);
  });

  const preview = doc.createElement('div');
  preview.className = 'profile-room-preview';

  const previewImage = doc.createElement('img');
  previewImage.className = 'profile-room-preview-image hidden';
  previewImage.alt = `${getProfileRoomTitle(room)} preview`;

  const previewFallback = doc.createElement('div');
  previewFallback.className = 'profile-room-preview-fallback';
  previewFallback.textContent = `${room.roomCoordinates.x},${room.roomCoordinates.y}`;

  preview.append(previewImage, previewFallback);

  const copy = doc.createElement('div');
  copy.className = 'profile-room-card-copy';

  const title = doc.createElement('div');
  title.className = 'profile-room-card-title';
  title.textContent = getProfileRoomTitle(room);

  const meta = doc.createElement('div');
  meta.className = 'profile-room-card-meta';
  meta.textContent = getProfileRoomMeta(room, options.formatShortDate);

  copy.append(title, meta, createRoomRatingRow(doc, room));
  button.append(preview, copy);
  options.observeRoomPreview(room, preview, previewImage, previewFallback);
  if (options.canEdit) {
    const row = doc.createElement('div');
    row.className = 'profile-room-playlist-row';
    row.append(button, createAddRoomToPlaylistButton(doc, room, options));
    return row;
  }

  return button;
}

function createAddRoomToPlaylistButton(
  doc: Document,
  room: ProfilePublishedRoomEntry,
  options: ProfileRoomRenderOptions,
): HTMLButtonElement {
  const button = doc.createElement('button');
  button.type = 'button';
  button.className = 'bar-btn bar-btn-small profile-add-room-playlist-btn';
  button.textContent = options.playlistBusy ? 'Adding...' : 'Add';
  button.disabled = options.playlistBusy || !options.hasPlaylists || !options.hasSelectedPlaylist;
  button.title = options.hasPlaylists ? 'Add this room to the selected playlist.' : 'Create a playlist first.';
  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    options.onAddRoomToPlaylist(room);
  });
  return button;
}

function createRoomRatingRow(doc: Document, room: ProfilePublishedRoomEntry): HTMLElement {
  const row = doc.createElement('div');
  row.className = 'profile-room-card-ratings';

  row.append(
    createRoomDifficultyBadge(doc, room),
    createRoomQualitySummary(doc, room),
  );
  return row;
}

function createRoomDifficultyBadge(doc: Document, room: ProfilePublishedRoomEntry): HTMLElement {
  const badge = doc.createElement('div');
  badge.className = 'profile-room-card-difficulty';
  const difficulty = room.consensusDifficulty;
  if (difficulty) {
    badge.dataset.difficulty = difficulty;
    badge.textContent = ROOM_DIFFICULTY_LABELS[difficulty];
  } else {
    badge.dataset.difficulty = 'unrated';
    badge.textContent = 'Unrated';
  }
  return badge;
}

function createRoomQualitySummary(doc: Document, room: ProfilePublishedRoomEntry): HTMLElement {
  const quality = doc.createElement('div');
  quality.className = 'profile-room-card-quality';

  const stars = doc.createElement('div');
  stars.className = 'profile-room-card-stars';
  const average = room.quality.adjustedAverage ?? room.quality.rawAverage ?? null;
  const filledCount = average === null ? 0 : Math.max(0, Math.min(5, Math.round(average)));
  for (let index = 0; index < 5; index += 1) {
    const star = doc.createElement('span');
    star.className = 'profile-room-card-star';
    if (index < filledCount) {
      star.classList.add('active');
    }
    star.textContent = '★';
    stars.appendChild(star);
  }

  const label = doc.createElement('div');
  label.className = 'profile-room-card-quality-label';
  label.textContent = average === null ? 'Not rated yet' : `${average.toFixed(1)} stars`;

  quality.append(stars, label);
  return quality;
}

function getProfileRoomMeta(
  room: ProfilePublishedRoomEntry,
  formatShortDate: (value: string) => string,
): string {
  const goalText = room.goalType ? room.goalType.replace(/_/g, ' ') : 'free play';
  const publishedText = room.publishedAt ? formatShortDate(room.publishedAt) : 'Unpublished';
  const expandedRoom = room.expandedRoom;
  if (expandedRoom && expandedRoom.cellCount > 1) {
    const versionText =
      typeof expandedRoom.expandedRoomVersion === 'number'
        ? `v${expandedRoom.expandedRoomVersion}`
        : `v${room.roomVersion}`;
    return `${goalText} · ${expandedRoom.cellCount} cells · ${versionText} · focus ${room.roomCoordinates.x},${room.roomCoordinates.y} · ${publishedText}`;
  }

  return `${goalText} · v${room.roomVersion} · ${room.roomCoordinates.x},${room.roomCoordinates.y} · ${publishedText}`;
}
