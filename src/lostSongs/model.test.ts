import { describe, expect, it } from 'vitest';
import { canObjectBeStoredInContainer, getObjectById, placedObjectContributesToCategory } from '../config';
import { createDefaultRoomSnapshot, getRoomPublishValidationError } from '../persistence/roomModel';
import { getAuthoringCatalog } from '../agentBuilder/authoringCatalog';
import { getLostSongPlacementError } from './model';

describe('Lost Song placement and goal parity', () => {
  it('permits one main-layer song per cell and rejects duplicates, other layers and containers', () => {
    expect(getLostSongPlacementError([{ id: 'lost_song' }])).toBeNull();
    expect(getLostSongPlacementError([{ id: 'lost_song' }, { id: 'lost_song' }])).toMatch(/one Lost Song/);
    expect(getLostSongPlacementError([{ id: 'lost_song', layer: 'background' }])).toMatch(/main solid layer/);
    expect(getLostSongPlacementError([{ id: 'crate', containedObjectId: 'lost_song' }])).toMatch(/container/);
    expect(canObjectBeStoredInContainer('crate', getObjectById('lost_song'))).toBe(false);
  });
  it('excludes the cassette from collect targets while advertising authoring limits', () => {
    const room = createDefaultRoomSnapshot();room.placedObjects = [{ id: 'lost_song', x: 10, y: 20, instanceId: 'song' }];
    expect(placedObjectContributesToCategory(room.placedObjects[0], 'collectible')).toBe(false);
    room.goal = { type: 'collect_target', requiredCount: 1, timeLimitMs: null };
    expect(getRoomPublishValidationError(room)).not.toBeNull();
    const song = getAuthoringCatalog().objects.find(object => object.id === 'lost_song');
    expect(song).toMatchObject({ maximumPerRoom: 1, countsTowardGoals: false, capabilities: { layers: ['terrain'] } });
  });
});
