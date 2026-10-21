import { createAdminApiClient } from '../adminApiClient';
import type { AdminBuildingModerationResponse, AdminRevertEditsResponse, AdminRevertEditsRoom } from '../model';

const SKIP_REASON_TEXT: Record<NonNullable<AdminRevertEditsRoom['reason']>, string> = {
  own_room: 'their own room',
  minted: 'minted room',
  no_earlier_version: 'no earlier version by someone else',
  changed_since: 'someone else published in between or after',
  newer_draft: 'a newer unpublished draft — restore it from History by hand',
};

/** Suspend a builder and undo their edits to other builders' rooms, for the selected user. */
export function createBuildingPanel(
  getAdminKey: () => string,
  getOperatorLabel: () => string,
): { show(userId: string | null): void } {
  const card = document.getElementById('building-card');
  const status = document.getElementById('building-status');
  const reasonInput = document.getElementById('building-reason-input') as HTMLTextAreaElement | null;
  const suspendButton = document.getElementById('building-suspend-button') as HTMLButtonElement | null;
  const sinceInput = document.getElementById('building-since-input') as HTMLInputElement | null;
  const previewButton = document.getElementById('building-preview-button') as HTMLButtonElement | null;
  const revertButton = document.getElementById('building-revert-button') as HTMLButtonElement | null;
  const list = document.getElementById('building-rooms');
  const client = createAdminApiClient(getAdminKey);
  let userId: string | null = null;
  let moderation: AdminBuildingModerationResponse | null = null;
  // The exact user and window a preview showed; Restore only ever sends these.
  let previewed: { userId: string; since: string; pending: number } | null = null;
  let busy = false;
  let generation = 0;

  function setStatus(message: string): void {
    if (status) status.textContent = message;
  }

  function syncButtons(): void {
    if (suspendButton) suspendButton.disabled = busy || !moderation;
    if (previewButton) previewButton.disabled = busy || !userId;
    if (revertButton) revertButton.disabled = busy || !previewed || previewed.userId !== userId || previewed.pending === 0;
  }

  function renderModeration(): void {
    if (suspendButton) {
      suspendButton.textContent = moderation?.suspendedAt ? 'Lift Suspension' : 'Suspend Account';
      suspendButton.className = moderation?.suspendedAt ? 'secondary' : 'danger';
    }
    const last = moderation?.recentActions[0];
    setStatus((moderation?.suspendedAt
      ? `Suspended ${new Date(moderation.suspendedAt).toLocaleString()}: ${moderation.suspendedReason ?? ''}.`
      : 'Not suspended. A suspended account can still play, but saves, publishes and posts are refused, and its bot tokens are revoked.')
      + (last ? ` Last action: ${last.action} by ${last.operatorLabel}, ${new Date(last.createdAt).toLocaleString()}.` : ''));
    syncButtons();
  }

  function renderRooms(response: AdminRevertEditsResponse, reverted: AdminRevertEditsResponse['reverted']): void {
    list?.replaceChildren(...response.rooms.map((room) => {
      const row = document.createElement('div');
      row.className = 'audit-item';
      const name = `${room.title?.trim() || 'Untitled'} (${room.x}, ${room.y})`;
      const done = reverted.find((entry) => entry.roomId === room.roomId);
      const failed = response.failed.find((entry) => entry.roomId === room.roomId);
      row.textContent = done ? `${name}: restored v${done.toVersion}`
        : failed ? `${name}: failed — ${failed.error}`
          : room.action === 'revert' ? `${name}: ${room.editCount} edit(s), will restore v${room.targetVersion}`
            : `${name}: skipped (${SKIP_REASON_TEXT[room.reason!]})`;
      return row;
    }));
  }

  async function load(currentUserId: string, current: number): Promise<void> {
    try {
      const response = await client.request<AdminBuildingModerationResponse>(
        `/api/admin/users/${encodeURIComponent(currentUserId)}/building`,
      );
      if (current !== generation) return;
      moderation = response;
      renderModeration();
    } catch (error) {
      if (current === generation) setStatus(error instanceof Error ? error.message : 'Could not load building controls.');
    }
  }

  async function toggleSuspension(): Promise<void> {
    if (!userId || !moderation || busy) return;
    const target = userId;
    const current = generation;
    const suspended = !moderation.suspendedAt;
    const reason = reasonInput?.value.trim() ?? '';
    if (suspended && !reason) { setStatus('Write a reason before suspending.'); return; }
    if (suspended && !window.confirm('Suspend this account? It will not be able to save, publish or post, and its bot tokens are revoked.')) return;
    busy = true; syncButtons();
    try {
      const response = await client.request<AdminBuildingModerationResponse>(
        `/api/admin/users/${encodeURIComponent(target)}/suspension`,
        { method: 'POST', body: JSON.stringify({ suspended, reason, operatorLabel: getOperatorLabel() }) },
      );
      if (current === generation) { moderation = response; renderModeration(); }
    } catch (error) {
      if (current === generation) setStatus(error instanceof Error ? error.message : 'Could not change the suspension.');
    } finally {
      busy = false; syncButtons();
    }
  }

  async function revertEdits(execute: boolean): Promise<void> {
    if (!userId || busy) return;
    const current = generation;
    const plan = execute ? previewed : sinceInput?.value ? { userId, since: new Date(sinceInput.value).toISOString(), pending: 0 } : null;
    if (!plan || plan.userId !== userId) { setStatus('Choose the time to undo edits from, then preview.'); return; }
    if (execute && !window.confirm(`Restore ${plan.pending} room(s) to their version from before this user?`)) return;
    const body = { since: plan.since, execute, reason: reasonInput?.value.trim() ?? '', operatorLabel: getOperatorLabel() };
    const path = `/api/admin/users/${encodeURIComponent(plan.userId)}/revert-edits`;
    busy = true; syncButtons();
    try {
      setStatus(execute ? 'Restoring rooms…' : 'Checking rooms…');
      let response = await client.request<AdminRevertEditsResponse>(path, { method: 'POST', body: JSON.stringify(body) });
      const reverted = [...response.reverted];
      // The server restores up to 25 rooms per request; keep going while each pass makes progress.
      while (execute && current === generation && response.remaining > 0 && response.reverted.length > 0) {
        response = await client.request<AdminRevertEditsResponse>(path, { method: 'POST', body: JSON.stringify(body) });
        reverted.push(...response.reverted);
      }
      if (current !== generation) return;
      renderRooms(response, reverted);
      const pending = response.rooms.filter((room) => room.action === 'revert').length;
      previewed = execute ? null : { ...plan, pending };
      setStatus(execute
        ? `Restored ${reverted.length} room(s); ${response.failed.length} failed.`
        : `${pending} room(s) to restore, ${response.rooms.length - pending} skipped${response.truncated ? ' (first 500 rooms only; run again after restoring)' : ''}.`);
    } catch (error) {
      if (current === generation) setStatus(error instanceof Error ? error.message : 'Could not check room edits.');
    } finally {
      busy = false; syncButtons();
    }
  }

  suspendButton?.addEventListener('click', () => { void toggleSuspension(); });
  previewButton?.addEventListener('click', () => { void revertEdits(false); });
  revertButton?.addEventListener('click', () => { void revertEdits(true); });
  sinceInput?.addEventListener('input', () => { previewed = null; syncButtons(); });

  return {
    show(nextUserId: string | null): void {
      if (nextUserId === userId) return;
      userId = nextUserId;
      moderation = null;
      previewed = null;
      generation += 1;
      list?.replaceChildren();
      if (card) card.hidden = userId === null;
      syncButtons();
      if (userId) void load(userId, generation);
    },
  };
}
