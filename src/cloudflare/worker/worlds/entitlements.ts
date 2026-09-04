import type { WorldEntitlementChange, WorldEntitlementProvider } from '../../../worlds/model';
import type { Env } from '../core/types';
import { setWorldEntitlementStatus } from './store';

/**
 * Provider-neutral lifecycle boundary. Complimentary admin grants use this now;
 * a future Stripe adapter can translate webhooks into the same idempotent calls.
 */
export class D1WorldEntitlementProvider implements WorldEntitlementProvider {
  constructor(private readonly env: Env) {}

  activate(change: WorldEntitlementChange): Promise<void> {
    return setWorldEntitlementStatus(this.env, change.entitlementId, 'active', change.idempotencyKey);
  }

  freeze(change: WorldEntitlementChange): Promise<void> {
    return setWorldEntitlementStatus(this.env, change.entitlementId, 'frozen', change.idempotencyKey);
  }

  reactivate(change: WorldEntitlementChange): Promise<void> {
    return setWorldEntitlementStatus(this.env, change.entitlementId, 'active', change.idempotencyKey);
  }
}
