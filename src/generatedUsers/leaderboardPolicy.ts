export type SurfaceAuthSource = 'session' | 'api_token' | 'agent_token' | null;

export function isWampLeaderboardEligibleAuth(
  authenticated: boolean,
  _source: SurfaceAuthSource,
  _displayName: string | null | undefined
): boolean {
  return authenticated;
}
