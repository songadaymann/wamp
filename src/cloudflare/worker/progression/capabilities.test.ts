import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { TrustTier } from '../../../progression/model';
import type { Env, UserProgressRow } from '../core/types';
import { buildBuilderCapabilitySummary } from './capabilities';

const progress = {
  builder_claim_limit_override: null,
  builder_publish_limit_override: null,
  builder_object_limit_override: null,
  builder_collectible_limit_override: null,
  builder_expanded_room_cell_limit_override: null,
} as UserProgressRow;

const config = JSON.parse(readFileSync('wrangler.jsonc', 'utf8'));

describe('builder daily allowances', () => {
  it.each([
    ['production', config.vars],
    ['safety', config.env.safety.vars],
  ])('uses increasing tier allowances with the %s deployment settings', (_name, vars) => {
    const tiers: TrustTier[] = ['T0', 'T1', 'T2', 'T3', 'T4'];
    for (const auth of ['session', 'api_token', 'agent_token', null] as const) {
      const caps = tiers.map((tier) => buildBuilderCapabilitySummary(vars as Env, progress, auth, tier));
      expect(caps.map((cap) => cap.claimLimitPerDay)).toEqual([5, 10, 15, 20, 25]);
      expect(caps.map((cap) => cap.publishLimitPerDay)).toEqual([5, 10, 15, 20, 25]);
      expect(caps.every((cap) => !cap.overrideActive)).toBe(true);
    }
  });

  it('keeps individual admin allowances ahead of environment and tier defaults', () => {
    const caps = buildBuilderCapabilitySummary(
      { ROOM_DAILY_CLAIM_LIMIT: '30', ROOM_DAILY_PUBLISH_LIMIT: '40' } as Env,
      { ...progress, builder_claim_limit_override: 7, builder_publish_limit_override: 8 },
      'session',
      'T4',
    );
    expect(caps).toMatchObject({ claimLimitPerDay: 7, publishLimitPerDay: 8, overrideActive: true });
  });
});
