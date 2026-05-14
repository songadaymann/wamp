import { getApiBaseUrl } from '../api/baseUrl';
import type {
  PvpMatchSubmissionRequestBody,
  PvpMatchSubmissionResponse,
} from './model';

class PvpApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export interface PvpRepository {
  submitMatch(body: PvpMatchSubmissionRequestBody): Promise<PvpMatchSubmissionResponse>;
}

class ApiPvpRepository implements PvpRepository {
  constructor(private readonly baseUrl: string) {}

  async submitMatch(body: PvpMatchSubmissionRequestBody): Promise<PvpMatchSubmissionResponse> {
    const response = await fetch(`${this.baseUrl}/api/pvp/matches`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      let message = `PVP API request failed with status ${response.status}.`;
      try {
        const parsed = (await response.json()) as { error?: unknown };
        if (typeof parsed.error === 'string' && parsed.error.trim()) {
          message = parsed.error;
        }
      } catch {
        const text = await response.text().catch(() => '');
        if (text.trim()) {
          message = text.trim();
        }
      }

      throw new PvpApiError(message, response.status);
    }

    return (await response.json()) as PvpMatchSubmissionResponse;
  }
}

export function createPvpRepository(): PvpRepository {
  return new ApiPvpRepository(getApiBaseUrl());
}
