import type {
  AdminGameJamAccount,
  AdminGameJamParticipant,
  AdminGameJamsResponse,
  AdminGameJamSubmission,
  AdminGameJamSummary,
} from '../../../admin/model';
import { JAM_SLUG } from '../../../jam/model';
import type { Env } from '../core/types';

interface JamRegistrationRow {
  id: string;
  jam_slug: string;
  username: string;
  email: string;
  email_normalized: string;
  matched_user_id: string | null;
  created_at: string;
  updated_at: string;
}

interface JamSubmissionRow {
  id: string;
  jam_slug: string;
  user_id: string;
  username: string;
  email: string;
  room_x: number;
  room_y: number;
  room_url: string;
  created_at: string;
  updated_at: string;
}

interface UserIdentityRow {
  id: string;
  display_name: string;
  username: string | null;
  email: string | null;
  wallet_address: string | null;
}

const USER_LOOKUP_CHUNK_SIZE = 80;

export async function loadAdminGameJams(env: Env): Promise<AdminGameJamsResponse> {
  const [registrationResult, submissionResult] = await Promise.all([
    env.JAM_DB.prepare(
      `
        SELECT
          id,
          jam_slug,
          username,
          email,
          email_normalized,
          matched_user_id,
          created_at,
          updated_at
        FROM jam_registrations
        ORDER BY created_at DESC, id ASC
      `,
    ).all<JamRegistrationRow>(),
    env.JAM_DB.prepare(
      `
        SELECT
          id,
          jam_slug,
          user_id,
          username,
          email,
          room_x,
          room_y,
          room_url,
          created_at,
          updated_at
        FROM jam_submissions
        ORDER BY created_at DESC, id ASC
      `,
    ).all<JamSubmissionRow>(),
  ]);

  const registrations = registrationResult.results;
  const submissions = submissionResult.results;
  const accountIds = new Set<string>();
  registrations.forEach((registration) => {
    if (registration.matched_user_id) {
      accountIds.add(registration.matched_user_id);
    }
  });
  submissions.forEach((submission) => accountIds.add(submission.user_id));
  const accounts = await loadAccounts(env, [...accountIds]);

  const slugs = new Set<string>([JAM_SLUG]);
  registrations.forEach((registration) => slugs.add(registration.jam_slug));
  submissions.forEach((submission) => slugs.add(submission.jam_slug));

  return {
    generatedAt: new Date().toISOString(),
    jams: [...slugs]
      .map((slug) => buildJamSummary(slug, registrations, submissions, accounts))
      .sort(compareJams),
  };
}

async function loadAccounts(
  env: Env,
  userIds: string[],
): Promise<Map<string, AdminGameJamAccount>> {
  const accounts = new Map<string, AdminGameJamAccount>();
  for (let start = 0; start < userIds.length; start += USER_LOOKUP_CHUNK_SIZE) {
    const chunk = userIds.slice(start, start + USER_LOOKUP_CHUNK_SIZE);
    if (chunk.length === 0) {
      continue;
    }
    const placeholders = chunk.map(() => '?').join(', ');
    const result = await env.DB.prepare(
      `
        SELECT id, display_name, username, email, wallet_address
        FROM users
        WHERE id IN (${placeholders})
      `,
    ).bind(...chunk).all<UserIdentityRow>();
    result.results.forEach((row) => {
      accounts.set(row.id, {
        id: row.id,
        displayName: row.display_name,
        username: row.username,
        email: row.email,
        walletAddress: row.wallet_address,
      });
    });
  }
  return accounts;
}

function buildJamSummary(
  slug: string,
  allRegistrations: JamRegistrationRow[],
  allSubmissions: JamSubmissionRow[],
  accounts: Map<string, AdminGameJamAccount>,
): AdminGameJamSummary {
  const registrations = allRegistrations.filter((row) => row.jam_slug === slug);
  const submissions = allSubmissions.filter((row) => row.jam_slug === slug);
  const submissionByUserId = new Map(submissions.map((row) => [row.user_id, row]));
  const submissionByEmail = new Map(
    submissions.map((row) => [normalizeEmail(row.email), row]),
  );
  const matchedSubmissionIds = new Set<string>();

  const participants: AdminGameJamParticipant[] = registrations.map((registration) => {
    const submission =
      (registration.matched_user_id
        ? submissionByUserId.get(registration.matched_user_id)
        : undefined) ??
      submissionByEmail.get(registration.email_normalized) ??
      null;
    if (submission) {
      matchedSubmissionIds.add(submission.id);
    }
    const accountId = registration.matched_user_id ?? submission?.user_id ?? null;
    return {
      registration: {
        id: registration.id,
        username: registration.username,
        email: registration.email,
        registeredAt: registration.created_at,
        updatedAt: registration.updated_at,
      },
      account: accountId ? accounts.get(accountId) ?? null : null,
      submission: submission ? toSubmission(submission) : null,
    };
  });

  submissions.forEach((submission) => {
    if (matchedSubmissionIds.has(submission.id)) {
      return;
    }
    participants.push({
      registration: null,
      account: accounts.get(submission.user_id) ?? null,
      submission: toSubmission(submission),
    });
  });

  participants.sort(compareParticipants);
  const registeredSubmitters = participants.filter(
    (participant) => participant.registration && participant.submission,
  ).length;

  return {
    slug,
    registrationCount: registrations.length,
    submissionCount: submissions.length,
    awaitingSubmissionCount: Math.max(0, registrations.length - registeredSubmitters),
    participants,
  };
}

function toSubmission(row: JamSubmissionRow): AdminGameJamSubmission {
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    roomX: Number(row.room_x),
    roomY: Number(row.room_y),
    roomUrl: row.room_url,
    submittedAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function compareParticipants(
  left: AdminGameJamParticipant,
  right: AdminGameJamParticipant,
): number {
  const leftSubmitted = left.submission ? 1 : 0;
  const rightSubmitted = right.submission ? 1 : 0;
  if (leftSubmitted !== rightSubmitted) {
    return rightSubmitted - leftSubmitted;
  }
  const leftDate = left.submission?.submittedAt ?? left.registration?.registeredAt ?? '';
  const rightDate = right.submission?.submittedAt ?? right.registration?.registeredAt ?? '';
  return rightDate.localeCompare(leftDate);
}

function compareJams(left: AdminGameJamSummary, right: AdminGameJamSummary): number {
  const leftDate = latestJamActivity(left);
  const rightDate = latestJamActivity(right);
  if (leftDate !== rightDate) {
    return rightDate.localeCompare(leftDate);
  }
  return left.slug.localeCompare(right.slug);
}

function latestJamActivity(jam: AdminGameJamSummary): string {
  return jam.participants.reduce((latest, participant) => {
    const dates = [
      participant.registration?.registeredAt ?? '',
      participant.submission?.submittedAt ?? '',
    ];
    return dates.reduce(
      (participantLatest, date) => date > participantLatest ? date : participantLatest,
      latest,
    );
  }, '');
}
