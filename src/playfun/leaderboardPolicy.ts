export type SurfaceAuthSource = 'session' | 'playfun' | 'api_token' | 'agent_token' | null;

export function isWampLeaderboardEligibleAuth(
  authenticated: boolean,
  source: SurfaceAuthSource
): boolean {
  return authenticated && source !== 'playfun';
}

export function isPlayfunSurfaceAuth(source: SurfaceAuthSource): boolean {
  return source === 'playfun';
}
