import type { WorldMembershipStatus, WorldViewerRole } from './model';

const WORLD_CONTEXT_CHANGED_EVENT = 'wamp:world-context-changed';

export interface ActiveWorldContext {
  worldId: string;
  viewerRole: WorldViewerRole;
  membershipStatus: WorldMembershipStatus | null;
}

let activeWorld: ActiveWorldContext | null = null;

export function getActiveWorldId(): string | null {
  return activeWorld?.worldId ?? null;
}

export function setActiveWorldId(worldId: string | null): void {
  const normalized = worldId?.trim() || null;
  setActiveWorldContext(normalized ? { worldId: normalized, viewerRole: null, membershipStatus: null } : null);
}

export function setActiveWorldContext(context: ActiveWorldContext | null): void {
  const normalized = context?.worldId.trim() || null;
  const next = normalized ? { ...context!, worldId: normalized } : null;
  if (
    next?.worldId === activeWorld?.worldId &&
    next?.viewerRole === activeWorld?.viewerRole &&
    next?.membershipStatus === activeWorld?.membershipStatus
  ) return;
  activeWorld = next;
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(WORLD_CONTEXT_CHANGED_EVENT, {
      detail: { worldId: activeWorld?.worldId ?? null },
    }));
  }
}

export function canBuildInActiveWorld(worldId: string): boolean {
  if (activeWorld?.worldId !== worldId) return false;
  if (activeWorld.viewerRole === 'owner') return true;
  return (
    activeWorld.membershipStatus === 'active' &&
    (activeWorld.viewerRole === 'manager' || activeWorld.viewerRole === 'builder')
  );
}

export function withActiveWorldQuery(params: URLSearchParams): URLSearchParams {
  const worldId = getActiveWorldId();
  if (worldId) params.set('worldId', worldId);
  return params;
}

export { WORLD_CONTEXT_CHANGED_EVENT };
