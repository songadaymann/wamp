/** Display names may be shared; usernames identify the account when available. */
export function formatAccountIdentity(displayName: string, username?: string | null): string {
  return username?.trim() ? `${displayName} (@${username.trim()})` : displayName;
}
