import { clampRoomLightingSliderValue } from './model';

export interface PlayerAuraDarkLightingRange {
  min: number;
  max: number;
}

export const PLAYER_AURA_DARK_AMBIENT_ALPHA_RANGE: PlayerAuraDarkLightingRange = Object.freeze({
  min: 0.08,
  max: 0.97,
});

export const PLAYER_AURA_DARK_AURA_DIAMETER_RANGE: PlayerAuraDarkLightingRange = Object.freeze({
  min: 96,
  max: 384,
});

function lerp(min: number, max: number, t: number): number {
  return min + (max - min) * t;
}

function normalizeSliderRatio(value: number): number {
  return clampRoomLightingSliderValue(value) / 100;
}

export function resolvePlayerAuraDarkAmbientAlpha(darkness: number): number {
  return Number(
    lerp(
      PLAYER_AURA_DARK_AMBIENT_ALPHA_RANGE.min,
      PLAYER_AURA_DARK_AMBIENT_ALPHA_RANGE.max,
      normalizeSliderRatio(darkness),
    ).toFixed(3),
  );
}

export function resolvePlayerAuraDarkAuraDiameter(radius: number): number {
  return Math.round(
    lerp(
      PLAYER_AURA_DARK_AURA_DIAMETER_RANGE.min,
      PLAYER_AURA_DARK_AURA_DIAMETER_RANGE.max,
      normalizeSliderRatio(radius),
    ),
  );
}
