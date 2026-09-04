import type Phaser from 'phaser';
import {
  createDefaultRoomSnapshot,
  DEFAULT_ROOM_COORDINATES,
  DEFAULT_ROOM_ID,
} from '../../persistence/roomModel';
import type {
  MyWorldsResponse,
  WorldDetail,
  WorldEntitlementSummary,
  WorldMembership,
  WorldPublicationRequest,
  WorldSummary,
} from '../../worlds/model';
import { setActiveWorldContext } from '../../worlds/clientContext';
import { parseWorldSharePath } from '../../worlds/geometry';
import { beginWorldSeedEditor } from '../../worlds/seedEditorAdapter';
import { getActiveOverworldScene } from '../setup/sceneBridge';
import { WorldsApiError, WorldsRepository } from './repository';
import { WorldsView } from './view';

export class WorldsController {
  private readonly repository = new WorldsRepository();
  private view: WorldsView | null = null;
  private directory: WorldSummary[] = [];
  private myWorlds: MyWorldsResponse | null = null;

  constructor(private readonly game: Phaser.Game) {}

  init(): void {
    const button = document.getElementById('btn-world-worlds') as HTMLButtonElement | null;
    const root = document.getElementById('worlds-modal-root');
    if (!button || !root) return;
    this.view = new WorldsView(root, () => this.close());
    button.addEventListener('click', () => void this.open('browse'));
    root.querySelectorAll<HTMLElement>('[data-world-tab]').forEach((tab) => {
      tab.addEventListener('click', () => void this.open(tab.dataset.worldTab === 'mine' ? 'mine' : 'browse'));
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') this.close();
    });
    void this.probe(button);
  }

  close(): void {
    this.view?.close();
  }

  private async probe(button: HTMLButtonElement): Promise<void> {
    try {
      this.directory = (await this.repository.list()).worlds;
      button.classList.remove('hidden');
      const target = new URLSearchParams(window.location.search).get('worlds');
      if (target === 'manage') {
        const worldNumber = parseWorldSharePath(window.location.pathname);
        if (worldNumber !== null) {
          this.view?.open();
          await this.renderManage(await this.repository.byNumber(worldNumber));
          return;
        }
      }
      if (target) await this.open(target === 'mine' ? 'mine' : 'browse');
    } catch {
      button.classList.add('hidden');
    }
  }

  private async open(tab: 'browse' | 'mine'): Promise<void> {
    if (!this.view) return;
    this.view.open();
    this.view.setTitle(tab === 'mine' ? 'My Worlds' : 'Worlds');
    this.view.showLoading();
    try {
      if (tab === 'browse') await this.renderBrowse();
      else await this.renderMine();
      this.view.setStatus('');
    } catch (error) {
      this.showError(error);
    }
  }

  private async renderBrowse(): Promise<void> {
    if (!this.view) return;
    this.directory = (await this.repository.list()).worlds;
    const list = element('div', 'worlds-list');
    for (const world of this.directory) {
      const card = this.worldCard(world);
      const actions = element('div', 'worlds-actions');
      actions.append(this.actionButton('Warp', () => void this.warp(world)));
      if (world.number > 0 && world.viewerMembershipStatus === 'invited') {
        actions.append(this.actionButton('Accept invitation', () => void this.acceptInvitation(world)));
      } else if (
        world.number > 0 &&
        world.buildPolicy === 'request_to_join' &&
        !world.viewerRole &&
        !world.viewerMembershipStatus &&
        !world.frozen
      ) {
        actions.append(this.actionButton('Request builder access', () => void this.requestAccess(world)));
      }
      card.append(actions);
      list.append(card);
    }
    this.view.content.replaceChildren(list);
  }

  private async renderMine(): Promise<void> {
    if (!this.view) return;
    try {
      this.myWorlds = await this.repository.mine();
    } catch (error) {
      if (error instanceof WorldsApiError && error.status === 401) {
        this.view.content.replaceChildren(this.emptyCard('Sign in to see World grants, invitations, and communities you build in.'));
        return;
      }
      throw error;
    }
    const content = document.createDocumentFragment();
    const unactivated = this.myWorlds.entitlements.filter((grant) => !grant.worldId);
    if (unactivated.length > 0) {
      content.append(sectionHeading('Seed-room grants'));
      const grants = element('div', 'worlds-list');
      unactivated.forEach((grant) => grants.append(this.grantCard(grant)));
      content.append(grants);
    }
    content.append(sectionHeading('Your communities'));
    const worlds = element('div', 'worlds-list');
    if (this.myWorlds.worlds.length === 0) {
      worlds.append(this.emptyCard('No active memberships yet. Browse Worlds to find a community.'));
    } else {
      for (const world of this.myWorlds.worlds) {
        const card = this.worldCard(world);
        const actions = element('div', 'worlds-actions');
        actions.append(this.actionButton('Warp', () => void this.warp(world)));
        if (world.viewerMembershipStatus === 'invited') {
          actions.append(this.actionButton('Accept invitation', () => void this.acceptInvitation(world)));
        } else if (world.viewerMembershipStatus === 'requested') {
          actions.append(element('span', 'worlds-pill', 'Request pending'));
        } else {
          actions.append(this.actionButton('Open details', () => void this.renderManage(world)));
        }
        card.append(actions);
        worlds.append(card);
      }
    }
    content.append(worlds);
    this.view.content.replaceChildren(content);
  }

  private async renderManage(world: WorldDetail): Promise<void> {
    if (!this.view) return;
    this.view.setTitle(`WAMP ${world.number}${world.displayName ? `: ${world.displayName}` : ''}`);
    this.view.showLoading('Loading community controls…');
    const [members, publications] = await Promise.all([
      world.canManageMembers ? this.repository.members(world.id).then((result) => result.members) : Promise.resolve([]),
      world.canReviewPublications ? this.repository.publications(world.id).then((result) => result.requests) : Promise.resolve([]),
    ]);
    const content = document.createDocumentFragment();
    const top = this.worldCard(world);
    const topActions = element('div', 'worlds-actions');
    topActions.append(this.actionButton('Warp', () => void this.warp(world)));
    topActions.append(this.actionButton('Back to My Worlds', () => void this.open('mine')));
    top.append(topActions);
    content.append(top);
    if (world.canManageMembers) content.append(this.membersSection(world, members));
    if (world.canReviewPublications) content.append(this.publicationsSection(world, publications));
    if (world.canManageSettings) content.append(this.settingsSection(world));
    if (world.canRequestName) content.append(this.nameSection(world));
    this.view.content.replaceChildren(content);
    this.view.setStatus(world.frozen ? 'This World is frozen and completely play-only.' : '');
  }

  private worldCard(world: WorldSummary): HTMLElement {
    const card = element('article', `worlds-card${world.frozen ? ' worlds-card-frozen' : ''}`);
    card.append(element('h3', '', `WAMP ${world.number}${world.displayName ? `: ${world.displayName}` : ''}`));
    const owner = world.ownerDisplayName ?? (world.number === 0 ? 'WAMP' : 'Unknown owner');
    card.append(element(
      'div',
      'worlds-meta',
      `Owner: ${owner} · Seed: ${world.origin.x},${world.origin.y} · ${world.roomCount} room${world.roomCount === 1 ? '' : 's'}`,
    ));
    card.append(element(
      'div',
      'worlds-meta',
      `${world.buildPolicy === 'request_to_join' ? 'Anyone can request' : 'Invite only'} · ${world.publishPolicy === 'approval_required' ? 'Approval required' : 'Members publish'}`,
    ));
    if (world.frozen) card.append(element('span', 'worlds-pill', 'Play-only'));
    return card;
  }

  private grantCard(grant: WorldEntitlementSummary): HTMLElement {
    const card = element('article', `worlds-card${grant.status === 'frozen' ? ' worlds-card-frozen' : ''}`);
    card.append(element('h3', '', grant.seedDraft ? 'Resume your seed room' : 'Start your seed room'));
    card.append(element('div', 'worlds-meta', `${grant.ownerEmail} · Number assigned on first publication`));
    if (grant.seedUpdatedAt) card.append(element('div', 'worlds-meta', `Last saved ${new Date(grant.seedUpdatedAt).toLocaleString()}`));
    const actions = element('div', 'worlds-actions');
    const build = this.actionButton(grant.seedDraft ? 'Resume building' : 'Build seed room', () => this.openSeedEditor(grant));
    build.toggleAttribute('disabled', grant.status === 'frozen');
    actions.append(build);
    card.append(actions);
    return card;
  }

  private membersSection(world: WorldDetail, members: WorldMembership[]): HTMLElement {
    const section = element('section', 'worlds-card');
    section.append(sectionHeading('Members'));
    const form = element('form', 'worlds-form-row');
    const email = document.createElement('input');
    email.type = 'email'; email.placeholder = 'builder@example.com'; email.required = true;
    const submit = this.actionButton('Invite builder', () => undefined);
    submit.type = 'submit';
    form.append(email, submit);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      void this.runAndRefresh(() => this.repository.invite(world.id, email.value), world, 'Invitation sent.');
    });
    section.append(form);
    const list = element('div', 'worlds-list');
    members.forEach((member) => list.append(this.memberCard(world, member)));
    section.append(list);
    return section;
  }

  private memberCard(world: WorldDetail, member: WorldMembership): HTMLElement {
    const card = element('div', 'worlds-card');
    card.append(element('strong', '', member.displayName || member.email));
    card.append(element('span', 'worlds-meta', `${member.email} · ${member.role} · ${member.status}`));
    if (member.role === 'owner') return card;
    const actions = element('div', 'worlds-actions');
    if (member.status === 'requested') actions.append(this.memberAction(world, member, 'approve', 'Approve'));
    if (member.status === 'active' && member.role === 'builder' && world.viewerRole === 'owner') {
      actions.append(this.memberAction(world, member, 'promote', 'Make manager'));
    }
    if (member.status === 'active' && member.role === 'manager' && world.viewerRole === 'owner') {
      actions.append(this.memberAction(world, member, 'demote', 'Make builder'));
    }
    if (member.status !== 'blocked') actions.append(this.memberAction(world, member, 'remove', 'Remove'));
    actions.append(this.memberAction(world, member, 'block', 'Block'));
    card.append(actions);
    return card;
  }

  private memberAction(world: WorldDetail, member: WorldMembership, action: string, label: string): HTMLButtonElement {
    return this.actionButton(label, () => void this.runAndRefresh(
      () => this.repository.changeMember(world.id, member.id, action),
      world,
      `Member ${action} complete.`,
    ));
  }

  private publicationsSection(world: WorldDetail, requests: WorldPublicationRequest[]): HTMLElement {
    const section = element('section', 'worlds-card');
    section.append(sectionHeading('Publication queue'));
    const pending = requests.filter((request) => request.status === 'pending');
    if (pending.length === 0) {
      section.append(element('div', 'worlds-meta', 'No drafts are waiting for review.'));
      return section;
    }
    const list = element('div', 'worlds-list');
    pending.forEach((request) => {
      const card = element('div', 'worlds-card');
      card.append(element('strong', '', request.roomTitle || `Room ${request.roomCoordinates.x},${request.roomCoordinates.y}`));
      card.append(element('span', 'worlds-meta', `By ${request.submittedByDisplayName || 'Builder'} · submitted ${new Date(request.submittedAt).toLocaleString()}`));
      const actions = element('div', 'worlds-actions');
      actions.append(this.actionButton('Preview', () => void this.warp({ ...world, origin: request.roomCoordinates })));
      actions.append(this.actionButton('Approve', () => void this.runAndRefresh(
        () => this.repository.resolvePublication(world.id, request.id, 'approve'), world, 'Draft published.',
      )));
      actions.append(this.actionButton('Reject', () => void this.runAndRefresh(
        () => this.repository.resolvePublication(world.id, request.id, 'reject'), world, 'Draft rejected.',
      )));
      card.append(actions); list.append(card);
    });
    section.append(list);
    return section;
  }

  private settingsSection(world: WorldDetail): HTMLElement {
    const section = element('section', 'worlds-card');
    section.append(sectionHeading('Settings'));
    const form = element('form', 'worlds-form worlds-grid');
    const build = selectField('Who can join', [
      ['request_to_join', 'Anyone can request'], ['invite_only', 'Invite only'],
    ], world.settings.buildPolicy);
    const publish = selectField('Who can publish', [
      ['approval_required', 'Approval required'], ['members_publish', 'Members publish'],
    ], world.settings.publishPolicy);
    const claims = numberField('Claims per builder / UTC day', world.settings.claimLimitPerDay, world.claimLimitCeiling);
    const publications = numberField('Publications per builder / UTC day', world.settings.publishLimitPerDay, world.publishLimitCeiling);
    form.append(build.label, publish.label, claims.label, publications.label);
    const save = this.actionButton('Save settings', () => undefined); save.type = 'submit'; form.append(save);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      void this.runAndRefresh(() => this.repository.updateSettings(world.id, {
        buildPolicy: build.select.value as WorldDetail['buildPolicy'],
        publishPolicy: publish.select.value as WorldDetail['publishPolicy'],
        claimLimitPerDay: Number(claims.input.value),
        publishLimitPerDay: Number(publications.input.value),
      }), world, 'Settings saved.');
    });
    section.append(form);
    return section;
  }

  private nameSection(world: WorldDetail): HTMLElement {
    const section = element('section', 'worlds-card');
    section.append(sectionHeading('Public name'));
    section.append(element('div', 'worlds-meta', 'Names and renames stay pending until a WAMP admin approves them.'));
    const form = element('form', 'worlds-form-row');
    const input = document.createElement('input'); input.required = true; input.maxLength = 48; input.placeholder = 'Optional World name';
    const submit = this.actionButton('Request name', () => undefined); submit.type = 'submit';
    form.append(input, submit);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      void this.runAndRefresh(() => this.repository.requestName(world.id, input.value), world, 'Name sent for admin review.');
    });
    section.append(form);
    return section;
  }

  private async runAndRefresh(operation: () => Promise<unknown>, world: WorldDetail, message: string): Promise<void> {
    this.view?.setStatus('Saving…');
    try {
      await operation();
      const refreshed = await this.repository.byNumber(world.number);
      await this.renderManage(refreshed);
      this.view?.setStatus(message);
    } catch (error) {
      this.showError(error);
    }
  }

  private openSeedEditor(grant: WorldEntitlementSummary): void {
    const scene = getActiveOverworldScene(this.game);
    if (!scene?.openGuestDraftRoom) {
      this.view?.setStatus('Return to the World map before opening the seed editor.', true);
      return;
    }
    const source = grant.seedDraft ?? createDefaultRoomSnapshot(DEFAULT_ROOM_ID, DEFAULT_ROOM_COORDINATES);
    const snapshot = beginWorldSeedEditor(grant.id, source);
    document.body.dataset.worldSeedEditor = 'true';
    this.close();
    scene.openGuestDraftRoom(snapshot);
  }

  private async warp(
    world: Pick<WorldSummary, 'id' | 'number' | 'origin' | 'sharePath'> &
      Partial<Pick<WorldSummary, 'viewerRole' | 'viewerMembershipStatus'>>,
  ): Promise<void> {
    const scene = getActiveOverworldScene(this.game);
    if (!scene?.jumpToCoordinates) {
      this.view?.setStatus('Return to the World map before warping.', true);
      return;
    }
    setActiveWorldContext(world.number === 0 ? null : {
      worldId: world.id,
      viewerRole: world.viewerRole ?? null,
      membershipStatus: world.viewerMembershipStatus ?? null,
    });
    void this.repository.recordWarp(world.id).catch(() => undefined);
    await scene.jumpToCoordinates(world.origin);
    const url = new URL(window.location.href);
    url.pathname = world.sharePath;
    url.searchParams.delete('worlds');
    window.history.replaceState({}, '', url);
    this.close();
  }

  private async acceptInvitation(world: WorldSummary): Promise<void> {
    try {
      await this.repository.acceptInvitation(world.id);
      await this.open('mine');
      this.view?.setStatus('Invitation accepted.');
    } catch (error) { this.showError(error); }
  }

  private async requestAccess(world: WorldSummary): Promise<void> {
    try {
      await this.repository.requestMembership(world.id);
      await this.renderBrowse();
      this.view?.setStatus('Builder request sent.');
    } catch (error) { this.showError(error); }
  }

  private actionButton(label: string, action: () => void): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'bar-btn bar-btn-small'; button.textContent = label;
    button.addEventListener('click', action);
    return button;
  }

  private emptyCard(message: string): HTMLElement {
    return element('div', 'worlds-card worlds-meta', message);
  }

  private showError(error: unknown): void {
    this.view?.setStatus(error instanceof Error ? error.message : 'Worlds could not be loaded.', true);
  }
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function sectionHeading(label: string): HTMLElement {
  const header = element('div', 'worlds-section-header');
  header.append(element('h3', '', label));
  return header;
}

function selectField(
  labelText: string,
  values: Array<[string, string]>,
  selected: string,
): { label: HTMLLabelElement; select: HTMLSelectElement } {
  const label = element('label'); label.append(labelText);
  const select = document.createElement('select');
  values.forEach(([value, text]) => {
    const option = document.createElement('option'); option.value = value; option.textContent = text; option.selected = value === selected;
    select.append(option);
  });
  label.append(select);
  return { label, select };
}

function numberField(labelText: string, value: number, max: number): { label: HTMLLabelElement; input: HTMLInputElement } {
  const label = element('label'); label.append(`${labelText} (max ${max})`);
  const input = document.createElement('input'); input.type = 'number'; input.min = '1'; input.max = String(max); input.value = String(value);
  label.append(input);
  return { label, input };
}
