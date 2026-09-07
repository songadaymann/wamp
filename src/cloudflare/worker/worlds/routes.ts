import { cloneRoomSnapshot, type RoomSnapshot } from '../../../persistence/roomModel';
import type { WorldSettings } from '../../../worlds/model';
import {
  loadOptionalRequestAuth,
  requireAuthenticatedRequestAuth,
  requireTrustedOriginForMutation,
} from '../auth/request';
import { HttpError, isRoomSnapshot, jsonResponse, parseJsonBody } from '../core/http';
import type { Env, WorkerExecutionContextLike } from '../core/types';
import { refreshPlayableContentIndexForRoom, schedulePlayableContentIndexRefresh } from '../playableContentIndex/store';
import { awardRoomPublishProgression } from '../progression/store';
import { awardRoomPublishPoints, upsertUserStats } from '../runs/points';
import { loadRoomRecord } from '../rooms/store';
import { activateWorldFromSeed } from './activation';
import {
  sendWorldInvitationEmail,
  sendWorldManagerActionEmail,
  sendWorldNameReviewEmail,
} from './notifications';
import {
  listWorldPublicationRequests,
  resolveWorldPublicationRequest,
  submitWorldPublicationRequest,
} from './publication';
import {
  bindPendingWorldIdentity,
  listWorlds,
  loadMyWorlds,
  loadWorldDetailById,
  loadWorldDetailByNumber,
  recordWorldDirectoryWarp,
  saveWorldSeedDraft,
  updateWorldSettings,
  worldsEnabled,
} from './store';
import {
  acceptWorldInvitation,
  inviteWorldBuilder,
  listWorldMemberships,
  requestWorldMembership,
  updateWorldMembership,
  type MembershipAction,
} from './memberships';
import { submitWorldNameRequest } from './names';

export async function handleWorldsRequest(
  request: Request,
  url: URL,
  env: Env,
  context?: WorkerExecutionContextLike,
): Promise<Response> {
  if (!worldsEnabled(env)) throw new HttpError(404, 'Worlds are not enabled.');
  requireTrustedOriginForMutation(request);
  const segments = url.pathname.split('/').filter(Boolean);

  if (url.pathname === '/api/worlds' && request.method === 'GET') {
    const auth = await loadOptionalRequestAuth(env, request);
    if (auth) await bindPendingWorldIdentity(env, auth.user);
    return jsonResponse(request, {
      worlds: await listWorlds(env, auth?.user.id ?? null, auth?.isAdmin ?? false),
    });
  }

  if (url.pathname === '/api/worlds/me' && request.method === 'GET') {
    const auth = await requireAuthenticatedRequestAuth(env, request, 'view your Worlds');
    return jsonResponse(request, await loadMyWorlds(env, auth.user, auth.isAdmin));
  }

  if (segments.length === 4 && segments[2] === 'number' && request.method === 'GET') {
    const number = parseWorldNumber(segments[3]);
    const auth = await loadOptionalRequestAuth(env, request);
    if (auth) await bindPendingWorldIdentity(env, auth.user);
    const world = await loadWorldDetailByNumber(env, number, auth?.user.id ?? null, auth?.isAdmin ?? false);
    if (!world) throw new HttpError(404, 'World was not found.');
    return jsonResponse(request, world);
  }

  const worldId = decodeURIComponent(segments[2] ?? '');
  if (!worldId) throw new HttpError(400, 'World id is required.');

  if (segments.length === 3 && request.method === 'GET') {
    const auth = await loadOptionalRequestAuth(env, request);
    if (auth) await bindPendingWorldIdentity(env, auth.user);
    const world = await loadWorldDetailById(env, worldId, auth?.user.id ?? null, auth?.isAdmin ?? false);
    if (!world) throw new HttpError(404, 'World was not found.');
    return jsonResponse(request, world);
  }

  if (segments.length === 4 && segments[3] === 'warp' && request.method === 'POST') {
    const auth = await loadOptionalRequestAuth(env, request);
    await recordWorldDirectoryWarp(env, worldId, auth?.user.id ?? null);
    return jsonResponse(request, { ok: true });
  }

  if (segments.length === 4 && segments[3] === 'settings' && request.method === 'PATCH') {
    const auth = await requireAuthenticatedRequestAuth(env, request, 'change World settings');
    const body = await parseJsonBody<WorldSettings>(request);
    return jsonResponse(request, await updateWorldSettings(env, worldId, auth.user.id, auth.isAdmin, body));
  }

  if (segments.length === 4 && segments[3] === 'members' && request.method === 'GET') {
    const auth = await requireAuthenticatedRequestAuth(env, request, 'manage World members');
    return jsonResponse(request, {
      members: await listWorldMemberships(env, worldId, auth.user.id, auth.isAdmin),
    });
  }

  if (segments.length === 4 && segments[3] === 'invitations' && request.method === 'POST') {
    const auth = await requireAuthenticatedRequestAuth(env, request, 'invite World builders');
    const body = await parseJsonBody<{ email?: unknown }>(request);
    if (typeof body.email !== 'string') throw new HttpError(400, 'Builder email is required.');
    const member = await inviteWorldBuilder(env, worldId, body.email, auth.user, auth.isAdmin);
    const world = await loadWorldDetailById(env, worldId, auth.user.id, auth.isAdmin);
    const email = world
      ? await sendWorldInvitationEmail(request, env, {
          email: member.email,
          worldNumber: world.number,
          worldName: world.displayName,
        })
      : { attempted: false, sent: false, error: null };
    return jsonResponse(request, { member, email }, { status: 201 });
  }

  if (segments.length === 4 && segments[3] === 'join-requests' && request.method === 'POST') {
    const auth = await requireAuthenticatedRequestAuth(env, request, 'request World builder access');
    const member = await requestWorldMembership(env, worldId, auth.user, auth.isAdmin);
    const world = await loadWorldDetailById(env, worldId, auth.user.id, auth.isAdmin);
    const email = world
      ? await sendWorldManagerActionEmail(request, env, {
          worldId,
          worldNumber: world.number,
          worldName: world.displayName,
          kind: 'membership',
          requester: auth.user.displayName,
        })
      : { attempted: false, sent: false, error: null };
    return jsonResponse(request, { member, email }, { status: 201 });
  }

  if (segments.length === 5 && segments[3] === 'invitations' && segments[4] === 'accept' && request.method === 'POST') {
    const auth = await requireAuthenticatedRequestAuth(env, request, 'accept a World invitation');
    return jsonResponse(request, { member: await acceptWorldInvitation(env, worldId, auth.user) });
  }

  if (segments.length === 5 && segments[3] === 'members' && request.method === 'PATCH') {
    const auth = await requireAuthenticatedRequestAuth(env, request, 'manage a World member');
    const body = await parseJsonBody<{ action?: unknown }>(request);
    const action = parseMembershipAction(body.action);
    return jsonResponse(request, {
      member: await updateWorldMembership(
        env,
        worldId,
        decodeURIComponent(segments[4]),
        action,
        auth.user,
        auth.isAdmin,
      ),
    });
  }

  if (segments.length === 4 && segments[3] === 'name-requests' && request.method === 'POST') {
    const auth = await requireAuthenticatedRequestAuth(env, request, 'request a World name');
    const body = await parseJsonBody<{ proposedName?: unknown }>(request);
    if (typeof body.proposedName !== 'string') throw new HttpError(400, 'proposedName is required.');
    const nameRequest = await submitWorldNameRequest(env, worldId, body.proposedName, auth.user.id, auth.isAdmin);
    const email = await sendWorldNameReviewEmail(request, env, {
      worldNumber: nameRequest.worldNumber,
      proposedName: nameRequest.proposedName,
    });
    return jsonResponse(request, { request: nameRequest, email }, { status: 201 });
  }

  if (segments.length === 4 && segments[3] === 'publication-requests' && request.method === 'GET') {
    const auth = await requireAuthenticatedRequestAuth(env, request, 'review World publications');
    return jsonResponse(request, {
      requests: await listWorldPublicationRequests(env, worldId, auth.user.id, auth.isAdmin),
    });
  }

  if (segments.length === 4 && segments[3] === 'publication-requests' && request.method === 'POST') {
    const auth = await requireAuthenticatedRequestAuth(env, request, 'submit a World room');
    const body = await parseJsonBody<{ roomId?: unknown; x?: unknown; y?: unknown }>(request);
    if (typeof body.roomId !== 'string' || !Number.isInteger(body.x) || !Number.isInteger(body.y)) {
      throw new HttpError(400, 'roomId, x, and y are required.');
    }
    const publication = await submitWorldPublicationRequest(
      env,
      worldId,
      body.roomId,
      { x: Number(body.x), y: Number(body.y) },
      auth.user,
      auth.isAdmin,
    );
    const world = await loadWorldDetailById(env, worldId, auth.user.id, auth.isAdmin);
    const email = world
      ? await sendWorldManagerActionEmail(request, env, {
          worldId,
          worldNumber: world.number,
          worldName: world.displayName,
          kind: 'publication',
          requester: auth.user.displayName,
        })
      : { attempted: false, sent: false, error: null };
    return jsonResponse(request, { request: publication, email }, { status: 201 });
  }

  if (segments.length === 5 && segments[3] === 'publication-requests' && request.method === 'PATCH') {
    const auth = await requireAuthenticatedRequestAuth(env, request, 'resolve a World publication');
    const body = await parseJsonBody<{ decision?: unknown; rejectionReason?: unknown }>(request);
    if (body.decision !== 'approve' && body.decision !== 'reject') {
      throw new HttpError(400, 'decision must be approve or reject.');
    }
    const resolved = await resolveWorldPublicationRequest(
      env,
      worldId,
      decodeURIComponent(segments[4]),
      body.decision,
      typeof body.rejectionReason === 'string' ? body.rejectionReason : null,
      auth,
    );
    if (body.decision === 'approve') {
      const record = await loadRoomRecord(
        env,
        resolved.roomId,
        resolved.roomCoordinates,
        resolved.submittedByUserId,
      );
      const snapshot = record.published;
      if (snapshot) {
        const priorVersions = record.versions.filter((version) => version.version !== snapshot.version);
        const previousPublishedSnapshot = priorVersions.at(-1)?.snapshot ?? null;
        await awardRoomPublishPoints(env, resolved.submittedByUserId, snapshot.id, snapshot.version, {
          hasGoal: snapshot.goal !== null,
          hasPriorGoalPublish: priorVersions.some((version) => version.snapshot.goal !== null),
        });
        await awardRoomPublishProgression(env, {
          userId: resolved.submittedByUserId,
          roomId: snapshot.id,
          roomVersion: snapshot.version,
          publishedSnapshot: snapshot,
          previousPublishedSnapshot,
          hasGoal: snapshot.goal !== null,
          hasPriorGoalPublish: priorVersions.some((version) => version.snapshot.goal !== null),
          publishedAt: snapshot.publishedAt ?? new Date().toISOString(),
        });
        await upsertUserStats(env, resolved.submittedByUserId);
      }
      schedulePlayableContentIndexRefresh(context, refreshPlayableContentIndexForRoom(env, resolved.roomId));
    }
    return jsonResponse(request, { request: resolved });
  }

  throw new HttpError(404, 'World route not found.');
}

export async function handleWorldGrantRequest(
  request: Request,
  url: URL,
  env: Env,
  context?: WorkerExecutionContextLike,
): Promise<Response> {
  if (!worldsEnabled(env)) throw new HttpError(404, 'Worlds are not enabled.');
  requireTrustedOriginForMutation(request);
  const segments = url.pathname.split('/').filter(Boolean);
  const grantId = decodeURIComponent(segments[2] ?? '');
  if (!grantId) throw new HttpError(400, 'World grant id is required.');

  if (segments.length === 4 && segments[3] === 'seed-draft' && request.method === 'PUT') {
    const auth = await requireAuthenticatedRequestAuth(env, request, 'save a World seed draft');
    const rawSnapshot = await parseJsonBody<unknown>(request, { maxBytes: 2_500_000 });
    if (!isRoomSnapshot(rawSnapshot)) throw new HttpError(400, 'Request body must be a room snapshot.');
    let snapshot: RoomSnapshot;
    try {
      snapshot = cloneRoomSnapshot(rawSnapshot);
    } catch {
      throw new HttpError(400, 'Request body must be a valid room snapshot.');
    }
    return jsonResponse(request, {
      entitlement: await saveWorldSeedDraft(env, grantId, auth.user.id, snapshot),
    });
  }

  if (segments.length === 4 && segments[3] === 'activate' && request.method === 'POST') {
    const auth = await requireAuthenticatedRequestAuth(env, request, 'publish a World seed room');
    const activated = await activateWorldFromSeed(env, grantId, auth);
    const snapshot = activated.room.published ?? activated.room.draft;
    await awardRoomPublishPoints(env, auth.user.id, snapshot.id, snapshot.version, {
      hasGoal: snapshot.goal !== null,
      hasPriorGoalPublish: false,
    });
    await awardRoomPublishProgression(env, {
      userId: auth.user.id,
      roomId: snapshot.id,
      roomVersion: snapshot.version,
      publishedSnapshot: snapshot,
      previousPublishedSnapshot: null,
      hasGoal: snapshot.goal !== null,
      hasPriorGoalPublish: false,
      publishedAt: snapshot.publishedAt ?? new Date().toISOString(),
    });
    await upsertUserStats(env, auth.user.id);
    schedulePlayableContentIndexRefresh(context, refreshPlayableContentIndexForRoom(env, snapshot.id));
    return jsonResponse(request, activated, { status: 201 });
  }

  throw new HttpError(404, 'World grant route not found.');
}

function parseWorldNumber(value: string): number {
  if (!/^(0|[1-9]\d*)$/.test(value)) throw new HttpError(400, 'World number must be a non-negative integer.');
  const number = Number(value);
  if (!Number.isSafeInteger(number)) throw new HttpError(400, 'World number is too large.');
  return number;
}

function parseMembershipAction(value: unknown): MembershipAction {
  if (value === 'approve' || value === 'remove' || value === 'block' || value === 'promote' || value === 'demote') {
    return value;
  }
  throw new HttpError(400, 'action must be approve, remove, block, promote, or demote.');
}
