/**
 * Removed from names and messages before they are stored: characters that draw nothing and that no
 * language needs (zero-width space, direction controls, word joiners, soft hyphen, Hangul fillers).
 * Zero-width joiners and non-joiners stay, since emoji sequences and scripts such as Persian need them.
 */
const INVISIBLE_IN_STORED_TEXT = /[\u00AD\u061C\u115F\u1160\u200B\u200E\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\u3164\uFEFF\uFFA0]/g;

/**
 * Also ignored when two names are compared: every format character (joiners and tags included),
 * the combining grapheme joiner, Hangul fillers and variation selectors.
 */
const IGNORED_IN_NAME_KEY = /[\p{Cf}\u034F\u115F\u1160\u3164\uFFA0\uFE00-\uFE0F\u{E0000}-\u{E007F}\u{E0100}-\u{E01EF}]/gu;

/** A name or message as it is stored: invisible characters removed, each run of whitespace one space. */
export function cleanDisplayText(value: string): string {
  return value.replace(INVISIBLE_IN_STORED_TEXT, '').replace(/\s+/g, ' ').trim();
}

/**
 * What two display names are compared by, so names that read the same are the same name: NFKC
 * (full-width and other compatibility forms fold to plain ones), invisible and format characters
 * dropped, whitespace collapsed, Unicode lower case. Letters from different scripts that merely look
 * alike (Latin "a" and Cyrillic "a") still differ.
 */
export function displayNameKey(value: string): string {
  return value.normalize('NFKC').replace(IGNORED_IN_NAME_KEY, '').replace(/\s+/g, ' ').trim().toLowerCase();
}
