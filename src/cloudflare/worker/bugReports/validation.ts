import { BUG_EVIDENCE_LIMIT, BUG_FRAME_COUNT, BUG_FRAME_LIMIT, BUG_NOTES_LIMIT, BUG_REPLAY_MS,
  bugObject, normalizeBugContext, normalizeBugDevice, normalizeBugDiagnostics, type BugReportSubmission } from '../../../bugReports/model';
import { validateReplaySample } from '../guestReplay/routes';
import { HttpError } from '../core/http';

export const BUG_REPORT_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export function validateBugReport(value: unknown): BugReportSubmission {
  const input = bugObject(value), evidence = bugObject(input.evidence);
  if (typeof input.id !== 'string' || !BUG_REPORT_ID.test(input.id) || typeof input.visitor !== 'string' || !BUG_REPORT_ID.test(input.visitor))
    throw new HttpError(400, 'Invalid report identity.');
  if (typeof input.notes !== 'string' || input.notes.trim().length < 3 || input.notes.length > BUG_NOTES_LIMIT)
    throw new HttpError(400, 'Describe the problem in 3–2,000 characters.');
  if (!Array.isArray(evidence.samples) || evidence.samples.length > BUG_FRAME_COUNT) throw new HttpError(400, 'Invalid replay length.');
  const samples = evidence.samples.map(validateReplaySample);
  let previous = -1;
  for (const [index, sample] of samples.entries()) {
    if (sample.sequence !== index || sample.time < previous || sample.time > BUG_REPLAY_MS || (sample.image?.length ?? 0) > BUG_FRAME_LIMIT)
      throw new HttpError(400, 'Invalid replay bounds.');
    previous = sample.time;
  }
  const screenshot = evidence.screenshot === null ? null : validateReplaySample({
    sequence: 0, time: 0, mode: 'play', screen: 'game', room: null, player: null, actions: [], image: evidence.screenshot,
  }).image;
  if ((screenshot?.length ?? 0) > BUG_FRAME_LIMIT || !['captured','disabled','unavailable','not_attached'].includes(String(evidence.reason)))
    throw new HttpError(400, 'Invalid report evidence.');
  if (evidence.reason !== 'captured' && (samples.length || screenshot)) throw new HttpError(400, 'Evidence does not match its recording preference.');
  const normalizedEvidence = { samples, screenshot, reason: evidence.reason as BugReportSubmission['evidence']['reason'] };
  if (JSON.stringify(normalizedEvidence).length > BUG_EVIDENCE_LIMIT) throw new HttpError(413, 'Replay is too large.');
  return { id: input.id, visitor: input.visitor, notes: input.notes.trim(),
    build: typeof input.build === 'string' && /^[a-zA-Z0-9_.-]{1,80}$/.test(input.build) ? input.build : 'unknown',
    context: normalizeBugContext(input.context), device: normalizeBugDevice(input.device), errors: normalizeBugDiagnostics(input.errors),
    evidence: normalizedEvidence };
}
