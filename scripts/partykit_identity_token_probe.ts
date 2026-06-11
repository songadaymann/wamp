import PresenceServer from '../partykit/presenceServer';
import {
  createPartykitIdentityToken,
  verifyPartykitIdentityToken,
  type PartyKitIdentity,
} from '../src/presence/identityToken';
import {
  createConstructionPreviewToken,
  verifyConstructionPreviewToken,
} from '../src/presence/constructionPreviewToken';
import { handlePresenceRequest } from '../src/cloudflare/worker/presence/routes';
import type { Env } from '../src/cloudflare/worker/core/types';

const secret = 'partykit-identity-probe-secret';
const identity: PartyKitIdentity = {
  userId: 'guest-probe-00000000-0000-4000-8000-000000000000',
  displayName: 'Probe Guest',
  avatarId: 'default-player',
};

async function main(): Promise<void> {
  const { token } = await createPartykitIdentityToken(identity, 'guest', secret, {
    nonce: 'probe-nonce',
  });
  const verified = await verifyPartykitIdentityToken(token, secret);
  assert(verified?.userId === identity.userId, 'signed token should verify');

  const tamperedToken = `${token.slice(0, -1)}${token.endsWith('a') ? 'b' : 'a'}`;
  const tampered = await verifyPartykitIdentityToken(tamperedToken, secret);
  assert(tampered === null, 'tampered token should not verify');

  const { token: constructionPreviewToken } = await createConstructionPreviewToken(
    {
      roomId: '4,-2',
      roomCoordinates: { x: 4, y: -2 },
      userId: 'user-builder-1',
    },
    secret,
    {
      nonce: 'construction-preview-probe-nonce',
    }
  );
  const verifiedConstructionPreview = await verifyConstructionPreviewToken(
    constructionPreviewToken,
    secret
  );
  assert(
    verifiedConstructionPreview?.roomId === '4,-2' &&
      verifiedConstructionPreview.userId === 'user-builder-1',
    'construction preview token should verify room and builder claims'
  );
  const tamperedConstructionPreviewToken = `${constructionPreviewToken.slice(0, -1)}${
    constructionPreviewToken.endsWith('a') ? 'b' : 'a'
  }`;
  const tamperedConstructionPreview = await verifyConstructionPreviewToken(
    tamperedConstructionPreviewToken,
    secret
  );
  assert(tamperedConstructionPreview === null, 'tampered construction preview token should not verify');

  const validConnect = await PresenceServer.onBeforeConnect(
    new Request(`https://presence.example.test/parties/main/0,0?identityToken=${encodeURIComponent(token)}`) as never,
    { env: { PARTYKIT_IDENTITY_TOKEN_SECRET: secret } } as never
  );
  assert(!(validConnect instanceof Response), 'valid PartyKit connection should pass');

  const missingTokenConnect = await PresenceServer.onBeforeConnect(
    new Request('https://presence.example.test/parties/main/0,0') as never,
    { env: { PARTYKIT_IDENTITY_TOKEN_SECRET: secret } } as never
  );
  assert(
    missingTokenConnect instanceof Response && missingTokenConnect.status === 401,
    'missing PartyKit identity token should be rejected'
  );

  const issued = await handlePresenceRequest(
    new Request('https://api.example.test/api/presence/identity-token', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({ identity }),
    }),
    new URL('https://api.example.test/api/presence/identity-token'),
    {
      PARTYKIT_IDENTITY_TOKEN_SECRET: secret,
    } as Env
  );
  assert(issued.ok, `Worker token issuer should succeed, got ${issued.status}`);
  const issuedBody = (await issued.json()) as { token?: string };
  assert(typeof issuedBody.token === 'string', 'Worker token issuer should return a token');
  const issuedClaims = await verifyPartykitIdentityToken(issuedBody.token, secret);
  assert(issuedClaims?.userId === identity.userId, 'Worker-issued token should verify');

  console.log('PartyKit identity token probe passed.');
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
