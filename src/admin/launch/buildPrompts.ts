import { createAdminApiClient } from '../adminApiClient';
import type { BuildPrompt } from '../../buildPrompts/model';
export function setupBuildPromptsAdmin(getAdminKey: () => string, doc: Document = document) {
  const client = createAdminApiClient(getAdminKey);
  const form = doc.getElementById('build-prompt-admin-form'), status = doc.getElementById('build-prompt-admin-status');
  const select = doc.getElementById('build-prompt-admin-select') as HTMLSelectElement | null;
  const fields = ['slug', 'title', 'constraint', 'week'].map(name => doc.getElementById(`build-prompt-admin-${name}`) as HTMLInputElement | null);
  const save = doc.getElementById('build-prompt-admin-save') as HTMLButtonElement | null, remove = doc.getElementById('build-prompt-admin-delete') as HTMLButtonElement | null;
  let prompts: BuildPrompt[] = [], generation = 0, busy = false;
  const message = (text: string) => { if (status) status.textContent = text; };
  const chosen = () => prompts.find(prompt => prompt.slug === select?.value);
  const fill = () => {
    const prompt = chosen(), locked = !!prompt && (!!prompt.settledAt || prompt.entryCount > 0 || prompt.endsAt <= new Date().toISOString());
    fields.forEach((field, index) => { if (field) { field.value = prompt ? [prompt.slug, prompt.title, prompt.constraint, prompt.startsAt.slice(0, 10)][index] : ''; field.disabled = locked || !getAdminKey(); } });
    if (fields[0]) fields[0].disabled = !!prompt || !getAdminKey();
    if (save) save.disabled = locked || busy || !getAdminKey();
    if (remove) remove.disabled = !prompt || locked || busy || !getAdminKey();
    message(prompt ? `${prompt.entryCount} entries · ${prompt.startsAt.slice(0,10)} to ${prompt.endsAt.slice(0,10)} UTC${locked ? ' · Locked' : ' · Editable until the first entry'}` : getAdminKey() ? 'No new prompt is active until you save a theme for an open or future week.' : 'Use your admin key to manage Build Prompts.');
  };
  const render = (preferredValue?: string) => {
    const value = preferredValue ?? select?.value ?? ''; select?.replaceChildren();
    const empty = doc.createElement('option'); empty.value = ''; empty.textContent = 'Create a prompt'; select?.append(empty);
    for (const prompt of prompts) { const option = doc.createElement('option'); option.value = prompt.slug; option.textContent = `${prompt.startsAt.slice(0,10)} · ${prompt.title}`; select?.append(option); }
    if (select) { select.value = prompts.some(prompt => prompt.slug === value) ? value : ''; select.disabled = !getAdminKey() || busy; } fill();
  };
  const refresh = async () => {
    const current = ++generation, key = getAdminKey();
    if (!key) { prompts = []; render(); return; }
    try { const response = await client.request<{ prompts: BuildPrompt[] }>('/api/admin/build-prompts'); if (current === generation && key === getAdminKey()) { prompts = response.prompts; render(); } }
    catch (error) { if (current === generation) message(error instanceof Error ? error.message : 'Build Prompts could not load. Try Refresh All.'); }
  };
  const mutate = async (method: 'PUT' | 'DELETE') => {
    if (busy || !getAdminKey()) return;
    const [slug, title, constraint, week] = fields.map(field => field?.value ?? '');
    const selected = chosen(); if (method === 'DELETE' && !selected) return;
    busy = true; if (select) select.disabled = true; fields.forEach(field => { if (field) field.disabled = true; }); if (save) save.disabled = true; if (remove) remove.disabled = true;
    const current = ++generation, key = getAdminKey();
    try {
      const response = await client.request<{ prompts: BuildPrompt[] }>(`/api/admin/build-prompts${method === 'DELETE' ? `?slug=${encodeURIComponent(selected!.slug)}` : ''}`, {
        method, ...(method === 'PUT' ? { body: JSON.stringify({ slug, title, constraint, startsAt: `${week}T00:00:00.000Z` }) } : {}),
      });
      if (current !== generation || key !== getAdminKey()) return;
      prompts = response.prompts; busy = false; render(method === 'PUT' ? slug : ''); message(method === 'PUT' ? 'Prompt saved. It opens at the scheduled Monday, 00:00 UTC.' : 'Prompt removed.');
    } catch (error) { if (current === generation) message(error instanceof Error ? error.message : 'Prompt was not saved.'); }
    finally { busy = false; if (current === generation) { const text = status?.textContent ?? ''; fill(); if (select) select.disabled = !getAdminKey(); message(text); } }
  };
  form?.addEventListener('submit', event => { event.preventDefault(); void mutate('PUT'); });
  remove?.addEventListener('click', () => { void mutate('DELETE'); }); select?.addEventListener('change', fill);
  void refresh(); return { refresh };
}
