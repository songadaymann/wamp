import { HttpError, jsonResponse } from '../core/http';
import type { Env } from '../core/types';
import {
  loadExpandedRoomTarget,
  resolveExpandedRoomAtCoordinates,
} from './store';

export async function handleExpandedRoomGet(
  request: Request,
  env: Env,
  expandedRoomId: string
): Promise<Response> {
  const target = await loadExpandedRoomTarget(env, expandedRoomId);
  if (!target) {
    throw new HttpError(404, 'Expanded room not found.');
  }

  return jsonResponse(request, target);
}

export async function handleExpandedRoomByCoordinateGet(
  request: Request,
  env: Env,
  xRaw: string,
  yRaw: string
): Promise<Response> {
  const coordinates = {
    x: parseIntegerPathSegment(xRaw, 'x'),
    y: parseIntegerPathSegment(yRaw, 'y'),
  };
  const target = await resolveExpandedRoomAtCoordinates(env, coordinates);
  if (!target) {
    throw new HttpError(404, 'Expanded room not found.');
  }

  return jsonResponse(request, target);
}

function parseIntegerPathSegment(value: string, label: string): number {
  if (!/^-?\d+$/.test(value)) {
    throw new HttpError(400, `${label} must be an integer.`);
  }

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new HttpError(400, `${label} must be a safe integer.`);
  }

  return parsed;
}
