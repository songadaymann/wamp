import { displayNameKey } from '../core/displayText';

/**
 * An entry shows as signed in only under its account's current display name, compared the way
 * account names are kept unique. It is decided whenever entries are shown, so an account that
 * renames loses the mark on entries signed under its old name.
 */
export function isAccountGuestbookName(entryName: string, accountDisplayName: string | null | undefined): boolean {
  if (!accountDisplayName) return false;
  const account = displayNameKey(accountDisplayName);
  return account.length > 0 && displayNameKey(entryName) === account;
}
