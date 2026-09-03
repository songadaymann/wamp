import type { SmartBrushId, SmartStyleId } from './model';
import type { CyberFamilyId, CyberStyleId } from './cyberProfile';

export const CYBER_PANEL_RECIPE_ID = 'cyber.fence';

export type CyberSpanBrushId = 'cyber.support';

const CYBER_SPAN_BRUSH_IDS: readonly CyberSpanBrushId[] = [
  'cyber.support',
];

const CYBER_FAMILY_BY_BRUSH: Partial<Record<SmartBrushId, CyberFamilyId>> = {
  'cyber.concrete': 'structure',
  'cyber.windows': 'structure',
  'cyber.shell': 'structure',
  'cyber.neon': 'neon-strip',
  'cyber.rubble': 'rubble',
  'cyber.support': 'support',
  'cyber.fence': 'framed-panel',
};

export const CYBER_SPAN_INSTANCE_PREFIX: Readonly<Record<CyberSpanBrushId, string>> = {
  'cyber.support': 'cyber-support',
};

export function isCyberStyleId(styleId: SmartStyleId): styleId is CyberStyleId {
  return styleId === 'cyber-yellow' || styleId === 'cyber-pink';
}

export function isCyberSpanBrushId(brushId: SmartBrushId): brushId is CyberSpanBrushId {
  return CYBER_SPAN_BRUSH_IDS.includes(brushId as CyberSpanBrushId);
}

export function isCyberSmartBrushId(brushId: SmartBrushId): boolean {
  return brushId.startsWith('cyber.');
}

export function getCyberFamilyId(brushId: SmartBrushId): CyberFamilyId {
  const familyId = CYBER_FAMILY_BY_BRUSH[brushId];
  if (!familyId) throw new RangeError(`Smart brush ${brushId} is not a Cyber recipe.`);
  return familyId;
}
