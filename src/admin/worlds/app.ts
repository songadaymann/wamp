import { createAdminApiClient } from '../adminApiClient';
import type { WorldAdminState, WorldEntitlementSummary, WorldNameRequest, WorldSummary } from '../../worlds/model';
import { initWorldGrowthSimulator } from './growthSimulatorView';

const ADMIN_KEY_STORAGE = 'ep_launch_admin_api_key';
const keyInput = required<HTMLInputElement>('worlds-admin-key');
const status = required<HTMLElement>('worlds-admin-status');
const content = required<HTMLElement>('worlds-admin-content');
const grantForm = required<HTMLFormElement>('worlds-grant-form');
const emailInput = required<HTMLInputElement>('worlds-grant-email');
const client = createAdminApiClient(() => keyInput.value.trim());

initWorldGrowthSimulator();

keyInput.value = sessionStorage.getItem(ADMIN_KEY_STORAGE) ?? '';
required<HTMLButtonElement>('worlds-admin-load').addEventListener('click', () => void load());
required<HTMLButtonElement>('worlds-admin-clear').addEventListener('click', () => {
  sessionStorage.removeItem(ADMIN_KEY_STORAGE);
  keyInput.value = '';
  content.replaceChildren();
  setStatus('Admin key cleared.');
});
grantForm.addEventListener('submit', (event) => {
  event.preventDefault();
  void mutate(async () => {
    await client.request('/api/admin/worlds/grants', {
      method: 'POST',
      body: JSON.stringify({ email: emailInput.value, idempotencyKey: crypto.randomUUID() }),
    });
    emailInput.value = '';
  }, 'Complimentary grant created and onboarding email attempted.');
});

if (keyInput.value) void load();

async function load(): Promise<void> {
  const key = keyInput.value.trim();
  if (!key) {
    setStatus('Enter the admin key.', true);
    return;
  }
  sessionStorage.setItem(ADMIN_KEY_STORAGE, key);
  setStatus('Loading Worlds pilot…');
  try {
    const state = await client.request<WorldAdminState>('/api/admin/worlds');
    render(state);
    setStatus(`Loaded ${state.worlds.length - 1} numbered World${state.worlds.length === 2 ? '' : 's'}.`);
  } catch (error) {
    setStatus(error instanceof Error ? error.message : 'Worlds admin failed to load.', true);
  }
}

function render(state: WorldAdminState): void {
  content.replaceChildren(
    section('World directory', state.worlds.map(renderWorld), 'No Worlds have been seeded.'),
    section('Entitlements', state.entitlements.map(renderEntitlement), 'No complimentary grants yet.'),
    section('Pending names', state.pendingNames.map(renderNameRequest), 'No names need review.'),
    section('Recent pilot activity', state.recentActivity.map((event) => {
      const row = card(event.eventType.replace(/_/g, ' '));
      row.append(meta(`${new Date(event.occurredAt).toLocaleString()} · ${event.worldId ?? event.entitlementId ?? 'system'}`));
      return row;
    }), 'No pilot activity yet.'),
  );
}

function renderWorld(world: WorldSummary): HTMLElement {
  const row = card(`WAMP ${world.number}${world.displayName ? `: ${world.displayName}` : ''}`);
  row.append(meta(
    `${world.ownerDisplayName ?? 'WAMP'} · ${world.origin.x},${world.origin.y} · ${world.roomCount} rooms · ${world.frozen ? 'FROZEN' : 'active'}`,
  ));
  const link = document.createElement('a'); link.href = world.sharePath; link.textContent = 'Open World';
  row.append(link);
  return row;
}

function renderEntitlement(entitlement: WorldEntitlementSummary): HTMLElement {
  const row = card(entitlement.worldNumber === null ? 'Unseeded grant' : `WAMP ${entitlement.worldNumber}`);
  row.append(meta(`${entitlement.ownerEmail} · ${entitlement.source} · ${entitlement.status}`));
  const actions = element('div', 'admin-actions');
  const nextStatus = entitlement.status === 'active' ? 'frozen' : 'active';
  actions.append(action(nextStatus === 'frozen' ? 'Freeze' : 'Reactivate', () => void mutate(
    () => client.request(`/api/admin/worlds/entitlements/${encodeURIComponent(entitlement.id)}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status: nextStatus, idempotencyKey: crypto.randomUUID() }),
    }),
    nextStatus === 'frozen' ? 'World frozen play-only.' : 'World reactivated.',
  )));
  actions.append(action('Resend email', () => void mutate(
    () => client.request(`/api/admin/worlds/entitlements/${encodeURIComponent(entitlement.id)}/resend`, { method: 'POST' }),
    'Onboarding email attempted.',
  )));
  row.append(actions);
  return row;
}

function renderNameRequest(request: WorldNameRequest): HTMLElement {
  const row = card(`WAMP ${request.worldNumber}: “${request.proposedName}”`);
  row.append(meta(`Current name: ${request.currentName ?? 'none'} · requested ${new Date(request.requestedAt).toLocaleString()}`));
  const actions = element('div', 'admin-actions');
  for (const decision of ['approve', 'reject'] as const) {
    actions.append(action(decision === 'approve' ? 'Approve' : 'Reject', () => void mutate(
      () => client.request(`/api/admin/worlds/name-requests/${encodeURIComponent(request.id)}`, {
        method: 'PATCH', body: JSON.stringify({ decision }),
      }),
      `Name ${decision === 'approve' ? 'approved' : 'rejected'}.`,
    )));
  }
  row.append(actions);
  return row;
}

async function mutate(operation: () => Promise<unknown>, success: string): Promise<void> {
  setStatus('Saving…');
  try {
    await operation();
    await load();
    setStatus(success);
  } catch (error) {
    setStatus(error instanceof Error ? error.message : 'Worlds admin action failed.', true);
  }
}

function section(title: string, rows: HTMLElement[], empty: string): HTMLElement {
  const container = element('section', 'admin-section');
  container.append(element('h2', '', title));
  const list = element('div', 'admin-list');
  if (rows.length === 0) list.append(meta(empty));
  else list.append(...rows);
  container.append(list);
  return container;
}

function card(title: string): HTMLElement {
  const row = element('article', 'admin-card');
  row.append(element('h3', '', title));
  return row;
}

function meta(text: string): HTMLElement { return element('div', 'admin-meta', text); }

function action(label: string, handler: () => void): HTMLButtonElement {
  const button = element('button', '', label);
  button.type = 'button'; button.addEventListener('click', handler);
  return button;
}

function setStatus(message: string, danger = false): void {
  status.textContent = message;
  status.classList.toggle('danger', danger);
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function required<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing #${id}.`);
  return node as T;
}
