export type SurfaceAuthSource = 'session' | 'playfun' | 'api_token' | 'agent_token' | null;

export function isWampLeaderboardEligibleAuth(
  authenticated: boolean,
  source: SurfaceAuthSource,
  _displayName: string | null | undefined
): boolean {
  return authenticated
    && !isPlayfunSurfaceAuth(source);
}

export function isPlayfunSurfaceAuth(source: SurfaceAuthSource): boolean {
  return source === 'playfun';
}
