import { cloneRoomSnapshot, type RoomSnapshot } from '../persistence/roomModel';
import { TUTORIAL_TEMPLATE_VERSIONS } from './config';
import {
  CREATIVE_CHECKLIST_ITEMS,
  TUTORIAL_PROGRESS_STORAGE_KEY,
  TUTORIAL_PROGRESS_VERSION,
  cloneCreativeChecklist,
  createEmptyCreativeChecklist,
  getTutorialTerminalStatus,
  type CreativeChecklistItemState,
  type CreativeChecklistState,
  type TutorialProgressV1,
  type TutorialStage,
} from './model';

const TUTORIAL_STAGES = new Set<TutorialStage>([
  'dream',
  'wake',
  'room_traversal',
  'bridge_prompt',
  'bridge_edit',
  'bridge_playtest',
  'bridge_complete',
  'creative_edit',
  'awaiting_claim',
  'completed',
  'dismissed',
]);
const CHECKLIST_STATES = new Set<CreativeChecklistItemState>(['pending', 'done', 'skipped']);

export interface TutorialProgressStoreOptions {
  storage?: Storage;
  now?: () => Date;
  createSessionId?: () => string;
}

export class TutorialProgressStore {
  private readonly storage: Storage;
  private readonly now: () => Date;
  private readonly createSessionId: () => string;

  constructor(options: TutorialProgressStoreOptions = {}) {
    this.storage = options.storage ?? window.localStorage;
    this.now = options.now ?? (() => new Date());
    this.createSessionId = options.createSessionId ?? createTutorialSessionId;
  }

  create(): TutorialProgressV1 {
    return {
      version: TUTORIAL_PROGRESS_VERSION,
      sessionId: this.createSessionId(),
      stage: 'dream',
      templateVersions: { ...TUTORIAL_TEMPLATE_VERSIONS },
      workingSnapshot: null,
      bridgeBackupSnapshot: null,
      creativeChecklist: createEmptyCreativeChecklist(),
      selectedClaimCoordinates: null,
      terminalStatus: 'active',
      updatedAt: this.now().toISOString(),
    };
  }

  load(): TutorialProgressV1 | null {
    const raw = this.storage.getItem(TUTORIAL_PROGRESS_STORAGE_KEY);
    if (!raw) return null;

    try {
      const parsed = JSON.parse(raw) as unknown;
      const normalized = normalizeStoredProgress(parsed);
      if (!normalized) {
        this.storage.removeItem(TUTORIAL_PROGRESS_STORAGE_KEY);
        return null;
      }
      return normalized;
    } catch {
      this.storage.removeItem(TUTORIAL_PROGRESS_STORAGE_KEY);
      return null;
    }
  }

  save(progress: TutorialProgressV1): TutorialProgressV1 {
    const next = cloneTutorialProgress({
      ...progress,
      version: TUTORIAL_PROGRESS_VERSION,
      terminalStatus: getTutorialTerminalStatus(progress.stage),
      updatedAt: this.now().toISOString(),
    });
    this.storage.setItem(TUTORIAL_PROGRESS_STORAGE_KEY, JSON.stringify(next));
    return next;
  }

  clear(): void {
    this.storage.removeItem(TUTORIAL_PROGRESS_STORAGE_KEY);
  }
}

export function cloneTutorialProgress(progress: TutorialProgressV1): TutorialProgressV1 {
  return {
    ...progress,
    templateVersions: { ...progress.templateVersions },
    workingSnapshot: progress.workingSnapshot ? cloneRoomSnapshot(progress.workingSnapshot) : null,
    bridgeBackupSnapshot: progress.bridgeBackupSnapshot
      ? cloneRoomSnapshot(progress.bridgeBackupSnapshot)
      : null,
    creativeChecklist: cloneCreativeChecklist(progress.creativeChecklist),
    selectedClaimCoordinates: progress.selectedClaimCoordinates
      ? { ...progress.selectedClaimCoordinates }
      : null,
  };
}

function normalizeStoredProgress(value: unknown): TutorialProgressV1 | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<TutorialProgressV1>;
  if (
    candidate.version !== TUTORIAL_PROGRESS_VERSION
    || typeof candidate.sessionId !== 'string'
    || !candidate.sessionId.trim()
    || typeof candidate.stage !== 'string'
    || !TUTORIAL_STAGES.has(candidate.stage as TutorialStage)
    || !candidate.templateVersions
    || candidate.templateVersions.wakeRoom !== TUTORIAL_TEMPLATE_VERSIONS.wakeRoom
    || candidate.templateVersions.bridgeRoom !== TUTORIAL_TEMPLATE_VERSIONS.bridgeRoom
    || typeof candidate.updatedAt !== 'string'
  ) {
    return null;
  }

  const stage = candidate.stage as TutorialStage;
  const checklist = normalizeChecklist(candidate.creativeChecklist);
  if (!checklist) return null;
  const workingSnapshot = normalizeSnapshot(candidate.workingSnapshot);
  const bridgeBackupSnapshot = normalizeSnapshot(candidate.bridgeBackupSnapshot);
  if (candidate.workingSnapshot && !workingSnapshot) return null;
  if (candidate.bridgeBackupSnapshot && !bridgeBackupSnapshot) return null;

  const selectedClaimCoordinates = candidate.selectedClaimCoordinates;
  if (
    selectedClaimCoordinates !== null
    && selectedClaimCoordinates !== undefined
    && (
      typeof selectedClaimCoordinates.x !== 'number'
      || !Number.isInteger(selectedClaimCoordinates.x)
      || typeof selectedClaimCoordinates.y !== 'number'
      || !Number.isInteger(selectedClaimCoordinates.y)
    )
  ) {
    return null;
  }

  return {
    version: TUTORIAL_PROGRESS_VERSION,
    sessionId: candidate.sessionId,
    stage,
    templateVersions: { ...TUTORIAL_TEMPLATE_VERSIONS },
    workingSnapshot,
    bridgeBackupSnapshot,
    creativeChecklist: checklist,
    selectedClaimCoordinates: selectedClaimCoordinates ? { ...selectedClaimCoordinates } : null,
    terminalStatus: getTutorialTerminalStatus(stage),
    updatedAt: candidate.updatedAt,
  };
}

function normalizeChecklist(value: unknown): CreativeChecklistState | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<CreativeChecklistState>;
  const result = createEmptyCreativeChecklist();
  for (const item of CREATIVE_CHECKLIST_ITEMS) {
    const state = candidate[item];
    if (!state || !CHECKLIST_STATES.has(state)) return null;
    result[item] = state;
  }
  return result;
}

function normalizeSnapshot(value: unknown): RoomSnapshot | null {
  if (value === null || value === undefined) return null;
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<RoomSnapshot>;
  if (
    typeof candidate.id !== 'string'
    || !candidate.coordinates
    || !Number.isInteger(candidate.coordinates.x)
    || !Number.isInteger(candidate.coordinates.y)
    || typeof candidate.background !== 'string'
    || !candidate.tileData
    || !Array.isArray(candidate.placedObjects)
    || typeof candidate.version !== 'number'
    || typeof candidate.createdAt !== 'string'
    || typeof candidate.updatedAt !== 'string'
  ) {
    return null;
  }
  return cloneRoomSnapshot(candidate as RoomSnapshot);
}

function createTutorialSessionId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `tutorial-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
