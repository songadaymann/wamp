import type { RoomRecord } from './roomModel';

/** A committed draft must remain the next save's baseline even if submission fails. */
export class RoomPublicationSubmissionError extends Error {
  constructor(readonly savedDraft: RoomRecord, readonly cause: unknown) {
    super('Draft saved, but World review submission failed. Try Publish again.');
  }
}
