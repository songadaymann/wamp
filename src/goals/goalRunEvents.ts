/** Read-only run counters; owners retain mutations, terminal state and side effects. */
export interface GoalCollectionFacts {
  readonly collectiblesCollected: number;
  readonly enemyCollectiblesCollected: number;
  readonly collectibleTarget: number | null;
}
export type RoomGoalCollectOutcome = 'collection_complete' | 'return_to_npc' | 'race_exhausted' | null;
export function goalCollectiblesExhausted(facts: GoalCollectionFacts): boolean {
  return facts.collectibleTarget !== null &&
    facts.collectiblesCollected + facts.enemyCollectiblesCollected >= facts.collectibleTarget;
}
