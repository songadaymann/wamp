import { afterEach, describe, expect, it } from 'vitest';
import { createDefaultRoomSnapshot } from '../../../persistence/roomModel';
import { fixture, NOW } from '../activity/testDatabase';
import { saveDraft, type RoomMutationActor } from './store';

const opened: ReturnType<typeof fixture>[] = [];
afterEach(() => { for (const f of opened.splice(0)) f.sqlite.close(); });

const visitor: RoomMutationActor = {
  ownerUser: { id: 'p1', email: 'p1@example.test', walletAddress: null, displayName: 'p1' },
  principalKind: 'user',
  principalAgentId: null,
  principalDisplayName: 'p1',
  requestAuthSource: 'session',
};

function draftAt(x: number, y: number) {
  return { ...createDefaultRoomSnapshot(`${x},${y}`, { x, y }), title: 'New room' };
}

describe('WAMP 0 claims next to numbered Worlds (F213)', () => {
  it('lets a WAMP 0 room seed a claim but not a numbered World room', async () => {
    const f = fixture(); opened.push(f);
    f.sqlite.exec(`
      INSERT INTO world_entitlements (id, owner_user_id, owner_email, source, status,
        claim_limit_ceiling, publish_limit_ceiling, created_at, updated_at)
      VALUES ('entitlement-1', 'p3', 'p3@example.test', 'complimentary', 'active', 10, 25, '${NOW}', '${NOW}');
      INSERT INTO worlds (id, number, origin_x, origin_y, owner_user_id, entitlement_id, approved_name,
        build_policy, publish_policy, claim_limit_per_day, publish_limit_per_day, activated_at, created_at, updated_at)
      VALUES ('world-1', 1, 129, 0, 'p3', 'entitlement-1', NULL, 'invite_only', 'approval_required', 5, 10, '${NOW}', '${NOW}', '${NOW}');
      INSERT INTO rooms (id, x, y, draft_json, published_json, published_title, claimer_user_id)
        VALUES ('129,0', 129, 0, '{}', '{}', 'World seed', 'p3');
      INSERT INTO world_room_claims (room_id, x, y, world_id, first_builder_user_id, claimed_at)
        VALUES ('129,0', 129, 0, 'world-1', 'p3', '${NOW}');
    `);
    await expect(saveDraft(f.env, draftAt(130, 0), visitor)).rejects.toMatchObject({ status: 409 });
    await expect(saveDraft(f.env, draftAt(1, 0), visitor)).resolves.toMatchObject({ claimerUserId: 'p1' });
  });
});
