import { formatLimitedGoalTimer } from './goalPresentation';
import { computeCourseGoalBaseScore, computeRoomGoalTimeBonus } from './goalScoring';
import {
  NPC_QUEST_TYPES,
  normalizeGoalPositiveInteger as positiveInteger,
  type GoalMarkerAdapter,
  type GoalMarkerPoint,
  type GoalRegistry,
  type GoalTextOptions,
} from './goalSchema';

function formatEnemyCount(options: GoalTextOptions): string | null {
  const count = options.enemyCount;
  return typeof count === 'number' && Number.isFinite(count) && count > 0
    ? `${count} ${count === 1 ? 'enemy' : 'enemies'}`
    : null;
}

/** Room and course data share rules while retaining their marker identities and authored defaults. */
export function createGoalDefinitions<P extends GoalMarkerPoint>(marker: GoalMarkerAdapter<P>, collectDefaultCount: number) {
  const checkpoints = (value: unknown): P[] => Array.isArray(value)
    ? value.map(marker.normalize).filter((point): point is P => point !== null)
    : [];
  return {
    reach_exit: {
      label: 'Reach Exit',
      courseSupported: true as const,
      roomTick: (goal, elapsed) => goal.timeLimitMs !== null && elapsed >= goal.timeLimitMs ? 'time_up' : null,
      presentation: {
        badge: () => 'Reach exit',
        selectedNeedsEnemyCount: false,
        selected: () => 'Reach exit',
        progress: (_goal, facts) => facts.result === 'completed' ? 'Exit reached' : 'Reach the exit',
        timer: (goal, elapsed, format) => formatLimitedGoalTimer(goal.timeLimitMs, elapsed, format),
      },
      courseProgress: (_goal, facts) => facts.result === 'completed' ? 'Exit reached' : 'Reach the exit',
      roomScoring: {
        score: (goal, context) => Math.max(0, 100 + computeRoomGoalTimeBonus(goal.timeLimitMs, context.elapsedMs, 6) - context.deathPenalty),
        ranking: () => 'time',
      },
      courseScoring: {
        score: (_goal, finish) => computeCourseGoalBaseScore(finish),
        ranking: goal => goal.timeLimitMs ? 'time' : 'score',
      },
      markerKind: 'exit',
      supportsTimeLimit: true,
      createDefault: () => ({
        type: 'reach_exit',
        exit: null,
        timeLimitMs: null
      }),
      clone: goal => ({
        type: goal.type,
        exit: goal.exit ? marker.clone(goal.exit) : null,
        timeLimitMs: goal.timeLimitMs
      }),
      normalize: raw => ({
        type: 'reach_exit',
        exit: marker.normalize(raw.exit),
        timeLimitMs: positiveInteger(raw.timeLimitMs)
      }),
      shortText: () => 'Reach exit',
      introText: () => 'Reach the exit as fast as you can!',
      validate: goal => goal.exit ? null : 'Reach Exit needs an exit marker. Choose Set Exit and place it in the room.'
    },
    collect_target: {
      label: 'Collect Target',
      courseSupported: true as const,
      roomTick: (goal, elapsed) => goal.timeLimitMs !== null && elapsed >= goal.timeLimitMs ? 'time_up' : null,
      presentation: {
        badge: goal => `Collect ${goal.requiredCount}`,
        selectedNeedsEnemyCount: false,
        selected: goal => `Collect ${goal.requiredCount}`,
        progress: (goal, facts) => `${facts.collectiblesCollected}/${goal.requiredCount} collected`,
        timer: (goal, elapsed, format) => formatLimitedGoalTimer(goal.timeLimitMs, elapsed, format),
      },
      courseProgress: (goal, facts) => `${facts.collectiblesCollected}/${facts.collectibleTarget ?? goal.requiredCount} collected`,
      roomScoring: {
        score: (goal, context) => Math.max(0, context.collectiblesCollected * 25 +
          (context.result === 'completed' ? 60 : 0) +
          computeRoomGoalTimeBonus(goal.timeLimitMs, context.elapsedMs, 5) - context.deathPenalty),
        ranking: () => 'time',
      },
      courseScoring: {
        score: (_goal, finish) => computeCourseGoalBaseScore(finish),
        ranking: () => 'score',
      },
      markerKind: 'none',
      supportsTimeLimit: true,
      createDefault: () => ({
        type: 'collect_target',
        requiredCount: collectDefaultCount,
        timeLimitMs: null
      }),
      clone: goal => ({
        type: goal.type,
        requiredCount: goal.requiredCount,
        timeLimitMs: goal.timeLimitMs
      }),
      normalize: raw => ({
        type: 'collect_target',
        requiredCount: positiveInteger(raw.requiredCount) ?? 1,
        timeLimitMs: positiveInteger(raw.timeLimitMs)
      }),
      shortText: goal => `Collect ${goal.requiredCount}`,
      introText: goal => `Collect ${goal.requiredCount} item${goal.requiredCount === 1 ? '' : 's'} as fast as you can!`,
      validate: (goal, context) => context.collectiblesPlaced < goal.requiredCount
        ? `You've set the collect goal for ${goal.requiredCount} object${goal.requiredCount === 1 ? '' : 's'}, but you've only placed ${context.collectiblesPlaced}.` : null
    },
    collect_race: {
      label: 'Collect Race',
      courseSupported: false as const,
      roomTick: (goal, elapsed) => goal.timeLimitMs !== null && elapsed >= goal.timeLimitMs ? 'collect_race_timeout' : null,
      presentation: {
        badge: () => 'Collect race',
        selectedNeedsEnemyCount: false,
        selected: () => 'Collect more than the Sword Hunter',
        progress: (_goal, facts) => `You ${facts.collectiblesCollected} · Hunter ${facts.enemyCollectiblesCollected}`,
        timer: (goal, elapsed, format) => formatLimitedGoalTimer(goal.timeLimitMs, elapsed, format),
      },
      courseProgress: null,
      roomScoring: {
        score: (goal, context) => Math.max(0, context.collectiblesCollected * 25 +
          (context.result === 'completed' ? 120 : 0) +
          computeRoomGoalTimeBonus(goal.timeLimitMs, context.elapsedMs, 4) - context.deathPenalty),
        ranking: () => 'score',
      },
      courseScoring: null,
      markerKind: 'none',
      supportsTimeLimit: true,
      createDefault: () => ({
        type: 'collect_race',
        timeLimitMs: null
      }),
      clone: goal => ({
        type: goal.type,
        timeLimitMs: goal.timeLimitMs
      }),
      normalize: raw => ({
        type: 'collect_race',
        timeLimitMs: positiveInteger(raw.timeLimitMs)
      }),
      shortText: () => 'Collect race',
      introText: () => 'Collect more items than the Sword Hunter before the room is empty!',
      validate: (_goal, context) => context.collectiblesPlaced <= 0 ? 'Collect Race needs at least one collectible in the room.'
        : context.collectModeEnemyCount <= 0 ? 'Collect Race needs one Sword Hunter set to Collect Items.'
          : context.collectModeEnemyCount > 1 ? 'Collect Race currently supports exactly one Sword Hunter set to Collect Items.' : null
    },
    defeat_all: {
      label: 'Defeat All',
      courseSupported: true as const,
      roomTick: (goal, elapsed) => goal.timeLimitMs !== null && elapsed >= goal.timeLimitMs ? 'time_up' : null,
      presentation: {
        badge: () => 'Defeat all enemies',
        selectedNeedsEnemyCount: true,
        selected: (_goal, enemyCount) => `Defeat ${enemyCount} ${enemyCount === 1 ? 'enemy' : 'enemies'}`,
        progress: (_goal, facts) => `${facts.enemiesDefeated}/${facts.enemyTarget ?? 0} defeated`,
        timer: (goal, elapsed, format) => formatLimitedGoalTimer(goal.timeLimitMs, elapsed, format),
      },
      courseProgress: (_goal, facts) => `${facts.enemiesDefeated}/${facts.enemyTarget ?? 0} defeated`,
      roomScoring: {
        score: (goal, context) => Math.max(0, context.enemiesDefeated * 30 +
          (context.result === 'completed' ? 80 : 0) +
          computeRoomGoalTimeBonus(goal.timeLimitMs, context.elapsedMs, 5) - context.deathPenalty),
        ranking: () => 'time',
      },
      courseScoring: {
        score: (_goal, finish) => computeCourseGoalBaseScore(finish),
        ranking: () => 'score',
      },
      markerKind: 'none',
      supportsTimeLimit: true,
      createDefault: () => ({
        type: 'defeat_all',
        timeLimitMs: null
      }),
      clone: goal => ({
        type: goal.type,
        timeLimitMs: goal.timeLimitMs
      }),
      normalize: raw => ({
        type: 'defeat_all',
        timeLimitMs: positiveInteger(raw.timeLimitMs)
      }),
      shortText: (_goal, options) => {
        const n = formatEnemyCount(options);
        return n ? `Defeat ${n}` : 'Defeat all enemies';
      },
      introText: (_goal, options) => {
        const n = formatEnemyCount(options);
        return n ? `Defeat ${n} as fast as you can!` : 'Defeat all enemies as fast as you can!';
      },
      validate: (_goal, context) => context.enemyCount <= 0 ? 'Defeat All needs at least one enemy in the room.' : null
    },
    checkpoint_sprint: {
      label: 'Checkpoint Sprint',
      courseSupported: true as const,
      roomTick: (goal, elapsed) => goal.timeLimitMs !== null && elapsed >= goal.timeLimitMs ? 'time_up' : null,
      presentation: {
        badge: goal => `Reach ${goal.checkpoints.length || 0} ${goal.checkpoints.length === 1 ? 'checkpoint' : 'checkpoints'}`,
        selectedNeedsEnemyCount: false,
        selected: goal => `Reach ${goal.checkpoints.length} ${goal.checkpoints.length === 1 ? 'checkpoint' : 'checkpoints'}`,
        progress: (_goal, facts) => `${facts.checkpointsReached}/${facts.checkpointTarget ?? 0} checkpoints`,
        timer: (goal, elapsed, format) => formatLimitedGoalTimer(goal.timeLimitMs, elapsed, format),
      },
      courseProgress: (goal, facts) => `${facts.checkpointsReached}/${facts.checkpointTarget ?? goal.checkpoints.length} checkpoints`,
      roomScoring: {
        score: (_goal, context) => Math.max(0, 120 + context.checkpointsReached * 10 - context.deathPenalty),
        ranking: () => 'time',
      },
      courseScoring: {
        score: (_goal, finish) => computeCourseGoalBaseScore(finish),
        ranking: () => 'time',
      },
      markerKind: 'checkpoints',
      supportsTimeLimit: true,
      createDefault: () => ({
        type: 'checkpoint_sprint',
        checkpoints: [],
        finish: null,
        timeLimitMs: null
      }),
      clone: goal => ({
        type: goal.type,
        checkpoints: goal.checkpoints.map(marker.clone),
        finish: goal.finish ? marker.clone(goal.finish) : null,
        timeLimitMs: goal.timeLimitMs
      }),
      normalize: raw => ({
        type: 'checkpoint_sprint',
        checkpoints: checkpoints(raw.checkpoints),
        finish: marker.normalize(raw.finish),
        timeLimitMs: positiveInteger(raw.timeLimitMs)
      }),
      shortText: goal => `Reach ${goal.checkpoints.length || 0} ${goal.checkpoints.length === 1 ? 'checkpoint' : 'checkpoints'}`,
      introText: goal => `Reach ${goal.checkpoints.length} ${goal.checkpoints.length === 1 ? 'checkpoint' : 'checkpoints'}, then hit the finish as fast as you can!`,
      validate: goal => goal.finish ? null : 'Checkpoint Sprint needs a finish marker. Choose Set Finish and place it in the room.'
    },
    survival: {
      label: 'Survival',
      courseSupported: true as const,
      roomTick: (goal, elapsed) => elapsed >= goal.durationMs ? 'survival_clear' : null,
      presentation: {
        badge: goal => `Survive ${Math.max(1, Math.round(goal.durationMs / 1000))} seconds`,
        selectedNeedsEnemyCount: false,
        selected: goal => `Survive ${Math.max(1, Math.round(goal.durationMs / 1000))} seconds`,
        progress: (_goal, facts) => facts.result === 'completed' ? 'Survived' : 'Stay alive',
        timer: (goal, elapsed, format) => `${format(Math.max(0, goal.durationMs - elapsed))} LEFT`,
      },
      courseProgress: (_goal, facts) => facts.result === 'completed' ? 'Survived' : 'Stay alive',
      roomScoring: {
        score: (goal, context) => Math.max(0,
          Math.floor(Math.min(context.elapsedMs, Math.max(0, goal.durationMs)) / 1000) * 10 +
          context.collectiblesCollected * 15 + context.enemiesDefeated * 30 +
          (context.result === 'completed' ? 100 : 0) +
          (context.result === 'completed' && context.deaths === 0 ? 50 : 0) - context.deathPenalty),
        ranking: () => 'score',
      },
      courseScoring: {
        score: (_goal, finish) => computeCourseGoalBaseScore(finish) +
          (finish.result === 'completed' ? Math.max(0, Math.round(finish.elapsedMs / 1000)) * 5 : 0),
        ranking: () => 'score',
      },
      markerKind: 'none',
      supportsTimeLimit: false,
      createDefault: () => ({
        type: 'survival',
        durationMs: 30000
      }),
      clone: goal => ({
        type: goal.type,
        durationMs: goal.durationMs
      }),
      normalize: raw => ({
        type: 'survival',
        durationMs: positiveInteger(raw.durationMs) ?? 30000
      }),
      shortText: goal => `Survive ${Math.max(1, Math.round(goal.durationMs / 1000))} seconds`,
      introText: goal => `Survive ${Math.max(1, Math.round(goal.durationMs / 1000))} seconds. Pickups, enemy defeats, and zero-death clears raise your score!`,
      validate: () => null
    },
    npc_quest: {
      label: 'NPC Quest',
      courseSupported: false as const,
      roomTick: (goal, elapsed) => goal.questType === 'protect' && elapsed >= goal.durationMs ? 'npc_protected' : null,
      presentation: {
        badge: goal => goal.questType === 'protect'
          ? `Protect NPC ${Math.max(1, Math.round(goal.durationMs / 1000))} seconds`
          : goal.questType === 'escort' ? 'Escort NPC' : `Give NPC ${goal.requiredCount}`,
        selectedNeedsEnemyCount: false,
        selected: goal => goal.questType === 'protect'
          ? `Protect NPC for ${Math.max(1, Math.round(goal.durationMs / 1000))} seconds`
          : goal.questType === 'escort' ? 'Escort NPC to the destination' : `Collect ${goal.requiredCount} and return to NPC`,
        progress: (goal, facts) => goal.questType === 'protect'
          ? facts.result === 'completed' ? 'NPC protected' : 'Keep NPC alive'
          : goal.questType === 'escort' ? facts.result === 'completed' ? 'Escort complete' : 'Move NPC to destination'
            : facts.collectiblesCollected >= goal.requiredCount ? 'Return to NPC' : `${facts.collectiblesCollected}/${goal.requiredCount} collected`,
        timer: (goal, elapsed, format) => goal.questType === 'protect'
          ? `${format(Math.min(elapsed, goal.durationMs))} PROTECTED`
          : formatLimitedGoalTimer(goal.timeLimitMs, elapsed, format),
      },
      courseProgress: null,
      roomScoring: {
        score: (goal, context) => goal.questType === 'protect'
          ? Math.max(0, Math.floor(Math.min(context.elapsedMs, goal.durationMs) / 1000) * 10 - context.deathPenalty)
          : Math.max(0, 100 + context.collectiblesCollected * (goal.questType === 'give' ? 10 : 0) - context.deathPenalty),
        ranking: goal => goal.questType === 'protect' ? 'protect' : 'time',
      },
      courseScoring: null,
      markerKind: 'npc_destination',
      supportsTimeLimit: false,
      createDefault: () => ({
        type: 'npc_quest',
        questType: 'protect',
        npcInstanceId: null,
        durationMs: 30000,
        requiredCount: 3,
        destination: null,
        timeLimitMs: null
      }),
      clone: goal => ({
        type: goal.type,
        questType: goal.questType,
        npcInstanceId: goal.npcInstanceId,
        durationMs: goal.durationMs,
        requiredCount: goal.requiredCount,
        destination: goal.destination ? marker.clone(goal.destination) : null,
        timeLimitMs: null
      }),
      normalize: raw => ({
        type: 'npc_quest',
        questType: NPC_QUEST_TYPES.find(type => type === raw.questType) ?? 'protect',
        npcInstanceId: typeof raw.npcInstanceId === 'string' && raw.npcInstanceId.trim() ? raw.npcInstanceId.trim() : null,
        durationMs: positiveInteger(raw.durationMs) ?? 30000,
        requiredCount: positiveInteger(raw.requiredCount) ?? 1,
        destination: marker.normalize(raw.destination),
        timeLimitMs: null
      }),
      shortText: goal => {
        switch (goal.questType) {
          case 'protect': return `Protect NPC for ${Math.max(1, Math.round(goal.durationMs / 1000))} seconds`;
          case 'escort': return 'Escort NPC to the destination';
          case 'give': return `Collect ${goal.requiredCount} and return to NPC`;
        }
      },
      introText: goal => {
        switch (goal.questType) {
          case 'protect': return `Keep the NPC alive for ${Math.max(1, Math.round(goal.durationMs / 1000))} seconds!`;
          case 'escort': return 'Escort the NPC to the marked destination!';
          case 'give': return `Collect ${goal.requiredCount} item${goal.requiredCount === 1 ? '' : 's'}, then return to the NPC!`;
        }
      },
      validate: (goal, context) => {
        const ids = context.npcInstanceIds ?? [];
        if (ids.length === 0)
          return 'NPC Quest needs at least one NPC in the room.';
        if (goal.npcInstanceId && !ids.includes(goal.npcInstanceId))
          return 'The NPC linked to this quest is no longer in the room. Link another NPC.';
        if (goal.questType === 'escort' && !goal.destination)
          return 'Escort needs a destination marker.';
        if (goal.questType === 'give' && context.collectiblesPlaced < goal.requiredCount)
          return `Give needs ${goal.requiredCount} collectible${goal.requiredCount === 1 ? '' : 's'}, but only ${context.collectiblesPlaced} are placed.`;
        return null;
      }
    }
  } satisfies GoalRegistry<P>;
}
