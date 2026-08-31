import {
  CYBER_FAMILY_DEFINITIONS,
  resolveCyberFramedPanel,
  resolveCyberNeonStrip,
  resolveCyberPlatformSpan,
  resolveCyberRubbleColumn,
  resolveCyberSupportSpan,
  type CyberFamilyId,
  type CyberResolvedTile,
  type CyberStyleId,
} from './cyberProfile';

export type CyberLinearFamilyId = Exclude<CyberFamilyId, 'structure' | 'framed-panel'>;

export function getCyberFamilyMinimumWidth(familyId: CyberFamilyId): number {
  return CYBER_FAMILY_DEFINITIONS[familyId].minimumWidth;
}

export function resolveCyberLinearFamilyTiles(
  familyId: CyberLinearFamilyId,
  styleId: CyberStyleId,
  length: number,
  supportTransforms?: { flipX: boolean; capFlipX: boolean },
): CyberResolvedTile[] {
  switch (familyId) {
    case 'platform':
      return resolveCyberPlatformSpan(styleId, length);
    case 'support':
      return resolveCyberSupportSpan(
        styleId,
        length,
        supportTransforms?.flipX ?? false,
        supportTransforms?.capFlipX,
      );
    case 'neon-strip':
      return resolveCyberNeonStrip(styleId, length);
    case 'rubble':
      return resolveCyberRubbleColumn(styleId, length);
  }
}

export function resolveCyberHorizontalMiddleTile(
  familyId: 'platform' | 'neon-strip',
  styleId: CyberStyleId,
  sourceOffset: number,
): CyberResolvedTile {
  const cycleLength = familyId === 'platform' ? 1 : 5;
  const sample = resolveCyberLinearFamilyTiles(familyId, styleId, cycleLength + 2);
  const cycleOffset = Math.max(0, sourceOffset - 1) % cycleLength;
  return sample[1 + cycleOffset]!;
}

export function resolveCyberFramedPanelTiles(
  styleId: CyberStyleId,
  width: number,
): CyberResolvedTile[][] {
  return resolveCyberFramedPanel(styleId, width);
}
