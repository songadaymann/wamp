import { readApiErrorMessage } from '../api/readApiErrorMessage';
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
      const message = await readApiErrorMessage(response, `PVP API request failed with status ${response.status}.`);

      throw new PvpApiError(message, response.status);
    }

    return (await response.json()) as PvpMatchSubmissionResponse;
  }
}

export function createPvpRepository(): PvpRepository {
  return new ApiPvpRepository(getApiBaseUrl());
}
