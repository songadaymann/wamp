import type {
  BackgroundImageListResponse,
  BackgroundImageModerationStatus,
  BackgroundImageStatus,
  BackgroundImageSummary,
  BackgroundUploadFinalizeResponse,
  BackgroundUploadPolicy,
  BackgroundUploadPrepareResponse,
} from '../../../backgrounds/client';
import { buildCustomBackgroundValue, parseCustomBackgroundId } from '../../../backgrounds/model';
import type { TrustTier } from '../../../progression/model';
import {
  loadOptionalRequestAuth,
  requireAdminRequest,
  requireAuthenticatedRequestAuth,
} from '../auth/request';
import { corsHeaders, HttpError, isRoomSnapshot, jsonResponse, parseJsonBody } from '../core/http';
import type {
  BackgroundImageUploadRow,
  BackgroundUploadPermissionRow,
  Env,
  RequestAuth,
} from '../core/types';
import { resolveRoomCapabilities } from '../progression/store';

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
const DEFAULT_MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
const DEFAULT_MIN_TRUST_TIER: TrustTier = 'T2';
const DEFAULT_OPENROUTER_IMAGE_MODERATION_MODEL = 'gemini-2.0-flash-lite';
const OPENROUTER_CHAT_COMPLETIONS_URL = 'https://openrouter.ai/api/v1/chat/completions';
const IMAGE_MODERATION_PROMPT =
  'Classify this game background upload for safety review. Return only compact JSON with numeric 0..1 fields adultSexual, pornography, suggestive, graphicViolence, suspectedMinorSexualContent, confidence; a string decision pass, review, or block; an array labels; and a short non-explicit reason. Do not describe explicit visual details.';
const MODERATION_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    adultSexual: { type: 'number', minimum: 0, maximum: 1 },
    pornography: { type: 'number', minimum: 0, maximum: 1 },
    suggestive: { type: 'number', minimum: 0, maximum: 1 },
    graphicViolence: { type: 'number', minimum: 0, maximum: 1 },
    suspectedMinorSexualContent: { type: 'number', minimum: 0, maximum: 1 },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    decision: { type: 'string', enum: ['pass', 'review', 'block'] },
    labels: { type: 'array', items: { type: 'string' }, maxItems: 12 },
    reason: { type: 'string' },
  },
  required: [
    'adultSexual',
    'pornography',
    'suggestive',
    'graphicViolence',
    'suspectedMinorSexualContent',
    'confidence',
    'decision',
    'labels',
    'reason',
  ],
  additionalProperties: false,
} as const;
const TRUST_TIERS: TrustTier[] = ['T0', 'T1', 'T2', 'T3', 'T4'];

interface PrepareUploadBody {
  filename?: unknown;
  contentType?: unknown;
  sizeBytes?: unknown;
}

interface ReviewBody {
  decision?: unknown;
  reason?: unknown;
  operatorLabel?: unknown;
}

interface PermissionBody {
  canUpload?: unknown;
  autoApprove?: unknown;
  reason?: unknown;
  operatorLabel?: unknown;
}

interface CloudflareDirectUploadResponse {
  success?: boolean;
  errors?: Array<{ message?: string }>;
  result?: {
    id?: string;
    uploadURL?: string;
  };
}

interface CloudflareImageDetailsResponse {
  success?: boolean;
  errors?: Array<{ message?: string }>;
  result?: {
    id?: string;
    filename?: string;
    uploaded?: string;
    draft?: boolean;
    meta?: Record<string, unknown>;
  };
}

interface OpenRouterChatCompletionResponse {
  error?: {
    message?: string;
  };
  choices?: Array<{
    message?: {
      content?: string | Array<{ text?: string }>;
    };
    finish_reason?: string;
  }>;
}

interface ModerationResult {
  status: BackgroundImageModerationStatus;
  score: number | null;
  labels: string[];
  reason: string | null;
  model: string | null;
  passed: boolean;
  blocked: boolean;
}

export async function handleBackgroundImageRequest(
  request: Request,
  url: URL,
  env: Env,
): Promise<Response> {
  if (url.pathname === '/api/background-images' && request.method === 'GET') {
    return handleBackgroundImageList(request, env);
  }

  if (url.pathname === '/api/background-images/uploads' && request.method === 'POST') {
    return handleBackgroundImageUploadPrepare(request, env);
  }

  const finalizeMatch = /^\/api\/background-images\/([^/]+)\/finalize$/.exec(url.pathname);
  if (finalizeMatch && request.method === 'POST') {
    return handleBackgroundImageFinalize(request, env, decodeURIComponent(finalizeMatch[1]));
  }

  const imageMatch = /^\/api\/background-images\/([^/]+)\/image$/.exec(url.pathname);
  if (imageMatch && (request.method === 'GET' || request.method === 'HEAD')) {
    return handleBackgroundImageServe(
      request,
      url,
      env,
      decodeURIComponent(imageMatch[1]),
      false,
    );
  }

  throw new HttpError(404, 'Background image route not found.');
}

export async function handleAdminBackgroundImageRequest(
  request: Request,
  url: URL,
  env: Env,
): Promise<Response> {
  if (url.pathname === '/api/admin/background-images' && request.method === 'GET') {
    return handleAdminBackgroundImageList(request, url, env);
  }

  const adminImageMatch = /^\/api\/admin\/background-images\/([^/]+)\/image$/.exec(url.pathname);
  if (adminImageMatch && (request.method === 'GET' || request.method === 'HEAD')) {
    requireAdminRequest(env, request, 'view background upload image');
    return handleBackgroundImageServe(
      request,
      url,
      env,
      decodeURIComponent(adminImageMatch[1]),
      true,
    );
  }

  const reviewMatch = /^\/api\/admin\/background-images\/([^/]+)\/review$/.exec(url.pathname);
  if (reviewMatch && request.method === 'POST') {
    return handleAdminBackgroundImageReview(request, env, decodeURIComponent(reviewMatch[1]));
  }

  const permissionMatch = /^\/api\/admin\/background-images\/permissions\/([^/]+)$/.exec(url.pathname);
  if (permissionMatch && request.method === 'GET') {
    return handleAdminBackgroundPermissionGet(request, env, decodeURIComponent(permissionMatch[1]));
  }
  if (permissionMatch && request.method === 'POST') {
    return handleAdminBackgroundPermissionUpdate(request, env, decodeURIComponent(permissionMatch[1]));
  }

  throw new HttpError(404, 'Background image admin route not found.');
}

export async function assertCustomBackgroundApproved(env: Env, background: string): Promise<void> {
  const id = parseCustomBackgroundId(background);
  if (!id) {
    return;
  }

  const row = await loadBackgroundImageRow(env, id);
  if (!row || row.status !== 'approved' || row.cloudflare_deleted_at) {
    throw new HttpError(400, 'Custom background must be approved before it can be used.');
  }
}

async function handleBackgroundImageList(
  request: Request,
  env: Env,
): Promise<Response> {
  const auth = await loadOptionalRequestAuth(env, request);
  const uploadPolicy = await buildUploadPolicy(env, auth);
  const approvedRows = await env.DB.prepare(
    `
      SELECT *
      FROM background_image_uploads
      WHERE status = 'approved'
        AND cloudflare_deleted_at IS NULL
      ORDER BY reviewed_at DESC, created_at DESC
      LIMIT 120
    `,
  ).all<BackgroundImageUploadRow>();

  const myUploads = auth
    ? await env.DB.prepare(
      `
        SELECT *
        FROM background_image_uploads
        WHERE owner_user_id = ?
        ORDER BY created_at DESC
        LIMIT 24
      `,
    )
      .bind(auth.user.id)
      .all<BackgroundImageUploadRow>()
    : { results: [] as BackgroundImageUploadRow[] };
  const usageCounts = await loadBackgroundUsageCounts(
    env,
    approvedRows.results.map((row) => row.id),
  );

  const response: BackgroundImageListResponse = {
    items: approvedRows.results.map((row) => serializeBackgroundImage(request, env, row, false, usageCounts)),
    myUploads: myUploads.results.map((row) => serializeBackgroundImage(request, env, row, false, usageCounts)),
    uploadPolicy,
  };
  return jsonResponse(request, response);
}

async function handleBackgroundImageUploadPrepare(
  request: Request,
  env: Env,
): Promise<Response> {
  const auth = await requireAuthenticatedRequestAuth(
    env,
    request,
    'upload background images',
    'rooms:write',
  );
  const policy = await buildUploadPolicy(env, auth);
  if (!policy.configured) {
    throw new HttpError(503, 'Background uploads are not configured yet.');
  }
  if (!policy.canUpload) {
    throw new HttpError(403, policy.reason ?? 'This account cannot upload background images yet.');
  }

  const body = await parseJsonBody<PrepareUploadBody>(request);
  const filename = normalizeFilename(body.filename);
  const contentType = normalizeMimeType(body.contentType);
  const sizeBytes = normalizeUploadSize(body.sizeBytes, policy.maxBytes);

  const directUpload = await createCloudflareDirectUpload(env, auth.user.id, filename);
  const now = new Date().toISOString();
  await env.DB.prepare(
    `
      INSERT INTO background_image_uploads (
        id,
        cloudflare_image_id,
        owner_user_id,
        owner_display_name,
        original_filename,
        mime_type,
        size_bytes,
        status,
        moderation_status,
        upload_requested_at,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, 'upload_pending', 'not_run', ?, ?, ?)
    `,
  )
    .bind(
      directUpload.id,
      directUpload.id,
      auth.user.id,
      auth.user.displayName ?? auth.user.email ?? 'Builder',
      filename,
      contentType,
      sizeBytes,
      now,
      now,
      now,
    )
    .all();

  const response: BackgroundUploadPrepareResponse = {
    id: directUpload.id,
    uploadUrl: directUpload.uploadUrl,
    maxBytes: policy.maxBytes,
    allowedMimeTypes: [...ALLOWED_MIME_TYPES],
  };
  return jsonResponse(request, response);
}

async function handleBackgroundImageFinalize(
  request: Request,
  env: Env,
  id: string,
): Promise<Response> {
  const auth = await requireAuthenticatedRequestAuth(
    env,
    request,
    'finalize background image uploads',
    'rooms:write',
  );
  const row = await loadBackgroundImageRow(env, id);
  if (!row) {
    throw new HttpError(404, 'Background upload not found.');
  }
  if (row.owner_user_id !== auth.user.id && !auth.isAdmin) {
    throw new HttpError(403, 'Only the uploader can finalize this background upload.');
  }

  const details = await loadCloudflareImageDetails(env, row.cloudflare_image_id);
  if (details.draft === true || !details.uploaded) {
    throw new HttpError(409, 'Cloudflare has not finished receiving this upload yet.');
  }

  const policy = await buildUploadPolicy(env, auth);
  const moderation = await moderateUploadedImage(env, row);
  const nextStatus: BackgroundImageStatus = moderation.blocked
    ? 'blocked'
    : moderation.passed && policy.autoApproveEligible
      ? 'approved'
      : 'pending_review';
  const now = new Date().toISOString();

  if (nextStatus === 'blocked') {
    await deleteCloudflareImage(env, row.cloudflare_image_id);
  }

  await env.DB.prepare(
    `
      UPDATE background_image_uploads
      SET
        status = ?,
        moderation_status = ?,
        moderation_score = ?,
        moderation_labels_json = ?,
        moderation_reason = ?,
        moderation_model = ?,
        uploaded_at = COALESCE(uploaded_at, ?),
        reviewed_at = CASE WHEN ? = 'approved' THEN ? ELSE reviewed_at END,
        reviewed_by = CASE WHEN ? = 'approved' THEN ? ELSE reviewed_by END,
        review_reason = CASE WHEN ? = 'approved' THEN ? ELSE review_reason END,
        cloudflare_deleted_at = CASE WHEN ? = 'blocked' THEN ? ELSE cloudflare_deleted_at END,
        updated_at = ?
      WHERE id = ?
    `,
  )
    .bind(
      nextStatus,
      moderation.status,
      moderation.score,
      JSON.stringify(moderation.labels),
      moderation.reason,
      moderation.model,
      now,
      nextStatus,
      now,
      nextStatus,
      'auto-moderation',
      nextStatus,
      'Clean automated moderation and auto-approve policy matched.',
      nextStatus,
      now,
      now,
      row.id,
    )
    .all();

  const updated = await loadBackgroundImageRow(env, row.id);
  if (!updated) {
    throw new HttpError(500, 'Background upload disappeared after finalization.');
  }

  const response: BackgroundUploadFinalizeResponse = {
    item: serializeBackgroundImage(request, env, updated, false),
    selectedBackgroundValue: updated.status === 'approved'
      ? buildCustomBackgroundValue(updated.id)
      : null,
    message: getFinalizeMessage(updated),
  };
  return jsonResponse(request, response);
}

async function handleBackgroundImageServe(
  request: Request,
  url: URL,
  env: Env,
  id: string,
  admin: boolean,
): Promise<Response> {
  const row = await loadBackgroundImageRow(env, id);
  if (!row) {
    throw new HttpError(404, 'Background image not found.');
  }
  if (row.cloudflare_deleted_at) {
    throw new HttpError(410, 'Background image was removed.');
  }
  if (!admin && row.status !== 'approved') {
    throw new HttpError(404, 'Background image not found.');
  }
  if (admin && row.status === 'blocked') {
    throw new HttpError(403, 'Blocked background images are not shown in the review console.');
  }

  return proxyCloudflareDeliveryImage(
    request,
    env,
    row.cloudflare_image_id,
    url.searchParams.get('variant') === 'thumbnail' ? 'thumbnail' : 'image',
    row.mime_type,
  );
}

async function proxyCloudflareDeliveryImage(
  request: Request,
  env: Env,
  imageId: string,
  kind: 'image' | 'thumbnail',
  fallbackMimeType: string,
): Promise<Response> {
  const deliveryHeaders = new Headers();
  for (const name of ['Accept', 'If-Modified-Since', 'If-None-Match', 'Range']) {
    const value = request.headers.get(name);
    if (value) {
      deliveryHeaders.set(name, value);
    }
  }

  const deliveryResponse = await fetch(buildCloudflareDeliveryUrl(env, imageId, kind), {
    method: 'GET',
    headers: deliveryHeaders,
  });
  if (!deliveryResponse.ok && deliveryResponse.status !== 304) {
    throw new HttpError(502, 'Cloudflare image delivery failed.');
  }

  const headers = new Headers();
  for (const name of [
    'Content-Type',
    'Cache-Control',
    'ETag',
    'Last-Modified',
    'Expires',
    'Accept-Ranges',
    'Content-Range',
  ]) {
    const value = deliveryResponse.headers.get(name);
    if (value) {
      headers.set(name, value);
    }
  }
  if (!headers.has('Content-Type')) {
    headers.set('Content-Type', fallbackMimeType || 'image/jpeg');
  }
  if (!headers.has('Cache-Control')) {
    headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  }

  for (const [key, value] of Object.entries(corsHeaders(request))) {
    headers.set(key, value);
  }

  return new Response(
    request.method === 'HEAD' || deliveryResponse.status === 304 ? null : deliveryResponse.body,
    {
      status: deliveryResponse.status,
      statusText: deliveryResponse.statusText,
      headers,
    },
  );
}

async function handleAdminBackgroundImageList(
  request: Request,
  url: URL,
  env: Env,
): Promise<Response> {
  requireAdminRequest(env, request, 'list background image uploads');
  const status = normalizeAdminStatusFilter(url.searchParams.get('status'));
  const query = status === 'all'
    ? `
      SELECT *
      FROM background_image_uploads
      ORDER BY created_at DESC
      LIMIT 120
    `
    : `
      SELECT *
      FROM background_image_uploads
      WHERE status = ?
      ORDER BY created_at DESC
      LIMIT 120
    `;
  const result = status === 'all'
    ? await env.DB.prepare(query).all<BackgroundImageUploadRow>()
    : await env.DB.prepare(query).bind(status).all<BackgroundImageUploadRow>();

  return jsonResponse(request, {
    items: result.results.map((row) => serializeBackgroundImage(request, env, row, true)),
  });
}

async function handleAdminBackgroundImageReview(
  request: Request,
  env: Env,
  id: string,
): Promise<Response> {
  requireAdminRequest(env, request, `review background image ${id}`);
  const row = await loadBackgroundImageRow(env, id);
  if (!row) {
    throw new HttpError(404, 'Background upload not found.');
  }

  const body = await parseJsonBody<ReviewBody>(request);
  const decision = body.decision === 'approved' ? 'approved' : body.decision === 'rejected' ? 'rejected' : null;
  if (!decision) {
    throw new HttpError(400, 'decision must be approved or rejected.');
  }
  if (row.status === 'blocked' && decision === 'approved') {
    throw new HttpError(409, 'Blocked uploads cannot be approved from this console.');
  }

  const reason = normalizeOptionalText(body.reason, 500);
  const operatorLabel = normalizeOptionalText(body.operatorLabel, 80) ?? 'Admin';
  const now = new Date().toISOString();
  await env.DB.prepare(
    `
      UPDATE background_image_uploads
      SET
        status = ?,
        reviewed_at = ?,
        reviewed_by = ?,
        review_reason = ?,
        updated_at = ?
      WHERE id = ?
    `,
  )
    .bind(decision, now, operatorLabel, reason, now, row.id)
    .all();

  const updated = await loadBackgroundImageRow(env, row.id);
  return jsonResponse(request, {
    ok: true,
    item: updated ? serializeBackgroundImage(request, env, updated, true) : null,
  });
}

async function handleAdminBackgroundPermissionGet(
  request: Request,
  env: Env,
  userId: string,
): Promise<Response> {
  requireAdminRequest(env, request, `read background upload permission for ${userId}`);
  return jsonResponse(request, await loadPermissionAdminResponse(env, userId));
}

async function handleAdminBackgroundPermissionUpdate(
  request: Request,
  env: Env,
  userId: string,
): Promise<Response> {
  requireAdminRequest(env, request, `update background upload permission for ${userId}`);
  const body = await parseJsonBody<PermissionBody>(request);
  if (typeof body.canUpload !== 'boolean') {
    throw new HttpError(400, 'canUpload must be true or false.');
  }
  if (typeof body.autoApprove !== 'boolean') {
    throw new HttpError(400, 'autoApprove must be true or false.');
  }

  const user = await loadUserIdentity(env, userId);
  if (!user) {
    throw new HttpError(404, 'User not found.');
  }

  const reason = normalizeOptionalText(body.reason, 500);
  const operatorLabel = normalizeOptionalText(body.operatorLabel, 80) ?? 'Admin';
  const now = new Date().toISOString();
  await env.DB.prepare(
    `
      INSERT INTO background_upload_permissions (
        user_id,
        can_upload,
        auto_approve,
        reason,
        updated_by,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        can_upload = excluded.can_upload,
        auto_approve = excluded.auto_approve,
        reason = excluded.reason,
        updated_by = excluded.updated_by,
        updated_at = excluded.updated_at
    `,
  )
    .bind(
      userId,
      body.canUpload ? 1 : 0,
      body.autoApprove ? 1 : 0,
      reason,
      operatorLabel,
      now,
    )
    .all();

  return jsonResponse(request, await loadPermissionAdminResponse(env, userId));
}

async function buildUploadPolicy(
  env: Env,
  auth: RequestAuth | null,
): Promise<BackgroundUploadPolicy> {
  const configured = isCloudflareImagesConfigured(env);
  const maxBytes = parsePositiveInteger(env.BACKGROUND_UPLOAD_MAX_BYTES, DEFAULT_MAX_UPLOAD_BYTES);
  const minTrustTier = parseTrustTier(env.BACKGROUND_UPLOAD_MIN_TRUST_TIER, DEFAULT_MIN_TRUST_TIER);

  if (!auth) {
    return {
      authenticated: false,
      configured,
      trustTier: null,
      minTrustTier,
      canUpload: false,
      autoApproveEligible: false,
      maxBytes,
      allowedMimeTypes: [...ALLOWED_MIME_TYPES],
      reason: 'Sign in to upload backgrounds.',
    };
  }

  const [capabilities, permission] = await Promise.all([
    resolveRoomCapabilities(env, auth.user.id, auth.source),
    loadBackgroundUploadPermission(env, auth.user.id),
  ]);
  const trustTier = parseTrustTier(capabilities.trustTier, 'T0');
  const trustedEnough = compareTrustTier(trustTier, minTrustTier) >= 0;
  const canUpload = permission
    ? permission.can_upload === 1
    : trustedEnough;
  const autoApproveTrustTier = parseOptionalTrustTier(env.BACKGROUND_UPLOAD_AUTO_APPROVE_TRUST_TIER);
  const autoApproveEligible = permission?.auto_approve === 1 ||
    (autoApproveTrustTier !== null && compareTrustTier(trustTier, autoApproveTrustTier) >= 0);

  return {
    authenticated: true,
    configured,
    trustTier,
    minTrustTier,
    canUpload: configured && canUpload,
    autoApproveEligible: configured && autoApproveEligible,
    maxBytes,
    allowedMimeTypes: [...ALLOWED_MIME_TYPES],
    reason: configured
      ? canUpload
        ? null
        : `Background uploads open at trust tier ${minTrustTier}.`
      : 'Background uploads are not configured yet.',
  };
}

function serializeBackgroundImage(
  request: Request,
  env: Env,
  row: BackgroundImageUploadRow,
  admin: boolean,
  usageCounts: Map<string, number> = new Map(),
): BackgroundImageSummary {
  const visible = row.cloudflare_deleted_at === null && (row.status === 'approved' || admin);
  const adminBase = admin ? '/api/admin/background-images' : '/api/background-images';
  const imageUrl = visible && !(admin && row.status === 'blocked')
    ? admin
      ? buildCloudflareDeliveryUrl(env, row.cloudflare_image_id, 'image')
      : `${getRequestOrigin(request)}${adminBase}/${encodeURIComponent(row.id)}/image`
    : null;
  const thumbnailUrl = visible && !(admin && row.status === 'blocked')
    ? admin
      ? buildCloudflareDeliveryUrl(env, row.cloudflare_image_id, 'thumbnail')
      : `${imageUrl}?variant=thumbnail`
    : null;

  return {
    id: row.id,
    backgroundValue: buildCustomBackgroundValue(row.id),
    ownerUserId: row.owner_user_id,
    ownerDisplayName: row.owner_display_name,
    filename: row.original_filename,
    mimeType: row.mime_type,
    sizeBytes: Number(row.size_bytes),
    status: normalizeStatus(row.status),
    moderationStatus: normalizeModerationStatus(row.moderation_status),
    moderationScore: row.moderation_score === null ? null : Number(row.moderation_score),
    moderationLabels: parseLabels(row.moderation_labels_json),
    moderationReason: row.moderation_reason,
    usageCount: usageCounts.get(row.id) ?? 0,
    imageUrl,
    thumbnailUrl,
    createdAt: row.created_at,
    uploadedAt: row.uploaded_at,
    reviewedAt: row.reviewed_at,
  };
}

async function loadBackgroundUsageCounts(env: Env, ids: string[]): Promise<Map<string, number>> {
  const wantedIds = new Set(ids);
  const counts = new Map<string, number>();
  if (wantedIds.size === 0) {
    return counts;
  }

  const result = await env.DB.prepare(
    `
      SELECT id, draft_json, published_json
      FROM rooms
      WHERE draft_json LIKE '%custom:%'
         OR published_json LIKE '%custom:%'
    `,
  ).all<{
    id: string;
    draft_json: string;
    published_json: string | null;
  }>();

  for (const row of result.results) {
    const roomBackgroundIds = new Set<string>();
    for (const rawSnapshot of [row.draft_json, row.published_json]) {
      if (!rawSnapshot) {
        continue;
      }
      try {
        const snapshot = JSON.parse(rawSnapshot) as unknown;
        if (!isRoomSnapshot(snapshot)) {
          continue;
        }
        const id = parseCustomBackgroundId(snapshot.background);
        if (id && wantedIds.has(id)) {
          roomBackgroundIds.add(id);
        }
      } catch {
        continue;
      }
    }

    for (const id of roomBackgroundIds) {
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
  }

  return counts;
}

async function moderateUploadedImage(
  env: Env,
  row: BackgroundImageUploadRow,
): Promise<ModerationResult> {
  const apiKey = env.OPENROUTER_API_KEY?.trim();
  const model = normalizeOpenRouterModel(
    env.OPENROUTER_IMAGE_MODERATION_MODEL?.trim() || DEFAULT_OPENROUTER_IMAGE_MODERATION_MODEL,
  );
  if (!apiKey) {
    return {
      status: 'not_configured',
      score: null,
      labels: [],
      reason: 'OpenRouter moderation is not configured.',
      model: null,
      passed: false,
      blocked: false,
    };
  }

  try {
    const imageUrl = buildCloudflareDeliveryUrl(env, row.cloudflare_image_id, 'image');
    const openRouterResponse = await fetch(OPENROUTER_CHAT_COMPLETIONS_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: IMAGE_MODERATION_PROMPT,
              },
              {
                type: 'image_url',
                image_url: {
                  url: imageUrl,
                },
              },
            ],
          },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'background_upload_moderation',
            strict: true,
            schema: MODERATION_RESPONSE_SCHEMA,
          },
        },
        temperature: 0,
        stream: false,
      }),
    });

    const payload = await openRouterResponse.json() as OpenRouterChatCompletionResponse;
    if (!openRouterResponse.ok || payload.error) {
      throw new Error(payload.error?.message || `OpenRouter request failed with status ${openRouterResponse.status}.`);
    }

    const text = readOpenRouterMessageText(payload).trim();
    if (!text) {
      return {
        status: 'flagged',
        score: 1,
        labels: ['model_safety_blocked_or_empty'],
        reason: 'Moderation model returned no usable classification. Human review required.',
        model,
        passed: false,
        blocked: false,
      };
    }

    const parsed = parseModerationJson(text);
    const adultSexual = readScore(parsed.adultSexual);
    const pornography = readScore(parsed.pornography);
    const suggestive = readScore(parsed.suggestive);
    const graphicViolence = readScore(parsed.graphicViolence);
    const suspectedMinorSexualContent = readScore(parsed.suspectedMinorSexualContent);
    const score = Math.max(
      adultSexual,
      pornography,
      suggestive,
      graphicViolence,
      suspectedMinorSexualContent,
    );
    const rawLabels = Array.isArray(parsed.labels)
      ? parsed.labels.filter((label): label is string => typeof label === 'string')
      : [];
    const labels = rawLabels.slice(0, 12);
    const decision = typeof parsed.decision === 'string' ? parsed.decision.toLowerCase() : '';
    const flagged =
      adultSexual >= 0.9 ||
      pornography >= 0.9 ||
      suggestive >= 0.9 ||
      graphicViolence >= 0.9 ||
      suspectedMinorSexualContent >= 0.5 ||
      decision === 'review' ||
      decision === 'block';

    return {
      status: flagged ? 'flagged' : 'passed',
      score,
      labels,
      reason: normalizeOptionalText(parsed.reason, 300),
      model,
      passed: !flagged,
      blocked: false,
    };
  } catch (error) {
    return {
      status: 'error',
      score: null,
      labels: ['moderation_error'],
      reason: error instanceof Error ? error.message.slice(0, 300) : 'Unknown moderation error.',
      model,
      passed: false,
      blocked: false,
    };
  }
}

async function createCloudflareDirectUpload(
  env: Env,
  userId: string,
  filename: string,
): Promise<{ id: string; uploadUrl: string }> {
  const accountId = requireEnv(env.CLOUDFLARE_ACCOUNT_ID, 'CLOUDFLARE_ACCOUNT_ID');
  const token = requireEnv(env.CLOUDFLARE_IMAGES_API_TOKEN, 'CLOUDFLARE_IMAGES_API_TOKEN');
  const form = new FormData();
  form.append('requireSignedURLs', 'false');
  form.append('metadata', JSON.stringify({ userId, filename }));

  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/images/v2/direct_upload`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
      },
      body: form,
    },
  );
  const payload = await response.json() as CloudflareDirectUploadResponse;
  if (!response.ok || payload.success === false || !payload.result?.id || !payload.result.uploadURL) {
    throw new HttpError(502, getCloudflareErrorMessage(payload, 'Cloudflare direct upload failed.'));
  }

  return {
    id: payload.result.id,
    uploadUrl: payload.result.uploadURL,
  };
}

async function loadCloudflareImageDetails(
  env: Env,
  imageId: string,
): Promise<NonNullable<CloudflareImageDetailsResponse['result']>> {
  const accountId = requireEnv(env.CLOUDFLARE_ACCOUNT_ID, 'CLOUDFLARE_ACCOUNT_ID');
  const token = requireEnv(env.CLOUDFLARE_IMAGES_API_TOKEN, 'CLOUDFLARE_IMAGES_API_TOKEN');
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/images/v1/${encodeURIComponent(imageId)}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  );
  const payload = await response.json() as CloudflareImageDetailsResponse;
  if (!response.ok || payload.success === false || !payload.result) {
    throw new HttpError(502, getCloudflareErrorMessage(payload, 'Cloudflare image lookup failed.'));
  }
  return payload.result;
}

async function deleteCloudflareImage(env: Env, imageId: string): Promise<void> {
  const accountId = env.CLOUDFLARE_ACCOUNT_ID?.trim();
  const token = env.CLOUDFLARE_IMAGES_API_TOKEN?.trim();
  if (!accountId || !token) {
    return;
  }
  await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/images/v1/${encodeURIComponent(imageId)}`,
    {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  );
}

function buildCloudflareDeliveryUrl(
  env: Env,
  imageId: string,
  kind: 'image' | 'thumbnail',
): string {
  const accountHash = requireEnv(env.CLOUDFLARE_IMAGES_ACCOUNT_HASH, 'CLOUDFLARE_IMAGES_ACCOUNT_HASH');
  const variant = kind === 'thumbnail'
    ? env.CLOUDFLARE_IMAGES_THUMB_VARIANT?.trim() || env.CLOUDFLARE_IMAGES_BACKGROUND_VARIANT?.trim() || 'public'
    : env.CLOUDFLARE_IMAGES_BACKGROUND_VARIANT?.trim() || 'public';
  return `https://imagedelivery.net/${encodeURIComponent(accountHash)}/${encodeURIComponent(imageId)}/${encodeURIComponent(variant)}`;
}

async function loadBackgroundImageRow(env: Env, id: string): Promise<BackgroundImageUploadRow | null> {
  return env.DB.prepare(
    `
      SELECT *
      FROM background_image_uploads
      WHERE id = ?
      LIMIT 1
    `,
  )
    .bind(id)
    .first<BackgroundImageUploadRow>();
}

async function loadBackgroundUploadPermission(
  env: Env,
  userId: string,
): Promise<BackgroundUploadPermissionRow | null> {
  return env.DB.prepare(
    `
      SELECT *
      FROM background_upload_permissions
      WHERE user_id = ?
      LIMIT 1
    `,
  )
    .bind(userId)
    .first<BackgroundUploadPermissionRow>();
}

async function loadPermissionAdminResponse(env: Env, userId: string): Promise<unknown> {
  const [user, permission] = await Promise.all([
    loadUserIdentity(env, userId),
    loadBackgroundUploadPermission(env, userId),
  ]);
  if (!user) {
    throw new HttpError(404, 'User not found.');
  }

  const capabilities = await resolveRoomCapabilities(env, userId, null);
  return {
    user,
    trustTier: capabilities.trustTier,
    permission: permission
      ? {
        canUpload: permission.can_upload === 1,
        autoApprove: permission.auto_approve === 1,
        reason: permission.reason,
        updatedBy: permission.updated_by,
        updatedAt: permission.updated_at,
      }
      : null,
  };
}

async function loadUserIdentity(env: Env, userId: string): Promise<{
  userId: string;
  displayName: string;
  email: string | null;
} | null> {
  const row = await env.DB.prepare(
    `
      SELECT id, display_name, email
      FROM users
      WHERE id = ?
      LIMIT 1
    `,
  )
    .bind(userId)
    .first<{ id: string; display_name: string; email: string | null }>();
  return row
    ? {
      userId: row.id,
      displayName: row.display_name,
      email: row.email,
    }
    : null;
}

function normalizeFilename(value: unknown): string {
  const filename = typeof value === 'string' ? value.trim() : '';
  if (!filename) {
    return 'background-upload';
  }
  return filename.replace(/[^\w .()_-]+/g, '').slice(0, 120) || 'background-upload';
}

function normalizeMimeType(value: unknown): string {
  const mimeType = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!ALLOWED_MIME_TYPES.includes(mimeType as typeof ALLOWED_MIME_TYPES[number])) {
    throw new HttpError(400, 'Background image must be a JPG, PNG, or WebP file.');
  }
  return mimeType;
}

function normalizeUploadSize(value: unknown, maxBytes: number): number {
  const sizeBytes = typeof value === 'number' ? Math.round(value) : Number(value);
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
    throw new HttpError(400, 'sizeBytes must be a positive number.');
  }
  if (sizeBytes > maxBytes) {
    throw new HttpError(413, `Background image must be ${formatBytes(maxBytes)} or smaller.`);
  }
  return sizeBytes;
}

function normalizeOptionalText(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : null;
}

function normalizeAdminStatusFilter(value: string | null): BackgroundImageStatus | 'all' {
  if (
    value === 'upload_pending' ||
    value === 'pending_review' ||
    value === 'approved' ||
    value === 'rejected' ||
    value === 'blocked' ||
    value === 'all'
  ) {
    return value;
  }
  return 'pending_review';
}

function normalizeStatus(value: string): BackgroundImageStatus {
  return normalizeAdminStatusFilter(value) === 'all'
    ? 'pending_review'
    : normalizeAdminStatusFilter(value) as BackgroundImageStatus;
}

function normalizeModerationStatus(value: string): BackgroundImageModerationStatus {
  if (
    value === 'not_run' ||
    value === 'not_configured' ||
    value === 'passed' ||
    value === 'flagged' ||
    value === 'blocked' ||
    value === 'error'
  ) {
    return value;
  }
  return 'not_run';
}

function parseLabels(value: string | null): string[] {
  if (!value) {
    return [];
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string').slice(0, 12)
      : [];
  } catch {
    return [];
  }
}

function getFinalizeMessage(row: BackgroundImageUploadRow): string {
  if (row.status === 'approved') {
    return 'Background approved and ready to use.';
  }
  if (row.status === 'blocked') {
    return 'Upload was blocked by the safety filter.';
  }
  return 'Background uploaded and waiting for review.';
}

function getRequestOrigin(request: Request): string {
  const url = new URL(request.url);
  return `${url.protocol}//${url.host}`;
}

function isCloudflareImagesConfigured(env: Env): boolean {
  return Boolean(
    env.CLOUDFLARE_ACCOUNT_ID?.trim() &&
    env.CLOUDFLARE_IMAGES_API_TOKEN?.trim() &&
    env.CLOUDFLARE_IMAGES_ACCOUNT_HASH?.trim()
  );
}

function requireEnv(value: string | undefined, name: string): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    throw new HttpError(503, `${name} is not configured.`);
  }
  return trimmed;
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseTrustTier(value: string | undefined, fallback: TrustTier): TrustTier {
  return normalizeTrustTier(value) ?? fallback;
}

function parseOptionalTrustTier(value: string | undefined): TrustTier | null {
  return normalizeTrustTier(value);
}

function normalizeTrustTier(value: string | undefined): TrustTier | null {
  const normalized = value?.trim().toUpperCase();
  return TRUST_TIERS.includes(normalized as TrustTier) ? normalized as TrustTier : null;
}

function compareTrustTier(left: TrustTier, right: TrustTier): number {
  return TRUST_TIERS.indexOf(left) - TRUST_TIERS.indexOf(right);
}

function formatBytes(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(mb >= 10 ? 0 : 1)} MB`;
}

function getCloudflareErrorMessage(
  payload: CloudflareDirectUploadResponse | CloudflareImageDetailsResponse,
  fallback: string,
): string {
  return payload.errors
    ?.map((error) => error.message)
    .filter((message): message is string => Boolean(message))
    .join(' ')
    || fallback;
}

function normalizeOpenRouterModel(model: string): string {
  const trimmed = model.trim();
  if (!trimmed) {
    return `google/${DEFAULT_OPENROUTER_IMAGE_MODERATION_MODEL}`;
  }
  if (trimmed.includes('/')) {
    return trimmed;
  }
  if (trimmed.startsWith('gemini-')) {
    return `google/${trimmed}`;
  }
  return trimmed;
}

function readOpenRouterMessageText(payload: OpenRouterChatCompletionResponse): string {
  const content = payload.choices?.[0]?.message?.content;
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
    return content.map((part) => part.text ?? '').join('');
  }
  return '';
}

function parseModerationJson(text: string): Record<string, unknown> {
  const trimmed = text.trim();
  const jsonText = trimmed.startsWith('{')
    ? trimmed
    : trimmed.slice(Math.max(0, trimmed.indexOf('{')), trimmed.lastIndexOf('}') + 1);
  if (!jsonText) {
    return {};
  }
  try {
    return JSON.parse(jsonText) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function readScore(value: unknown): number {
  const score = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(score)) {
    return 0;
  }
  return Math.max(0, Math.min(1, score));
}
