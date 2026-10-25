import { describe, expect, it, vi } from 'vitest';
import type { Env } from '../core/types';
import { createEmailClient, emailConfigured } from './provider';
import { sendMagicLinkEmail } from '../auth/store';
import { deliverEmail } from './delivery';

const message = { from: 'WAMP <login@wamp.land>', to: 'player@example.test', subject: 'Sign in', text: '123456', html: '<p>123456</p>' };
function fixture() {
  const send = vi.fn<NonNullable<Env['EMAIL']>['send']>(async () => ({ messageId: 'cf-message' }));
  const env = { EMAIL: { send }, AUTH_EMAIL_FROM: message.from } as unknown as Env;
  return { env, send };
}
describe('Cloudflare email delivery', () => {
  it('works without a Resend key and preserves sender names', async () => {
    const { env, send } = fixture();
    expect(emailConfigured(env)).toBe(true);
    expect(await createEmailClient(env).emails.send(message)).toEqual({ data: { id: 'cf-message' }, error: null });
    expect(send).toHaveBeenCalledWith({ ...message, from: { email: 'login@wamp.land', name: 'WAMP' } });
  });
  it('uses the Cloudflare sender even when an old Resend sender is configured', async () => {
    const { env, send } = fixture(); env.EMAIL_FROM = 'WAMP <noreply@wamp.land>';
    await createEmailClient(env).emails.send({ ...message, from: 'old@resend.dev' });
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ from: { email: 'noreply@wamp.land', name: 'WAMP' } }));
  });
  it('sends login code and link through the binding', async () => {
    const { env, send } = fixture();
    await sendMagicLinkEmail(env, message.to, 'https://wamp.land/api/auth/verify?token=test', '123456');
    expect(send.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
      to: message.to, text: expect.stringContaining('123456'), html: expect.stringContaining('token=test'),
    }));
  });
  it('uses the binding for leased notifications rather than HTTP', async () => {
    const { env, send } = fixture(); const fetcher = vi.fn();
    expect(await deliverEmail(env, { ...message, html: '<p>123456</p>' }, 'event-1', fetcher)).toBe('cf-message');
    expect(send).toHaveBeenCalledOnce(); expect(fetcher).not.toHaveBeenCalled();
  });
  it('reports quota failures without falling back to Resend', async () => {
    const { env, send } = fixture(); env.RESEND_API_KEY = 'rollback-key';
    send.mockRejectedValueOnce(Object.assign(new Error('Daily quota reached'), { code: 'E_DAILY_LIMIT_EXCEEDED' }));
    expect(await createEmailClient(env).emails.send(message)).toEqual({ data: null, error: { message: 'Daily quota reached', statusCode: 429 } });
    expect(send).toHaveBeenCalledOnce();
  });
  it('rejects unconfirmed sends', async () => {
    const { env, send } = fixture(); send.mockResolvedValueOnce({ messageId: '' });
    await expect(sendMagicLinkEmail(env, message.to, 'https://wamp.land/', '123456')).rejects.toThrow('message id');
  });
  it('reports no provider when neither binding nor rollback key is configured', () => {
    expect(emailConfigured({} as Env)).toBe(false);
  });
});
