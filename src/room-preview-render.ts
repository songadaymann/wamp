import { renderRoomSnapshotToPngDataUrl } from './mint/roomMetadataRender';
import type { RoomSnapshot } from './persistence/roomModel';

declare global {
  interface Window {
    __ROOM_PREVIEW_READY__?: boolean;
    __ROOM_PREVIEW_DATA_URL__?: string;
    __ROOM_PREVIEW_ERROR__?: string;
  }
}

const titleEl = document.getElementById('room-preview-title');
const statusEl = document.getElementById('room-preview-status');
const imageEl = document.getElementById('room-preview-image') as HTMLImageElement | null;

void bootstrap();

async function bootstrap(): Promise<void> {
  window.__ROOM_PREVIEW_READY__ = false;
  window.__ROOM_PREVIEW_DATA_URL__ = '';
  window.__ROOM_PREVIEW_ERROR__ = '';

  try {
    const params = new URLSearchParams(window.location.search);
    const roomId = params.get('roomId')?.trim() ?? '';
    if (!roomId) {
      throw new Error('Missing roomId query parameter.');
    }

    const coordinates = parseRoomCoordinates(roomId);
    if (!coordinates) {
      throw new Error(`Invalid roomId "${roomId}".`);
    }

    const apiBase = resolveApiBase(params.get('apiBase'));
    updateTitle(`Room ${roomId}`);
    updateStatus(`Fetching published room from ${new URL(apiBase).host}.`);

    const response = await fetch(
      `${apiBase}/api/rooms/${encodeURIComponent(roomId)}/published?x=${coordinates.x}&y=${coordinates.y}`
    );
    if (!response.ok) {
      throw new Error(`Failed to load published room ${roomId}: ${response.status}`);
    }

    const snapshot = (await response.json()) as RoomSnapshot;
    updateTitle(snapshot.title?.trim() || `Room ${roomId}`);
    updateStatus('Rendering WAMP room preview.');
    const dataUrl = await renderRoomSnapshotToPngDataUrl(snapshot, {
      tilePixelSize: 2,
    });

    if (imageEl) {
      imageEl.src = dataUrl;
    }
    window.__ROOM_PREVIEW_DATA_URL__ = dataUrl;
    window.__ROOM_PREVIEW_READY__ = true;
    updateStatus('Preview ready.');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('Failed to render room preview', error);
    window.__ROOM_PREVIEW_ERROR__ = message;
    updateStatus(message, true);
  }
}

function resolveApiBase(queryValue: string | null): string {
  const trimmed = queryValue?.trim();
  if (trimmed) {
    return trimmed.replace(/\/+$/, '');
  }

  const configured = import.meta.env.VITE_ROOM_API_BASE_URL?.trim();
  if (configured) {
    return configured.replace(/\/+$/, '');
  }

  return window.location.origin.replace(/\/+$/, '');
}

function parseRoomCoordinates(roomId: string): { x: number; y: number } | null {
  const match = roomId.match(/^(-?\d+),(-?\d+)$/);
  if (!match) {
    return null;
  }

  return {
    x: Number.parseInt(match[1], 10),
    y: Number.parseInt(match[2], 10),
  };
}

function updateTitle(text: string): void {
  if (titleEl) {
    titleEl.textContent = text;
  }
}

function updateStatus(text: string, isError = false): void {
  if (statusEl) {
    statusEl.textContent = text;
    statusEl.classList.toggle('error', isError);
  }
}
