type ProtectedRoomEntry = { protectedCellCount?: number; expandedRoom?: { cellCount: number } | null };

export function roomProtectionLabel(entry: ProtectedRoomEntry): string | null {
  const count = entry.protectedCellCount ?? 0;
  const total = entry.expandedRoom?.cellCount ?? 1;
  if (!Number.isSafeInteger(count) || !Number.isSafeInteger(total) || count < 1 || count > total) return null;
  return total > 1 ? `${count}/${total} cells protected` : 'Protected';
}

export function createRoomProtectionBadge(doc: Document, entry: ProtectedRoomEntry): HTMLElement | null {
  const label = roomProtectionLabel(entry);
  if (!label) return null;
  const badge = doc.createElement('span');
  badge.className = 'room-protection-badge';
  badge.textContent = label;
  badge.title = 'Only the owner can edit a protected cell.';
  return badge;
}
