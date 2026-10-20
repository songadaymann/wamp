import { createAdminApiClient, type AdminApiClient } from '../adminApiClient';
import { asyncListener } from '../../ui/asyncListener';
import type { CaptureResult } from '../../mapScreenshot/capture';

export function setupMapCaptureAdmin(getAdminKey: () => string, doc: Document = document, client: AdminApiClient = createAdminApiClient(getAdminKey)) {
  const button = doc.getElementById('map-capture-button') as HTMLButtonElement | null;
  const status = doc.getElementById('map-capture-status');
  const resultLink = doc.getElementById('map-capture-result') as HTMLAnchorElement | null;
  let key = getAdminKey(), generation = 0, busy = false, request: AbortController | null = null;
  const render = () => { if (button) button.disabled = !key || busy; };
  const refresh = () => {
    const next = getAdminKey();
    if (next !== key) {
      generation++; request?.abort(); request = null; busy = false; key = next;
      if (resultLink) { resultLink.hidden = true; resultLink.removeAttribute('href'); }
    }
    if (!busy && status) status.textContent = key ? 'Nine manual attempts per day. Failed attempts count.' : 'Use your admin key to capture the map.';
    render();
  };
  const capture = asyncListener(async () => {
    if (!key || busy) return;
    const current = ++generation, owner = key, controller = new AbortController(); request = controller;
    busy = true; render(); if (status) status.textContent = 'Capturing…'; if (resultLink) resultLink.hidden = true;
    try {
      const result = await client.request<CaptureResult>('/api/admin/map-screenshot/capture', { method: 'POST', body: '{}', signal: controller.signal });
      if (current !== generation || getAdminKey() !== owner) return;
      if (!result.ok || !result.fileName || !/^\d{4}_\d{2}_\d{2}_[0-9]\.png$/.test(result.fileName)) throw new Error(result.reason || 'Capture did not finish.');
      if (status) status.textContent = `Saved ${result.fileName}.`;
      if (resultLink) { resultLink.href = `/capture/files/${encodeURIComponent(result.fileName)}`; resultLink.hidden = false; }
    } catch (error) {
      if (current === generation && getAdminKey() === owner && status) status.textContent = error instanceof Error ? error.message : 'Capture failed.';
    } finally {
      if (current === generation) { busy = false; request = null; render(); }
    }
  });
  button?.addEventListener('click', capture); refresh();
  return { refresh, destroy() { generation++; request?.abort(); button?.removeEventListener('click', capture); } };
}
