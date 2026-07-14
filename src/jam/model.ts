export const JAM_SLUG = 'solo-room-jam-2026-07';
export const JAM_ROOM_CLAIM_OPEN_AT = '2026-07-20T04:00:00.000Z';
export const JAM_ROOM_CLAIM_CLOSE_AT = '2026-07-27T03:59:59.999Z';
export const DEFAULT_JAM_SUBMISSIONS_OPEN_AT = JAM_ROOM_CLAIM_OPEN_AT;
export const DEFAULT_JAM_SUBMISSIONS_CLOSE_AT = JAM_ROOM_CLAIM_CLOSE_AT;

const MAX_COORDINATE_MAGNITUDE = 1_000_000;
const ROOM_PATH_PATTERN = /^\/r\/(-?\d+)\/(-?\d+)\/?$/;
const COORDINATE_PATTERN = /^\(?\s*(-?\d+)\s*[,/]\s*(-?\d+)\s*\)?$/;
const TRUSTED_ROOM_HOSTS = new Set([
  'wamp.land',
  'www.wamp.land',
  'wampland.pages.dev',
]);

export interface JamRoomCoordinates {
  x: number;
  y: number;
}

export interface ParsedJamRoomReference {
  coordinates: JamRoomCoordinates;
  canonicalUrl: string;
}

export interface JamConfigResponse {
  openAt: string;
  closeAt: string;
  submissionsOpen: boolean;
  turnstileSiteKey: string | null;
  turnstileRequired: boolean;
}

export interface JamSubmissionRequestBody {
  username: string;
  email: string;
  roomReference: string;
  rulesAccepted: boolean;
  website?: string;
  turnstileToken?: string | null;
}

export interface JamSubmissionPublic {
  id: string;
  username: string;
  roomCoordinates: JamRoomCoordinates;
  roomUrl: string;
  createdAt: string;
  updatedAt: string;
}

export interface JamSubmissionResponse {
  submission: JamSubmissionPublic;
  updated: boolean;
}

export function parseJamRoomReference(value: string): ParsedJamRoomReference | null {
  const input = value.trim();
  if (!input || input.length > 300) {
    return null;
  }

  const directMatch = COORDINATE_PATTERN.exec(input);
  if (directMatch) {
    return buildParsedReference(directMatch[1], directMatch[2]);
  }

  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return null;
  }

  const hostname = url.hostname.toLowerCase();
  if (!TRUSTED_ROOM_HOSTS.has(hostname) && !hostname.endsWith('.wampland.pages.dev')) {
    return null;
  }

  const pathMatch = ROOM_PATH_PATTERN.exec(url.pathname);
  if (pathMatch) {
    return buildParsedReference(pathMatch[1], pathMatch[2]);
  }

  if (url.pathname === '/' || url.pathname === '/index.html') {
    return buildParsedReference(url.searchParams.get('x'), url.searchParams.get('y'));
  }

  return null;
}

function buildParsedReference(xValue: string | null, yValue: string | null): ParsedJamRoomReference | null {
  if (xValue === null || yValue === null || !/^-?\d+$/.test(xValue) || !/^-?\d+$/.test(yValue)) {
    return null;
  }

  const x = Number(xValue);
  const y = Number(yValue);
  if (
    !Number.isSafeInteger(x)
    || !Number.isSafeInteger(y)
    || Math.abs(x) > MAX_COORDINATE_MAGNITUDE
    || Math.abs(y) > MAX_COORDINATE_MAGNITUDE
  ) {
    return null;
  }

  return {
    coordinates: { x, y },
    canonicalUrl: `https://wamp.land/r/${x}/${y}`,
  };
}
