import { apiRequest } from '../api/request';
import {
  cloneWampOGramRecord,
  type WampOGramCreateRequest,
  type WampOGramRecord,
  type WampOGramPublicRecord,
} from './model';

export interface WampOGramRepository {
  create(request: WampOGramCreateRequest): Promise<WampOGramRecord>;
  loadBySlug(slug: string): Promise<WampOGramPublicRecord>;
}

class ApiWampOGramRepository implements WampOGramRepository {
  async create(request: WampOGramCreateRequest): Promise<WampOGramRecord> {
    const record = await apiRequest<WampOGramRecord>('/api/wamp-o-grams', {
      method: 'POST',
      body: JSON.stringify(request),
    });
    return cloneWampOGramRecord(record);
  }

  async loadBySlug(slug: string): Promise<WampOGramPublicRecord> {
    return apiRequest<WampOGramPublicRecord>(
      `/api/wamp-o-grams/${encodeURIComponent(slug)}`
    );
  }
}

export function createWampOGramRepository(): WampOGramRepository {
  return new ApiWampOGramRepository();
}
