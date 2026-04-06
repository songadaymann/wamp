import { isPlayfunLeaderboardExcludedDisplayName } from './identity';

export type SurfaceAuthSource = 'session' | 'playfun' | 'api_token' | 'agent_token' | null;

export function isWampLeaderboardEligibleAuth(
  authenticated: boolean,
  _source: SurfaceAuthSource,
  displayName: string | null | undefined
): boolean {
  return authenticated
    && !isPlayfunLeaderboardExcludedDisplayName(displayName);
}

export function isPlayfunSurfaceAuth(source: SurfaceAuthSource): boolean {
  return source === 'playfun';
}
