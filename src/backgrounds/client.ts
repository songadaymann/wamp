import { getApiBaseUrl } from '../api/baseUrl';
import { buildCustomBackgroundValue } from './model';

export type BackgroundImageStatus =
  | 'upload_pending'
  | 'pending_review'
  | 'approved'
  | 'rejected'
  | 'blocked';

export type BackgroundImageModerationStatus =
  | 'not_run'
  | 'not_configured'
  | 'passed'
  | 'flagged'
  | 'blocked'
  | 'error';

export interface BackgroundImageSummary {
  id: string;
  backgroundValue: string;
  ownerUserId: string;
  ownerDisplayName: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  status: BackgroundImageStatus;
  moderationStatus: BackgroundImageModerationStatus;
  moderationScore: number | null;
  moderationLabels: string[];
  moderationReason: string | null;
  usageCount: number;
  imageUrl: string | null;
  thumbnailUrl: string | null;
  createdAt: string;
  uploadedAt: string | null;
  reviewedAt: string | null;
}

export interface BackgroundUploadPolicy {
  authenticated: boolean;
  configured: boolean;
  trustTier: string | null;
  minTrustTier: string;
  canUpload: boolean;
  autoApproveEligible: boolean;
  maxBytes: number;
  allowedMimeTypes: string[];
  reason: string | null;
}

export interface BackgroundImageListResponse {
  items: BackgroundImageSummary[];
  myUploads: BackgroundImageSummary[];
  uploadPolicy: BackgroundUploadPolicy;
}

export interface BackgroundUploadRequest {
  filename: string;
  contentType: string;
  sizeBytes: number;
}

export interface BackgroundUploadPrepareResponse {
  id: string;
  uploadUrl: string;
  maxBytes: number;
  allowedMimeTypes: string[];
}

export interface BackgroundUploadFinalizeResponse {
  item: BackgroundImageSummary;
  selectedBackgroundValue: string | null;
  message: string;
}

function buildHeaders(json = false): Headers {
  const headers = new Headers();
  if (json) {
    headers.set('Content-Type', 'application/json');
  }
  return headers;
}

async function parseJsonResponse<T>(response: Response): Promise<T> {
  if (response.ok) {
    return (await response.json()) as T;
  }

  const text = (await response.text()).trim();
  throw new Error(text || `Request failed with status ${response.status}.`);
}

export async function listBackgroundImages(): Promise<BackgroundImageListResponse> {
  const response = await fetch(`${getApiBaseUrl()}/api/background-images`, {
    credentials: 'include',
    headers: buildHeaders(),
  });
  return parseJsonResponse<BackgroundImageListResponse>(response);
}

export async function prepareBackgroundUpload(
  request: BackgroundUploadRequest,
): Promise<BackgroundUploadPrepareResponse> {
  const response = await fetch(`${getApiBaseUrl()}/api/background-images/uploads`, {
    method: 'POST',
    credentials: 'include',
    headers: buildHeaders(true),
    body: JSON.stringify(request),
  });
  return parseJsonResponse<BackgroundUploadPrepareResponse>(response);
}

export async function uploadBackgroundFile(uploadUrl: string, file: File): Promise<void> {
  const body = new FormData();
  body.append('file', file, file.name);

  const response = await fetch(uploadUrl, {
    method: 'POST',
    body,
  });

  if (!response.ok) {
    const text = (await response.text()).trim();
    throw new Error(text || `Upload failed with status ${response.status}.`);
  }
}

export async function finalizeBackgroundUpload(
  id: string,
): Promise<BackgroundUploadFinalizeResponse> {
  const response = await fetch(
    `${getApiBaseUrl()}/api/background-images/${encodeURIComponent(id)}/finalize`,
    {
      method: 'POST',
      credentials: 'include',
      headers: buildHeaders(true),
      body: JSON.stringify({}),
    },
  );
  return parseJsonResponse<BackgroundUploadFinalizeResponse>(response);
}

export function getBackgroundImageUrl(id: string, variant: 'image' | 'thumbnail' = 'image'): string {
  const query = variant === 'thumbnail' ? '?variant=thumbnail' : '';
  return `${getApiBaseUrl()}/api/background-images/${encodeURIComponent(id)}/image${query}`;
}

export function getCustomBackgroundValueForImage(image: Pick<BackgroundImageSummary, 'id'>): string {
  return buildCustomBackgroundValue(image.id);
}
