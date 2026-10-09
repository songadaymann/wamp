import { replayPosition, type ReplaySample } from '../analytics/replay/model';

export const BUG_REPLAY_MS = 15_000;
export const BUG_FRAME_LIMIT = 8_000;
export const BUG_FRAME_COUNT = 120;
export const BUG_EVIDENCE_LIMIT = 1_000_000;
export const BUG_NOTES_LIMIT = 2_000;
export const BUG_RECORDING_CHANGED = 'wamp-recording-preference-changed';
export type BugEvidenceReason = 'captured' | 'disabled' | 'unavailable' | 'not_attached';
export interface BugContext {
  scene: string;
  mode: ReplaySample['mode'];
  coordinates: { x: number; y: number } | null;
  roomId: string | null;
  roomVersion: number | null;
  publishedVersion: number | null;
  source: 'published' | 'draft' | 'unknown';
  dirty: boolean;
  courseId: string | null;
  courseVersion: number | null;
  expandedRoomId: string | null;
  player: ReplaySample['player'];
  camera: { x: number; y: number; zoom: number | null } | null;
}
export interface BugDevice {
  browser: string;
  browserVersion: string;
  platform: string;
  width: number;
  height: number;
  pixelRatio: number;
  touch: boolean;
}
export interface BugDiagnostic {
  kind: 'runtime' | 'unhandled_rejection' | 'graphics_lost';
  source: string | null;
  line: number | null;
  column: number | null;
  time: number;
}
export interface BugEvidence {
  samples: ReplaySample[];
  screenshot: string | null;
  reason: BugEvidenceReason;
}
export interface BugReportSubmission {
  id: string;
  visitor: string;
  notes: string;
  build: string;
  context: BugContext;
  device: BugDevice;
  errors: BugDiagnostic[];
  evidence: BugEvidence;
}
export interface BugReportSummary {
  id: string;
  notes: string;
  status: 'open' | 'resolved';
  createdAt: string;
  signedIn: boolean;
  context: BugContext;
  build: string;
  frames: number;
  durationMs: number;
  hasScreenshot: boolean;
  evidenceExpiresAt: string | null;
}
export interface BugReportDetail extends BugReportSummary {
  device: BugDevice;
  errors: BugDiagnostic[];
  evidence: BugEvidence;
}
export const bugObject = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const identifier = (value: unknown): string | null =>
  typeof value === 'string' && /^[a-zA-Z0-9_,:-]{1,120}$/.test(value) ? value : null;
const version = (value: unknown): number | null =>
  Number.isSafeInteger(value) && Number(value) > 0 ? Number(value) : null;
export function normalizeBugContext(value: unknown): BugContext {
  const input = bugObject(value), rawCoordinates = bugObject(input.coordinates), rawCamera = bugObject(input.camera);
  const coordinates = Number.isSafeInteger(rawCoordinates.x) && Number.isSafeInteger(rawCoordinates.y)
    && Math.abs(Number(rawCoordinates.x)) < 10_000_000 && Math.abs(Number(rawCoordinates.y)) < 10_000_000
    ? { x: Number(rawCoordinates.x), y: Number(rawCoordinates.y) } : null;
  const cameraPosition = replayPosition(rawCamera);
  return {
    scene: identifier(input.scene) ?? 'unknown',
    mode: input.mode === 'edit' || input.mode === 'play' ? input.mode : 'browse',
    coordinates, roomId: coordinates ? `${coordinates.x},${coordinates.y}` : identifier(input.roomId),
    roomVersion: version(input.roomVersion), publishedVersion: version(input.publishedVersion),
    source: input.source === 'published' || input.source === 'draft' ? input.source : 'unknown', dirty: input.dirty === true,
    courseId: identifier(input.courseId), courseVersion: version(input.courseVersion), expandedRoomId: identifier(input.expandedRoomId),
    player: replayPosition(input.player),
    camera: cameraPosition ? { ...cameraPosition, zoom: typeof rawCamera.zoom === 'number' && Number.isFinite(rawCamera.zoom)
      && rawCamera.zoom > 0 && rawCamera.zoom <= 100 ? rawCamera.zoom : null } : null,
  };
}
export function normalizeBugDevice(value: unknown): BugDevice {
  const input = bugObject(value);
  const dimension = (v: unknown) => Number.isInteger(v) && Number(v) > 0 && Number(v) < 50_000 ? Number(v) : 0;
  return {
    browser: ['Chrome','Firefox','Safari','Edge','Other'].includes(String(input.browser)) ? String(input.browser) : 'Other',
    browserVersion: typeof input.browserVersion === 'string' && /^[\d.]{1,24}$/.test(input.browserVersion) ? input.browserVersion : '',
    platform: ['iOS','Android','macOS','Windows','Linux','Other'].includes(String(input.platform)) ? String(input.platform) : 'Other',
    width: dimension(input.width), height: dimension(input.height),
    pixelRatio: typeof input.pixelRatio === 'number' && input.pixelRatio >= 0.5 && input.pixelRatio <= 10 ? input.pixelRatio : 1,
    touch: input.touch === true,
  };
}
export function normalizeBugDiagnostics(value: unknown): BugDiagnostic[] {
  if (!Array.isArray(value)) return [];
  return value.slice(-12).flatMap(raw => {
    const item = bugObject(raw);
    if (!['runtime','unhandled_rejection','graphics_lost'].includes(String(item.kind))) return [];
    // Deliberately omit exception/rejection messages: they can echo credentials or form/chat text.
    const source = typeof item.source === 'string' && item.source.length <= 180
      && /^(?:assets|src|node_modules)\/[A-Za-z0-9_./-]+\.(?:m?js|tsx?)$/.test(item.source) ? item.source : null;
    const number = (v: unknown) => Number.isInteger(v) && Number(v) >= 0 && Number(v) < 1_000_000_000 ? Number(v) : null;
    return [{ kind: item.kind as BugDiagnostic['kind'], source, line: number(item.line), column: number(item.column), time: number(item.time) ?? 0 }];
  });
}
export function bugRoomHref(context: BugContext): string | null {
  const room = context.coordinates;
  return room ? `/r/${room.x}/${room.y}?welcome=0` : null;
}
