import type {
  PvpHitSource,
  PvpMatchCombatEvent,
} from '../../pvp/model';
import type { CombatPresentationEvent } from './combatPresentation';

export const PVP_HIT_THROTTLE_MS = 180;
export const PVP_STOMP_COOLDOWN_MS = 450;
export const PVP_RECEIVED_HIT_LEDGER_LIMIT = 80;
export const PVP_INSTANCE_STATE_CADENCE_MS = 25;

type PvpDamageSource = Exclude<PvpHitSource, 'environment'>;
type PvpCombatAction = Extract<PvpDamageSource, 'sword' | 'gun'>;

export class OverworldPvpCombatCoordinator {
  private lastSelfDeathHitId: string | null = null;
  private lastStompAt = 0;
  private readonly lastHitSentAtByKey = new Map<string, number>();
  private readonly lastReceivedActionHitIds = new Set<string>();
  private localAction: PvpCombatAction | null = null;
  private localActionUntilEpoch = 0;
  private lastInstanceStateSentAt = 0;
  private instanceStateSequence = 0;

  reset(): void {
    this.lastSelfDeathHitId = null;
    this.lastStompAt = 0;
    this.lastHitSentAtByKey.clear();
    this.lastReceivedActionHitIds.clear();
    this.localAction = null;
    this.localActionUntilEpoch = 0;
    this.lastInstanceStateSentAt = 0;
    this.instanceStateSequence = 0;
  }

  reportSelfDeath(input: {
    damageActive: boolean;
    matchId: string | null;
    localUserId: string | null;
    epochNow: number;
    report: (source: 'environment', hitId: string) => boolean;
  }): boolean {
    if (!input.damageActive || !input.localUserId) {
      return false;
    }

    const hitId = `self:${input.matchId}:${input.localUserId}:${input.epochNow}`;
    if (hitId === this.lastSelfDeathHitId) {
      return false;
    }
    this.lastSelfDeathHitId = hitId;
    input.report('environment', hitId);
    return true;
  }

  isStompReady(now: number): boolean {
    return now - this.lastStompAt >= PVP_STOMP_COOLDOWN_MS;
  }

  recordStomp(now: number): void {
    this.lastStompAt = now;
  }

  reportPeerHit(input: {
    damageActive: boolean;
    matchId: string | null;
    targetUserId: string;
    source: PvpDamageSource;
    monotonicNow: number;
    epochNow: number;
    randomSuffix: string;
    report: (targetUserId: string, source: PvpDamageSource, hitId: string) => boolean;
  }): boolean {
    if (!input.damageActive || !input.matchId || !input.targetUserId) {
      return false;
    }

    const key = `${input.matchId}:${input.targetUserId}:${input.source}`;
    const previousAt = this.lastHitSentAtByKey.get(key) ?? -Infinity;
    if (input.monotonicNow - previousAt < PVP_HIT_THROTTLE_MS) {
      return false;
    }

    this.lastHitSentAtByKey.set(key, input.monotonicNow);
    const hitId = [
      input.source,
      input.matchId,
      input.targetUserId,
      input.epochNow,
      Math.floor(input.monotonicNow),
      input.randomSuffix,
    ].join(':');
    const reported = input.report(input.targetUserId, input.source, hitId);
    if (!reported) {
      this.lastHitSentAtByKey.delete(key);
    }
    return reported;
  }

  reportReceivedActionHit(input: {
    channel: 'instance' | 'presence';
    action: PvpCombatAction;
    matchId: string;
    attackerUserId: string;
    localUserId: string;
    actionUntil: number;
    report: (attackerUserId: string, source: PvpCombatAction, hitId: string) => boolean;
  }): boolean {
    const hitId = [
      input.channel === 'instance' ? 'received-instance' : 'received',
      input.action,
      input.matchId,
      input.attackerUserId,
      input.localUserId,
      Math.round(input.actionUntil / 50),
    ].join(':');
    if (this.lastReceivedActionHitIds.has(hitId)) {
      return false;
    }

    if (this.lastReceivedActionHitIds.size > PVP_RECEIVED_HIT_LEDGER_LIMIT) {
      this.lastReceivedActionHitIds.clear();
    }
    this.lastReceivedActionHitIds.add(hitId);
    const reported = input.report(input.attackerUserId, input.action, hitId);
    if (!reported) {
      this.lastReceivedActionHitIds.delete(hitId);
    }
    return reported;
  }

  publishLocalAction(input: {
    damageActive: boolean;
    matchId: string | null;
    event: CombatPresentationEvent;
    visualFeetOffset: number;
    send: (event: Omit<PvpMatchCombatEvent, 'userId'>) => boolean;
  }): boolean {
    if (!input.damageActive || !input.matchId) {
      return false;
    }

    const { event } = input;
    this.localAction = event.source;
    this.localActionUntilEpoch = event.startedAt + Math.max(PVP_HIT_THROTTLE_MS, event.durationMs);
    input.send({
      id: event.id,
      matchId: input.matchId,
      source: event.source,
      x: event.x,
      y: event.y + input.visualFeetOffset,
      facing: event.facing,
      startedAt: event.startedAt,
      durationMs: event.durationMs,
      effectX: event.effectX,
      effectY: event.effectY,
      downward: event.downward,
      projectile: event.projectile
        ? {
            x: event.projectile.x,
            y: event.projectile.y,
            velocityX: event.projectile.velocityX,
            lifetimeMs: event.projectile.lifetimeMs,
          }
        : null,
    });
    return true;
  }

  getActiveLocalAction(epochNow: number): PvpCombatAction | null {
    const activeAction =
      this.localAction && epochNow < this.localActionUntilEpoch
        ? this.localAction
        : null;
    if (!activeAction) {
      this.localAction = null;
      this.localActionUntilEpoch = 0;
    }
    return activeAction;
  }

  getLocalActionUntilEpoch(): number {
    return this.localActionUntilEpoch;
  }

  beginInstanceStateSend(monotonicNow: number, force: boolean): number | null {
    if (!force && monotonicNow - this.lastInstanceStateSentAt < PVP_INSTANCE_STATE_CADENCE_MS) {
      return null;
    }
    this.lastInstanceStateSentAt = monotonicNow;
    this.instanceStateSequence += 1;
    return this.instanceStateSequence;
  }

  getDebugSnapshot(): Record<string, unknown> {
    return {
      lastSelfDeathHitId: this.lastSelfDeathHitId,
      lastStompAt: this.lastStompAt,
      sentHitThrottleCount: this.lastHitSentAtByKey.size,
      receivedHitLedgerCount: this.lastReceivedActionHitIds.size,
      localAction: this.localAction,
      localActionUntilEpoch: this.localActionUntilEpoch,
      lastInstanceStateSentAt: this.lastInstanceStateSentAt,
      instanceStateSequence: this.instanceStateSequence,
    };
  }
}
