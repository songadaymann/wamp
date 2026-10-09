import { normalizePlayerHearts, type PlayerHearts } from './hearts';

export const PLAYER_HURT_INVULNERABILITY_MS = 1000;

/** One health budget survives cell transitions, but resets at a fresh spawn. */
export class PlayerHealth {
  current = 1;
  maximum: PlayerHearts = 1;
  invulnerableUntil = 0;

  reset(maximum: unknown): void {
    this.maximum = normalizePlayerHearts(maximum);
    this.current = this.maximum;
    this.invulnerableUntil = 0;
  }

  setMaximum(maximum: unknown): void {
    this.maximum = normalizePlayerHearts(maximum);
    this.current = Math.min(this.current, this.maximum);
  }

  damage(now: number): 'ignored' | 'hurt' | 'death' {
    if (this.current === 0 || now < this.invulnerableUntil) return 'ignored';
    this.current -= 1;
    if (this.current === 0) {
      this.invulnerableUntil = 0;
      return 'death';
    }
    this.invulnerableUntil = now + PLAYER_HURT_INVULNERABILITY_MS;
    return 'hurt';
  }

  heal(): boolean {
    if (this.current === 0 || this.current >= this.maximum) return false;
    this.current += 1;
    return true;
  }

  die(): void {
    this.current = 0;
    this.invulnerableUntil = 0;
  }
}
