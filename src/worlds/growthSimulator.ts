import { getWorldOrigin } from './geometry';

export interface WorldGrowthSimulationConfig {
  worldCount: number;
  dailyActiveBuildersPerWorld: number;
  claimsPerBuilderPerDay: number;
  directionalBias: number;
  maxDays: number;
  trials: number;
  seed: number;
}

export interface WorldGrowthSimulationResult {
  collisions: number;
  censored: number;
  medianDays: number | null;
  p25Days: number | null;
  p75Days: number | null;
  p90Days: number | null;
  collisionDays: number[];
}

interface Point { x: number; y: number }

export function simulateWorldGrowth(config: WorldGrowthSimulationConfig): WorldGrowthSimulationResult {
  validateConfig(config);
  const collisionDays: number[] = [];
  for (let trial = 0; trial < config.trials; trial += 1) {
    const day = simulateTrial(config, mixSeed(config.seed, trial));
    if (day !== null) collisionDays.push(day);
  }
  collisionDays.sort((left, right) => left - right);
  return {
    collisions: collisionDays.length,
    censored: config.trials - collisionDays.length,
    medianDays: censoredPercentile(collisionDays, config.trials, 0.5),
    p25Days: censoredPercentile(collisionDays, config.trials, 0.25),
    p75Days: censoredPercentile(collisionDays, config.trials, 0.75),
    p90Days: censoredPercentile(collisionDays, config.trials, 0.9),
    collisionDays,
  };
}

function simulateTrial(config: WorldGrowthSimulationConfig, seed: number): number | null {
  if (config.worldCount < 2) return null;
  const random = createRandom(seed);
  const origins = Array.from({ length: config.worldCount }, (_, number) => getWorldOrigin(number));
  const territory = new Map<string, number>();
  const frontiers = origins.map(() => new Frontier());
  origins.forEach((origin, worldIndex) => {
    territory.set(key(origin), worldIndex);
    neighbors(origin).forEach((point) => frontiers[worldIndex].add(key(point)));
  });
  const targets = origins.map((origin, worldIndex) => nearestOtherOrigin(origin, worldIndex, origins));

  for (let day = 1; day <= config.maxDays; day += 1) {
    for (let worldIndex = 0; worldIndex < config.worldCount; worldIndex += 1) {
      const rawClaims = config.dailyActiveBuildersPerWorld * config.claimsPerBuilderPerDay;
      const claims = Math.floor(rawClaims) + (random() < rawClaims % 1 ? 1 : 0);
      for (let claim = 0; claim < claims; claim += 1) {
        const claimed = claimFrontier(
          worldIndex,
          frontiers[worldIndex],
          territory,
          targets[worldIndex],
          config.directionalBias,
          random,
        );
        if (claimed === 'collision') return day;
        if (claimed === 'exhausted') break;
      }
    }
  }
  return null;
}

function claimFrontier(
  worldIndex: number,
  frontier: Frontier,
  territory: Map<string, number>,
  target: Point,
  directionalBias: number,
  random: () => number,
): 'claimed' | 'collision' | 'exhausted' {
  const chosen = frontier.take(random, territory, random() < directionalBias ? target : null);
  if (!chosen) return 'exhausted';
  const point = parseKey(chosen);
  territory.set(chosen, worldIndex);
  for (const neighbor of neighbors(point)) {
    const owner = territory.get(key(neighbor));
    if (owner !== undefined && owner !== worldIndex) return 'collision';
    if (owner === undefined) frontier.add(key(neighbor));
  }
  return 'claimed';
}

function nearestOtherOrigin(origin: Point, worldIndex: number, origins: Point[]): Point {
  return origins.reduce<Point | null>((nearest, candidate, candidateIndex) => {
    if (candidateIndex === worldIndex) return nearest;
    if (!nearest || manhattan(origin, candidate) < manhattan(origin, nearest)) return candidate;
    return nearest;
  }, null) ?? origin;
}

function censoredPercentile(values: number[], trialCount: number, quantile: number): number | null {
  const rank = Math.max(0, Math.ceil(trialCount * quantile) - 1);
  return rank < values.length ? values[rank] : null;
}

function validateConfig(config: WorldGrowthSimulationConfig): void {
  for (const [label, value, min, max] of [
    ['worldCount', config.worldCount, 1, 25],
    ['dailyActiveBuildersPerWorld', config.dailyActiveBuildersPerWorld, 0, 1_000],
    ['claimsPerBuilderPerDay', config.claimsPerBuilderPerDay, 0, 25],
    ['maxDays', config.maxDays, 1, 20_000],
    ['trials', config.trials, 1, 500],
  ] as const) {
    if (!Number.isFinite(value) || value < min || value > max) throw new RangeError(`${label} must be between ${min} and ${max}.`);
  }
  if (!Number.isInteger(config.worldCount) || !Number.isInteger(config.maxDays) || !Number.isInteger(config.trials)) {
    throw new RangeError('worldCount, maxDays, and trials must be integers.');
  }
  if (!Number.isFinite(config.directionalBias) || config.directionalBias < 0 || config.directionalBias > 1) {
    throw new RangeError('directionalBias must be between 0 and 1.');
  }
  const operationBudget = config.worldCount * config.dailyActiveBuildersPerWorld
    * config.claimsPerBuilderPerDay * config.maxDays * config.trials;
  if (operationBudget > 5_000_000) {
    throw new RangeError('Simulation is too large. Reduce Worlds, DAU, days, or trials.');
  }
}

class Frontier {
  private readonly indexes = new Map<string, number>();
  private readonly values: string[] = [];

  add(value: string): void {
    if (this.indexes.has(value)) return;
    this.indexes.set(value, this.values.length);
    this.values.push(value);
  }

  take(
    random: () => number,
    territory: Map<string, number>,
    directionalTarget: Point | null,
  ): string | null {
    while (this.values.length > 0) {
      const sampleSize = directionalTarget ? Math.min(32, this.values.length) : 1;
      let chosen = this.values[Math.floor(random() * this.values.length)];
      let chosenDistance = directionalTarget ? manhattan(parseKey(chosen), directionalTarget) : 0;
      for (let sample = 1; sample < sampleSize; sample += 1) {
        const candidate = this.values[Math.floor(random() * this.values.length)];
        const distance = directionalTarget ? manhattan(parseKey(candidate), directionalTarget) : 0;
        if (distance < chosenDistance) {
          chosen = candidate;
          chosenDistance = distance;
        }
      }
      this.remove(chosen);
      if (!territory.has(chosen)) return chosen;
    }
    return null;
  }

  private remove(value: string): void {
    const index = this.indexes.get(value);
    if (index === undefined) return;
    const last = this.values.pop();
    this.indexes.delete(value);
    if (last !== undefined && index < this.values.length) {
      this.values[index] = last;
      this.indexes.set(last, index);
    }
  }
}

function neighbors(point: Point): Point[] {
  return [
    { x: point.x + 1, y: point.y }, { x: point.x - 1, y: point.y },
    { x: point.x, y: point.y + 1 }, { x: point.x, y: point.y - 1 },
  ];
}

function manhattan(left: Point, right: Point): number {
  return Math.abs(left.x - right.x) + Math.abs(left.y - right.y);
}

function key(point: Point): string { return `${point.x},${point.y}`; }

function parseKey(value: string): Point {
  const [x, y] = value.split(',').map(Number);
  return { x, y };
}

function mixSeed(seed: number, trial: number): number {
  return (seed ^ Math.imul(trial + 1, 0x9e3779b1)) >>> 0;
}

function createRandom(seed: number): () => number {
  let state = seed >>> 0 || 0x6d2b79f5;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}
