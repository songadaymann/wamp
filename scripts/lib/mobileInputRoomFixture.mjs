import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync, gzipSync } from 'node:zlib';
import { createApiFixtures } from './apiFixtures.mjs';

/** Input probes need solid ground, no hazards and no timer while menus own focus. */
export function createMobileInputRoomFixtures(baseFile, file, { goalEnabled = true } = {}) {
  const recorded = JSON.parse(gunzipSync(readFileSync(baseFile)).toString());
  const original = JSON.parse(recorded.entries.find(entry => entry.path === '/api/rooms/0%2C0/published').text);
  const snapshot = { ...original, title: 'Controller test room', goalIntroText: null, music: null,
    goal: goalEnabled ? { ...original.goal, timeLimitMs: null } : null, placedObjects: [], spawnPoint: { x: 328, y: 304 }, pitsAreDeadly: true,
    tileData: Object.fromEntries(Object.entries(original.tileData).map(([layer, rows]) => [layer,
      rows.map((row, y) => row.map(() => layer === 'terrain' && y >= 19 ? original.tileData.terrain[y][0] : -1))])),
  };
  function replace(value) {
    if (Array.isArray(value)) return value.map(replace);
    if (!value || typeof value !== 'object') return value;
    const next = Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replace(item)]));
    if (next.id === '0,0' && Object.hasOwn(next, 'goal')) Object.assign(next, snapshot);
    return next;
  }
  const entries = recorded.entries.map(entry => entry.text && entry.contentType.includes('json')
    ? { ...entry, text: JSON.stringify(replace(JSON.parse(entry.text))) } : entry);
  writeFileSync(file, gzipSync(JSON.stringify({ ...recorded, entries })));
  return createApiFixtures({ mode: 'replay', file });
}
