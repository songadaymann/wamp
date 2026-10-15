import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync, gzipSync } from 'node:zlib';
import { createApiFixtures } from './apiFixtures.mjs';

/** A guest room with two pickups at spawn; every request/write stays in replay. */
export function createMobileSpawnPickupFixtures(baseFile, file) {
  const recorded = JSON.parse(gunzipSync(readFileSync(baseFile)).toString());
  const original = JSON.parse(recorded.entries.find(entry => entry.path === '/api/rooms/0%2C0/published').text);
  // Separate vertical anchor cells both overlap the pickup sensor at the default spawn.
  const snapshot = { ...original, goal: { type: 'collect_target', requiredCount: 2, timeLimitMs: null }, goalIntroText: null, music: null, spawnPoint: { x: 328, y: 304 },
    placedObjects: [280, 296].map((y, index) => ({ ...original.placedObjects[0], id: 'coin_gold', x: 328, y, instanceId: `spawn-pickup-${index}` })) };
  function replace(value) {
    if (Array.isArray(value)) return value.map(replace);
    if (!value || typeof value !== 'object') return value;
    const next = Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replace(item)]));
    if (next.id === '0,0' && Object.hasOwn(next, 'goal')) Object.assign(next, snapshot);
    if (next.id === '0,0' && Object.hasOwn(next, 'goalType')) next.goalType = 'collect_target';
    return next;
  }
  const entries = recorded.entries.map(entry => entry.text && entry.contentType.includes('json')
    ? { ...entry, text: JSON.stringify(replace(JSON.parse(entry.text))) } : entry);
  writeFileSync(file, gzipSync(JSON.stringify({ ...recorded, entries })));
  return createApiFixtures({ mode: 'replay', file });
}
