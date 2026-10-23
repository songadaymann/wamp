/** Zero-width and text-direction controls: invisible, so they are removed before any other check. */
const INVISIBLE_FORMATTING = /[​-‏‪-‮⁦-⁩﻿]/g;

/** How names and messages are stored: invisible formatting removed, runs of whitespace as one space. */
export function cleanGuestbookText(value: string): string {
  return value.replace(INVISIBLE_FORMATTING, '').replace(/\s+/g, ' ').trim();
}

/**
 * An entry shows as signed in only under its account's current display name, ignoring case and
 * spacing. It is decided whenever entries are shown, so an account that renames loses the mark on
 * entries signed under its old name.
 */
export function isAccountGuestbookName(entryName: string, accountDisplayName: string | null | undefined): boolean {
  if (!accountDisplayName) return false;
  const account = cleanGuestbookText(accountDisplayName).toLowerCase();
  return account.length > 0 && cleanGuestbookText(entryName).toLowerCase() === account;
}
