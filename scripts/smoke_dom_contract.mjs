import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const indexPath = resolve(process.cwd(), 'index.html');
const html = readFileSync(indexPath, 'utf8');

const ids = new Set();
const duplicateIds = new Set();
for (const match of html.matchAll(/\bid\s*=\s*["']([^"']+)["']/g)) {
  const id = match[1];
  if (ids.has(id)) {
    duplicateIds.add(id);
  }
  ids.add(id);
}

const requiredIdsByController = {
  'EditorDockShellController': [
    'editor-shell-top',
    'editor-shell-title-slot',
    'editor-shell-status-slot',
    'editor-share-popover',
    'editor-shell-dock',
    'editor-markers-popover',
    'editor-marker-instructions',
    'editor-drawer-header',
    'editor-drawer-title',
  'btn-editor-music-close',
    'editor-drawer-room-tabs',
    'smart-visual-picker',
    'smart-theme-button-grid',
    'smart-brush-button-grid',
    'goal-type-instructions',
  ],
  'PaletteController': [
    'palette-canvas',
    'palette-container',
    'selection-info',
    'tile-preview',
    'object-palette-section',
    'object-grid',
    'object-search-input',
    'custom-object-subcategory-tabs',
    'object-facing-controls',
    'btn-object-facing-left',
    'btn-object-facing-right',
    'object-selection-details',
    'object-selection-name',
    'object-selection-description',
  ],
  'CourseComposerPanelController': [
    'course-editor-shell',
    'course-workbench-title-input',
    'course-workbench-status',
    'course-workbench-selected-room-summary',
    'course-workbench-selected-room-status',
    'course-workbench-selected-room-actions',
    'btn-course-workbench-toggle-room',
    'btn-course-workbench-open-room',
    'btn-course-workbench-center-room',
    'btn-course-workbench-edit-course',
    'course-workbench-cell-limit',
    'course-workbench-room-list',
    'course-workbench-checkpoint-list',
    'course-workbench-summary',
    'course-workbench-published-state',
    'course-workbench-published-warning',
    'btn-course-workbench-test',
    'course-workbench-test-reason',
    'btn-course-workbench-save',
    'course-workbench-save-reason',
    'btn-course-workbench-publish',
    'course-workbench-publish-reason',
    'btn-course-workbench-unpublish',
    'course-workbench-unpublish-reason',
    'course-workbench-zoom-text',
    'btn-course-workbench-zoom-in',
    'btn-course-workbench-zoom-out',
    'btn-course-workbench-fit',
    'btn-course-workbench-back-world',
  ],
  'LeaderboardModalController': [
    'leaderboard-modal',
    'leaderboard-modal-title',
    'leaderboard-modal-meta',
    'leaderboard-modal-error',
    'btn-leaderboard-close',
    'btn-leaderboard-tab-room',
    'btn-leaderboard-tab-course',
    'btn-leaderboard-tab-room-rush',
    'btn-leaderboard-tab-global',
    'leaderboard-room-panel',
    'leaderboard-course-panel',
    'leaderboard-room-rush-panel',
    'leaderboard-global-panel',
    'leaderboard-version-select',
    'leaderboard-room-summary',
    'leaderboard-room-viewer',
    'leaderboard-room-difficulty-summary',
    'leaderboard-room-difficulty-status',
    'leaderboard-room-quality-actions',
    'leaderboard-room-difficulty-actions',
    'leaderboard-room-list',
    'leaderboard-course-summary',
    'leaderboard-course-viewer',
    'leaderboard-course-list',
    'leaderboard-room-rush-modes',
    'leaderboard-room-rush-summary',
    'leaderboard-room-rush-viewer',
    'leaderboard-room-rush-list',
    'leaderboard-global-summary',
    'leaderboard-global-viewer',
    'leaderboard-global-list',
  ],
  'OverworldHudBridge': [
    'world-hud',
    'world-selected-title',
    'world-selected-subtitle',
    'world-selected-creator-card',
    'world-selected-creator-name',
    'world-selected-creator-player-level',
    'world-selected-creator-player-progress',
    'world-selected-creator-curator-level',
    'world-selected-creator-curator-progress',
    'world-selected-creator-builder-level',
    'world-selected-creator-builder-progress',
    'world-selected-coords',
    'world-selected-state-wrap',
    'world-selected-state',
    'world-selected-state-info-wrap',
    'world-selected-state-info-tooltip',
    'world-selected-meta',
    'world-status',
    'world-selected-goal',
    'world-leaderboard',
    'btn-world-play',
    'btn-world-restart',
    'btn-world-play-course',
    'btn-world-room-rush',
    'btn-world-room-comment',
    'btn-world-comment',
    'btn-world-course-builder',
    'btn-world-edit',
    'btn-world-build',
    'world-jump-input',
    'btn-world-jump',
    'btn-world-zoom-in-footer',
    'btn-world-zoom-out-footer',
    'btn-world-explore',
    'btn-world-leaderboard',
    'btn-world-rate-room',
    'btn-world-settings',
    'btn-world-controls',
    'world-zoom-label',
    'room-coords',
    'cursor-coords',
    'world-online-wrap',
    'world-online-count',
    'world-online-popover',
    'world-online-popover-summary',
    'world-online-popover-empty',
    'world-online-popover-list',
    'room-save-status',
    'btn-fit-screen',
    'zoom-level',
    'world-goal-panel',
    'world-goal-panel-room',
    'world-goal-panel-goal',
    'world-goal-panel-timer',
    'world-goal-panel-progress',
    'world-sign-panel',
    'world-sign-panel-label',
    'world-sign-panel-text',
    'mobile-goal-footer',
    'mobile-goal-footer-goal',
    'mobile-goal-footer-progress',
    'mobile-goal-footer-timer',
  ],
  'PerformanceSuggestionModalController': [
    'performance-suggestion-modal',
    'btn-performance-suggestion-accept',
    'btn-performance-suggestion-dismiss',
  ],
  'sceneCommands': [
    'auth-panel',
    'btn-about-open',
    'btn-chat-moderation-open',
    'world-jump-input',
    'btn-course-editor-save-course',
    'btn-course-editor-publish-course',
  ],
};

const staleIds = [
  'btn-leaderboard-tab-discover',
  'leaderboard-discover-panel',
  'leaderboard-discover-filters',
  'leaderboard-discover-sorts',
  'leaderboard-discover-summary',
  'leaderboard-discover-list',
];

const missing = [];
for (const [controller, requiredIds] of Object.entries(requiredIdsByController)) {
  for (const id of requiredIds) {
    if (!ids.has(id)) {
      missing.push(`${controller}: #${id}`);
    }
  }
}

const stalePresent = staleIds.filter((id) => ids.has(id));
const earlyWorldTileMarkerIndex = html.indexOf('<!-- wamp-early-world-tiles-bootstrap -->');
const mainModuleIndex = html.indexOf('<script type="module" src="/src/main/coarseFirstEntry.ts"></script>');
const directMainModuleIndex = html.indexOf('<script type="module" src="/src/main.ts"></script>');
const earlyWorldTileBootstrapContractErrors = [];
const editorDockContractErrors = [];
const dockOrder = [...html.matchAll(/data-editor-dock=["']([^"']+)["']/g)].map((match) => match[1]);
const expectedDockOrder = ['terrain', 'stuff', 'characters', 'hazards', 'deco', 'markers'];
if (dockOrder.join(',') !== expectedDockOrder.join(',')) {
  editorDockContractErrors.push(`dock order must be ${expectedDockOrder.join(' -> ')}`);
}
const markerPopover = html.match(/id=["']editor-markers-popover["'][\s\S]*?<\/div>\s*<\/div>/)?.[0] ?? '';
if (!markerPopover.includes('data-editor-marker-action="spawn"') || !markerPopover.includes('data-editor-marker-action="goal"')) {
  editorDockContractErrors.push('Markers must expose Place Spawn and Goal actions');
}
if (/checkpoint/i.test(markerPopover)) {
  editorDockContractErrors.push('Checkpoint must not be a top-level Markers action');
}
const expandableTriggers = [
  ...html.matchAll(/<button[^>]+data-editor-dock=["'][^"']+["'][^>]*>/g),
  ...html.matchAll(/<button[^>]+data-editor-shell-action=["'](?:room|share)["'][^>]*>/g),
];
for (const trigger of expandableTriggers) {
  if (!trigger[0].includes('aria-expanded=')) {
    editorDockContractErrors.push(`drawer/popover trigger is missing aria-expanded: ${trigger[0]}`);
  }
}
if (earlyWorldTileMarkerIndex < 0) {
  earlyWorldTileBootstrapContractErrors.push('missing early world tile bootstrap marker');
}
if (mainModuleIndex < 0) {
  earlyWorldTileBootstrapContractErrors.push('missing coarse-first main module trampoline');
}
if (directMainModuleIndex >= 0) {
  earlyWorldTileBootstrapContractErrors.push('main.ts must remain behind the coarse-first trampoline');
}
if (earlyWorldTileMarkerIndex >= 0 && mainModuleIndex >= 0 && earlyWorldTileMarkerIndex >= mainModuleIndex) {
  earlyWorldTileBootstrapContractErrors.push('early world tile bootstrap must execute before the main module');
}

if (
  duplicateIds.size > 0
  || missing.length > 0
  || stalePresent.length > 0
  || earlyWorldTileBootstrapContractErrors.length > 0
  || editorDockContractErrors.length > 0
) {
  if (duplicateIds.size > 0) {
    console.error('Duplicate DOM IDs:');
    for (const id of [...duplicateIds].sort()) {
      console.error(`  #${id}`);
    }
  }
  if (missing.length > 0) {
    console.error('Missing required DOM IDs:');
    for (const item of missing.sort()) {
      console.error(`  ${item}`);
    }
  }
  if (stalePresent.length > 0) {
    console.error('Stale leaderboard discover IDs should stay owned by ExploreModal instead:');
    for (const id of stalePresent.sort()) {
      console.error(`  #${id}`);
    }
  }
  if (earlyWorldTileBootstrapContractErrors.length > 0) {
    console.error('Early world tile bootstrap DOM contract errors:');
    for (const error of earlyWorldTileBootstrapContractErrors) {
      console.error(`  ${error}`);
    }
  }
  if (editorDockContractErrors.length > 0) {
    console.error('Editor dock shell DOM contract errors:');
    for (const error of editorDockContractErrors) {
      console.error(`  ${error}`);
    }
  }
  process.exit(1);
}

const requiredCount = Object.values(requiredIdsByController)
  .reduce((total, requiredIds) => total + requiredIds.length, 0);
console.log(`DOM contract smoke passed: ${ids.size} IDs found, ${requiredCount} required IDs checked.`);
