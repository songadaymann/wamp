import { createAdminApiClient } from '../adminApiClient';
import type { WeeklyRoomRushAdminResponse } from '../../runs/weeklyRoomRush';

export function setupWeeklyRoomRushAdmin(getAdminKey: () => string, doc: Document = document) {
  const client = createAdminApiClient(getAdminKey);
  const status = doc.getElementById('weekly-rush-admin-status');
  const form = doc.getElementById('weekly-rush-admin-form');
  const week = doc.getElementById('weekly-rush-admin-week') as HTMLSelectElement | null;
  const input = doc.getElementById('weekly-rush-admin-coordinates') as HTMLInputElement | null;
  const save = doc.getElementById('weekly-rush-admin-save') as HTMLButtonElement | null;
  const remove = doc.getElementById('weekly-rush-admin-delete') as HTMLButtonElement | null;
  let generation = 0, busy = false, snapshot: WeeklyRoomRushAdminResponse | null = null;
  const setDisabled = (disabled: boolean) => { for (const element of [week, input, save, remove]) if (element) element.disabled = disabled; };
  const renderWeek = () => {
    const selected = snapshot?.weeks.find(entry => entry.startsAt.slice(0, 10) === week?.value);
    if (!selected || !getAdminKey()) { setDisabled(true); return; }
    const pick = selected.pick;
    if (status) status.textContent = `${week?.value}: ${pick ? `${pick.title} · ${pick.roomId} · v${pick.roomVersion}` : 'no room chosen'}${selected.lockedAt ? ' · locked after ranked play started.' : '.'}${pick?.unavailableReason ? ` ${pick.unavailableReason}` : ''}`;
    if (input) input.value = pick?.roomId ?? '';
    setDisabled(busy);
    if (input) input.disabled = busy || Boolean(selected.lockedAt);
    if (save) save.disabled = busy || Boolean(selected.lockedAt);
    if (remove) remove.disabled = busy || Boolean(selected.lockedAt) || !pick;
  };
  const render = (response: WeeklyRoomRushAdminResponse) => {
    snapshot = response;
    if (week) {
      const previous = week.value;
      week.replaceChildren(...response.weeks.map(entry => {
        const option = doc.createElement('option'); option.value = entry.startsAt.slice(0, 10);
        option.textContent = `${option.value}${entry.lockedAt ? ' · locked' : entry.pick ? ' · chosen' : ' · not chosen'}`;
        return option;
      }));
      if (response.weeks.some(entry => entry.startsAt.slice(0, 10) === previous)) week.value = previous;
    }
    renderWeek();
  };
  const refresh = async () => {
    const current = ++generation; setDisabled(true);
    if (!getAdminKey()) { snapshot = null; if (status) status.textContent = 'Use your admin key to choose a weekly Rush room.'; return; }
    try { const response = await client.request<WeeklyRoomRushAdminResponse>('/api/admin/room-rush/weekly'); if (current === generation) render(response); }
    catch (error) { if (current === generation && status) status.textContent = error instanceof Error ? error.message : 'Weekly Rush could not load.'; }
  };
  const mutate = async (method: 'PUT' | 'DELETE') => {
    if (busy || !getAdminKey() || !week || !input) return;
    const match = /^\s*(-?\d{1,6})\s*,\s*(-?\d{1,6})\s*$/.exec(input.value);
    if (method === 'PUT' && !match) { if (status) status.textContent = 'Enter room coordinates as x,y.'; return; }
    busy = true; setDisabled(true); const current = ++generation;
    try {
      const path = `/api/admin/room-rush/weekly${method === 'DELETE' ? `?openingMonday=${week.value}` : ''}`;
      const response = await client.request<WeeklyRoomRushAdminResponse>(path, { method,
        ...(method === 'PUT' ? { body: JSON.stringify({ openingMonday: week.value, roomId: `${Number(match![1])},${Number(match![2])}` }) } : {}),
      });
      if (current === generation) { busy = false; render(response); }
    } catch (error) {
      if (current === generation && status) { busy = false; renderWeek(); status.textContent = error instanceof Error ? error.message : 'Room choice was not saved.'; }
    } finally { busy = false; }
  };
  week?.addEventListener('change', renderWeek);
  form?.addEventListener('submit', event => { event.preventDefault(); void mutate('PUT'); });
  remove?.addEventListener('click', () => { void mutate('DELETE'); });
  void refresh();
  return { refresh };
}
