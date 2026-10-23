import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Generated-only accounts (no email, no wallet, linked in the retired Play.fun table) have no
// write guards: F272 removed them because no way of signing in can produce such an account.
// These pins fail when a sign-in path or auth source is added, so that claim is re-checked first.
const RECHECK_F272 =
  'A way of signing in or authenticating changed. Before updating this list, re-check that it cannot '
  + 'authenticate a generated-only account (no email, no wallet, linked in the retired Play.fun table), '
  + 'or put back a write guard for those accounts (F272).';

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));

const workerSources = readdirSync(join(repoRoot, 'src/cloudflare'), { recursive: true, encoding: 'utf8' })
  .filter((path) => path.endsWith('.ts') && !path.endsWith('.test.ts'))
  .sort()
  .map((path) => ({
    path: `src/cloudflare/${path.split('\\').join('/')}`,
    source: readFileSync(join(repoRoot, 'src/cloudflare', path), 'utf8'),
  }));

function enclosingFunction(source: string, index: number): string {
  const declarations = [...source.slice(0, index).matchAll(/^(?:export\s+)?(?:async\s+)?function\s+(\w+)/gm)];
  return declarations.at(-1)?.[1] ?? '(top level)';
}

/** "file function" for every match of the pattern in non-test Worker code. */
function sitesOf(pattern: RegExp): string[] {
  return workerSources.flatMap(({ path, source }) =>
    [...source.matchAll(pattern)].map((match) => `${path} ${enclosingFunction(source, match.index)}`),
  ).sort();
}

function functionBody(path: string, name: string): string {
  const source = workerSources.find((file) => file.path === path)?.source ?? '';
  const start = source.search(new RegExp(`^(?:export\\s+)?(?:async\\s+)?function\\s+${name}\\(`, 'm'));
  expect(start, `${name} was not found in ${path}`).toBeGreaterThanOrEqual(0);
  // Skip the parameter list, then the body opens at the first brace that ends a line.
  let parameterDepth = 0;
  let parametersEnd = source.indexOf('(', start);
  for (; parametersEnd < source.length; parametersEnd += 1) {
    if (source[parametersEnd] === '(') parameterDepth += 1;
    if (source[parametersEnd] === ')' && --parameterDepth === 0) break;
  }
  const open = source.indexOf('{\n', parametersEnd);
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}' && --depth === 0) return source.slice(open, index + 1);
  }
  throw new Error(`Could not read the body of ${name}.`);
}

describe('sign-in paths (F272)', () => {
  it('creates sessions only from email, wallet and school sign-in', () => {
    expect(sitesOf(/(?<!function\s+)\bcreateSession\(/g), RECHECK_F272).toEqual([
      'src/cloudflare/worker/auth/routes.ts handleVerifyMagicLink',
      'src/cloudflare/worker/auth/routes.ts signInWithEmailCode',
      'src/cloudflare/worker/auth/walletRoutes.ts handleWalletVerify',
      'src/cloudflare/worker/school/routes.ts handleStudentLogin',
    ]);
    expect(sitesOf(/INSERT\s+(?:OR\s+\w+\s+)?INTO\s+"?sessions"?[\s(]/gi), RECHECK_F272).toEqual([
      'src/cloudflare/worker/auth/store.ts createSession',
    ]);
  });

  it('authenticates a request only by API token, agent token or session cookie', () => {
    const agentModel = readFileSync(join(repoRoot, 'src/agents/model.ts'), 'utf8');
    expect(/export type RequestAuthSource = ([^;]+);/.exec(agentModel)?.[1], RECHECK_F272)
      .toBe("'session' | 'api_token' | 'agent_token'");
    expect(sitesOf(/\bsource:\s*'(?:session|api_token|agent_token)'/g), RECHECK_F272).toEqual([
      'src/cloudflare/worker/agents/store.ts loadAgentTokenAuth',
      'src/cloudflare/worker/auth/request.ts createUserRequestAuth',
      'src/cloudflare/worker/auth/store.ts loadApiTokenAuth',
    ]);

    const body = functionBody('src/cloudflare/worker/auth/request.ts', 'loadOptionalRequestAuth');
    const calls = [...body.matchAll(/(?<![.\w$])([A-Za-z_$][\w$]*)\s*\(/g)]
      .map((match) => match[1])
      .filter((name) => !['if', 'for', 'while', 'switch', 'return'].includes(name));
    expect([...new Set(calls)].sort(), RECHECK_F272).toEqual([
      'HttpError',
      'attachSchoolContext',
      'createUserRequestAuth',
      'deleteSessionById',
      'isAdminRequest',
      'loadAgentTokenAuth',
      'loadApiTokenAuth',
      'loadCurrentSession',
      'parseBearerToken',
      'requireEnabledSchoolContext',
      'requireTrustedOriginForMutation',
    ]);
  });

  it('issues API and agent tokens only to a signed-in session', () => {
    expect(sitesOf(/INSERT\s+(?:OR\s+\w+\s+)?INTO\s+"?(?:api_tokens|agent_tokens)"?[\s(]/gi), RECHECK_F272).toEqual([
      'src/cloudflare/worker/agents/store.ts createAgentTokenForOwner',
      'src/cloudflare/worker/auth/store.ts createApiTokenForUser',
    ]);
    const issuers = sitesOf(/(?<!function\s+)\b(?:createApiTokenForUser|createAgentTokenForOwner)\(/g);
    expect(issuers, RECHECK_F272).toEqual([
      'src/cloudflare/worker/agents/routes.ts handleCreateAgentToken',
      'src/cloudflare/worker/auth/routes.ts handleCreateApiToken',
    ]);
    for (const site of issuers) {
      const [path, name] = site.split(' ');
      expect(functionBody(path, name), `${site} must require a session. ${RECHECK_F272}`)
        .toMatch(/await requireCurrentSession\(/);
    }
  });
});
