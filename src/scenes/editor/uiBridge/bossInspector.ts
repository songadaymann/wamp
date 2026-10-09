import { DEFAULT_BOSS_HITS, normalizeBossHitPoints } from '../../../enemies/boss';
import type { EditorUiElements } from './elements';
import type { EditorUiBridgeActions } from './model';

export function bindBossInspector(elements: EditorUiElements, actions: EditorUiBridgeActions): () => void {
  const toggle = () => actions.onSetFocusedBossHitPoints(
    elements.bossCheckbox?.checked
      ? normalizeBossHitPoints(Number(elements.bossHitsInput?.value)) ?? DEFAULT_BOSS_HITS : null,
  );
  const preview = () => {
    if (elements.bossHitsOutput) elements.bossHitsOutput.value = elements.bossHitsInput?.value ?? '';
  };
  const commit = () => {
    const value = normalizeBossHitPoints(Number(elements.bossHitsInput?.value));
    if (elements.bossCheckbox?.checked && value !== null) actions.onSetFocusedBossHitPoints(value);
  };
  const input = () => { preview(); commit(); };
  // Phaser captures arrow keys at the window. Keep focused range keys native.
  const keydown = (event: KeyboardEvent) => event.stopPropagation();
  elements.bossCheckbox?.addEventListener('change', toggle);
  elements.bossHitsInput?.addEventListener('input', input);
  elements.bossHitsInput?.addEventListener('change', commit);
  elements.bossHitsInput?.addEventListener('keydown', keydown);
  return () => {
    elements.bossCheckbox?.removeEventListener('change', toggle);
    elements.bossHitsInput?.removeEventListener('input', input);
    elements.bossHitsInput?.removeEventListener('change', commit);
    elements.bossHitsInput?.removeEventListener('keydown', keydown);
  };
}
