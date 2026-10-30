import { describe, expect, it } from 'vitest';
import { cloneRoomRecord, createDefaultRoomRecord, createRoomRecordFromCurrent, createRoomSummaryFromRecord, isRoomMinted } from './roomModel';
import { normalizeRoomCryptoDetails, ROOM_CRYPTO_FIELDS } from './roomCryptoDetails';

describe('redacted room ownership hydration', () => {
  it('keeps protection and permissions through summary, current, normalization and clone without a token surrogate', () => {
    const record = createDefaultRoomRecord();
    record.isProtected = true; record.permissions.canSaveDraft = false;
    const summary = createRoomSummaryFromRecord(record);
    for (const key of ROOM_CRYPTO_FIELDS) delete (summary as unknown as Record<string, unknown>)[key];
    const normalized = normalizeRoomCryptoDetails(summary);
    const restored = cloneRoomRecord(createRoomRecordFromCurrent({ summary: normalized, draft: record.draft, published: null }));
    expect(isRoomMinted(restored)).toBe(true);
    expect(restored.permissions.canSaveDraft).toBe(false);
    for (const key of ROOM_CRYPTO_FIELDS) expect(restored[key]).toBeNull();
    expect(isRoomMinted({})).toBe(false);
  });

  it('discards an opt-in response after disconnection while retaining protection', () => {
    const summary = createRoomSummaryFromRecord({ ...createDefaultRoomRecord(), mintedTokenId: '42' });
    const disconnected = normalizeRoomCryptoDetails(summary, false);
    expect(isRoomMinted(disconnected)).toBe(true); expect(disconnected.mintedTokenId).toBeNull();
  });
});
