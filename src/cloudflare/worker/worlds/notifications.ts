import { createEmailClient, emailConfigured } from '../email/provider';
import { DEFAULT_AUTH_EMAIL_FROM, resolveEmailBaseUrl } from '../auth/store';
import { sendAdminReviewNotificationEmail } from '../admin/reviewNotifications';
import type { Env } from '../core/types';
import type { WorldPublicationRequest } from '../../../worlds/model';

export interface WorldEmailResult {
  attempted: boolean;
  sent: boolean;
  error: string | null;
}

interface WorldEmail {
  to: string | string[];
  subject: string;
  heading: string;
  body: string;
  actionUrl: string;
  actionLabel: string;
}

export async function sendWorldGrantEmail(
  request: Request,
  env: Env,
  email: string,
): Promise<WorldEmailResult> {
  return sendWorldEmail(env, {
    to: email,
    subject: 'Your WAMP World is ready to build',
    heading: 'You have a WAMP World grant',
    body: 'Sign in with this email, open Worlds, and start the seed room. Your World number is assigned when you publish it.',
    actionUrl: `${resolveEmailBaseUrl(request, env)}/?worlds=mine`,
    actionLabel: 'Start your World',
  });
}

export async function sendWorldInvitationEmail(
  request: Request,
  env: Env,
  params: { email: string; worldNumber: number; worldName: string | null },
): Promise<WorldEmailResult> {
  const label = params.worldName ? `WAMP ${params.worldNumber}: ${params.worldName}` : `WAMP ${params.worldNumber}`;
  return sendWorldEmail(env, {
    to: params.email,
    subject: `You're invited to build in ${label}`,
    heading: 'Build together in WAMP',
    body: `You have been invited to build in ${label}. Sign in with this email to accept the invitation.`,
    actionUrl: `${resolveEmailBaseUrl(request, env)}/w/${params.worldNumber}?worlds=mine`,
    actionLabel: 'Open the World',
  });
}

export async function sendWorldManagerActionEmail(
  request: Request,
  env: Env,
  params: {
    worldId: string;
    worldNumber: number;
    worldName: string | null;
    kind: 'membership' | 'publication';
    requester: string;
  },
): Promise<WorldEmailResult> {
  const recipients = await loadWorldManagerEmails(env, params.worldId);
  if (recipients.length === 0) return { attempted: false, sent: false, error: null };
  const label = params.worldName ? `WAMP ${params.worldNumber}: ${params.worldName}` : `WAMP ${params.worldNumber}`;
  const action = params.kind === 'membership' ? 'builder request' : 'publication request';
  return sendWorldEmail(env, {
    to: recipients,
    subject: `${label} has a new ${action}`,
    heading: `New ${action}`,
    body: `${params.requester} needs a decision in ${label}.`,
    actionUrl: `${resolveEmailBaseUrl(request, env)}/w/${params.worldNumber}?worlds=manage`,
    actionLabel: 'Review in Worlds',
  });
}

export async function sendWorldPublicationDecisionEmail(
  request: Request, env: Env,
  params: { worldNumber: number; publication: WorldPublicationRequest },
): Promise<WorldEmailResult> {
  const email=await worldBuilderEmail(env,params.publication.submittedByUserId);
  if(!email)return {attempted:false,sent:false,error:null};
  const publication=params.publication,approved=publication.status==='approved';
  const room=publication.roomTitle||`Room ${publication.roomCoordinates.x},${publication.roomCoordinates.y}`;
  return sendWorldEmail(env,{
    to:email,subject:`${room}: ${approved?'approved':'changes requested'} in WAMP ${params.worldNumber}`,
    heading:approved?'Your room was approved':'Your room needs changes',
    body:approved?`${room} is now published in WAMP ${params.worldNumber}.`:
      `${room} was not approved.${publication.rejectionReason?` Reviewer: ${publication.rejectionReason}`:''} Open the room, make your changes, and submit it again.`,
    actionUrl:`${resolveEmailBaseUrl(request,env)}/w/${params.worldNumber}?worlds=manage`,actionLabel:'View your request',
  });
}

export async function sendWorldMembershipApprovedEmail(
  request:Request,env:Env,params:{userId:string|null;worldNumber:number},
):Promise<WorldEmailResult>{
  const email=params.userId?await worldBuilderEmail(env,params.userId):null;
  if(!email)return {attempted:false,sent:false,error:null};
  return sendWorldEmail(env,{to:email,subject:`You can now build in WAMP ${params.worldNumber}`,
    heading:'Your builder request was approved',body:`You can now claim and edit rooms in WAMP ${params.worldNumber}.`,
    actionUrl:`${resolveEmailBaseUrl(request,env)}/w/${params.worldNumber}?worlds=mine`,actionLabel:'Open your World'});
}

async function worldBuilderEmail(env:Env,userId:string):Promise<string|null>{
  if(!emailConfigured(env))return null;
  const row=await env.DB.prepare(`SELECT email FROM users WHERE id=? AND email IS NOT NULL
    AND NOT EXISTS(SELECT 1 FROM school_students WHERE user_id=users.id)`).bind(userId).first<{email:string}>();
  return row?.email?.trim()||null;
}

export async function sendWorldNameReviewEmail(
  request: Request,
  env: Env,
  params: { worldNumber: number; proposedName: string },
): Promise<WorldEmailResult> {
  const result = await sendAdminReviewNotificationEmail(env, {
    subject: `WAMP ${params.worldNumber} name request: ${params.proposedName}`,
    heading: 'World name review',
    intro: `WAMP ${params.worldNumber} requested a new public name.`,
    details: [`Proposed name: ${params.proposedName}`],
    actionUrl: `${resolveEmailBaseUrl(request, env)}/worlds-admin.html`,
    actionLabel: 'Review World names',
  });
  return { attempted: result.attempted, sent: result.sent, error: result.error };
}

async function loadWorldManagerEmails(env: Env, worldId: string): Promise<string[]> {
  const result = await env.DB.prepare(
    `
      SELECT u.email
      FROM worlds w
      INNER JOIN users u ON u.id = w.owner_user_id
      WHERE w.id = ? AND u.email IS NOT NULL
      UNION
      SELECT COALESCE(u.email, m.email) AS email
      FROM world_memberships m
      LEFT JOIN users u ON u.id = m.user_id
      WHERE m.world_id = ? AND m.role = 'manager' AND m.status = 'active'
    `,
  ).bind(worldId, worldId).all<{ email: string | null }>();
  return [...new Set(result.results.map((row) => row.email?.trim()).filter((email): email is string => Boolean(email)))];
}

async function sendWorldEmail(env: Env, email: WorldEmail): Promise<WorldEmailResult> {
  if (!emailConfigured(env)) return { attempted: false, sent: false, error: null };
  const mailer = createEmailClient(env);
  try {
    const response = await mailer.emails.send({
      from: env.AUTH_EMAIL_FROM?.trim() || DEFAULT_AUTH_EMAIL_FROM,
      to: email.to,
      subject: email.subject,
      text: [email.heading, '', email.body, '', `${email.actionLabel}: ${email.actionUrl}`].join('\n'),
      html: [
        '<div style="font-family: monospace; background: #050505; color: #f3eee2; padding: 24px;">',
        `<h2 style="margin: 0 0 16px;">${escapeHtml(email.heading)}</h2>`,
        `<p style="margin: 0 0 20px;">${escapeHtml(email.body)}</p>`,
        `<p style="margin: 0;"><a href="${escapeHtml(email.actionUrl)}" style="color: #7de5ff;">${escapeHtml(email.actionLabel)}</a></p>`,
        '</div>',
      ].join(''),
    });
    if (response.error) return { attempted: true, sent: false, error: response.error.message };
    return { attempted: true, sent: Boolean(response.data?.id), error: response.data?.id ? null : 'Email provider returned no message id.' };
  } catch (error) {
    return { attempted: true, sent: false, error: error instanceof Error ? error.message : 'Unknown email provider failure.' };
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
