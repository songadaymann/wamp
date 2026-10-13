type EmptyStateActions = {
  canEdit: () => boolean;
  canCreatePlaylist: () => boolean;
  findBuildSpot: () => void;
};

export function setupProfileEmptyStates(doc: Document, actions: EmptyStateActions): void {
  doc.getElementById('btn-profile-empty-build')?.addEventListener('click', () => {
    if (actions.canEdit()) actions.findBuildSpot();
  });
  doc.getElementById('btn-profile-empty-playlist')?.addEventListener('click', () => {
    if (!actions.canCreatePlaylist()) return;
    const input = doc.getElementById('profile-playlist-title-input');
    input?.scrollIntoView({ block: 'nearest' });
    input?.focus();
  });
}

export function renderProfileEmptyActions(doc: Document, canEdit: boolean, canCreatePlaylist: boolean): void {
  for (const id of ['btn-profile-empty-build', 'btn-profile-empty-playlist']) {
    doc.getElementById(id)?.classList.toggle('hidden', !(id.endsWith('playlist') ? canCreatePlaylist : canEdit));
  }
}
