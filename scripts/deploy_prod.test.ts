import { afterEach, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';

vi.mock('node:child_process', () => ({ execFileSync: vi.fn() }));
const originalArgs = process.argv;
afterEach(() => { process.argv = originalArgs; vi.resetAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
function mockCommands(events: string[], rejectGate: number | null = null, options: { pendingMigrations?: boolean; failPages?: boolean } = {}) {
  let gates = 0;
  vi.mocked(execFileSync).mockImplementation((command, args) => {
    const values = (args ?? []) as string[];
    if (values.includes('migrations') && values.includes('list')) {
      return options.pendingMigrations && values.includes('everybodys-platformer-db')
        ? 'Migrations to be applied:\n0065_next.sql\n' : '✅ No migrations to apply!\n';
    }
    if (values.includes('migrations') && values.includes('apply')) { events.push(`migrate-${values[values.indexOf('apply') + 1]}`); return ''; }
    if (values.includes('deployments')) return JSON.stringify([{ versions: [{ version_id: 'previous-version' }] }]);
    if (command === 'git') {
      if (values[0] === 'rev-parse') return 'release-sha\n';
      if (values[0] === 'branch') return 'main\n';
      if (values[0] === 'log') return 'Release map guard\n';
      return '';
    }
    if (command === 'npm') {
      if (values[1] === 'world-tiles:release:check') {
        gates += 1; events.push(`gate-${gates}`);
        if (rejectGate === gates) throw new Error('Incompatible map');
      } else if (values[1] === 'build' || values[1] === 'check') events.push(values[1]);
      return '';
    }
    if (values.includes('pages')) {
      if (options.failPages) throw new Error('Pages upload failed');
      events.push('pages');
    }
    else if (values.includes('deploy')) events.push('worker');
    return '';
  });
}

describe('production deployment guard ordering', () => {
  it('stops before build or deployment when compatibility fails, even with skip-smoke', async () => {
    const events: string[] = []; mockCommands(events, 1);
    process.argv = ['node', 'deploy_prod.mjs', '--pages-only', '--skip-smoke'];
    await expect(import('./deploy_prod.mjs?bad-map')).rejects.toThrow('Incompatible map');
    expect(events).toEqual(['gate-1']);
  });
  it('gates a normal production release before building or publishing', async () => {
    const events: string[] = []; mockCommands(events);
    process.argv = ['node', 'deploy_prod.mjs', '--skip-smoke'];
    await import('./deploy_prod.mjs?healthy-map');
    expect(events).toEqual(['gate-1', 'check', 'worker', 'pages']);
  });
  it('rejects using a staged renderer in a frontend-only release', async () => {
    const events: string[] = []; mockCommands(events);
    process.argv = ['node', 'deploy_prod.mjs', '--pages-only', '--world-tile-renderer', 'renderer-next'];
    await expect(import('./deploy_prod.mjs?wrong-order')).rejects.toThrow('requires an API Worker release');
    expect(events).toEqual([]);
  });
  it('activates verified imagery after the API release, then rechecks before frontend publication', async () => {
    const events: string[] = []; mockCommands(events);
    vi.stubEnv('ADMIN_API_KEY', 'test-secret');
    vi.stubGlobal('fetch', async (input: string) => {
      if (input.endsWith('/activate')) { events.push('activate'); return new Response('{"ok":true}'); }
      return new Response('{"statuses":[{"renderer":{"version":"renderer-next","status":"building"}}]}');
    });
    process.argv = ['node', 'deploy_prod.mjs', '--world-tile-renderer', 'renderer-next', '--skip-smoke'];
    await import('./deploy_prod.mjs?staged-map');
    expect(events).toEqual(['gate-1', 'check', 'worker', 'activate', 'gate-2', 'pages']);
  });
  it('stops frontend publication if post-activation compatibility fails', async () => {
    const events: string[] = []; mockCommands(events, 2);
    vi.stubEnv('ADMIN_API_KEY', 'test-secret');
    vi.stubGlobal('fetch', async (input: string) => input.endsWith('/activate') ? new Response('{"ok":true}')
      : new Response('{"statuses":[{"renderer":{"version":"renderer-next","status":"building"}}]}'));
    process.argv = ['node', 'deploy_prod.mjs', '--world-tile-renderer', 'renderer-next', '--skip-smoke'];
    await expect(import('./deploy_prod.mjs?bad-after-activation')).rejects.toThrow('Incompatible map');
    expect(events).not.toContain('pages');
  });
  it('refuses to deploy over unapplied migrations, before checking or building (F193)', async () => {
    const events: string[] = []; mockCommands(events, null, { pendingMigrations: true });
    process.argv = ['node', 'deploy_prod.mjs', '--skip-smoke'];
    await expect(import('./deploy_prod.mjs?pending-migrations')).rejects.toThrow('has migrations that are not applied');
    expect(events).toEqual([]);
  });
  it('applies pending migrations before the Worker with --migrate, and builds only with --skip-check (F193)', async () => {
    const events: string[] = []; mockCommands(events, null, { pendingMigrations: true });
    process.argv = ['node', 'deploy_prod.mjs', '--migrate', '--skip-check', '--skip-smoke'];
    await import('./deploy_prod.mjs?apply-migrations');
    expect(events).toEqual(['migrate-everybodys-platformer-db', 'gate-1', 'build', 'worker', 'pages']);
  });
  it('prints the rollback command when a step after the Worker deploy fails (F193)', async () => {
    const events: string[] = []; mockCommands(events, null, { failPages: true });
    const errors: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((...parts: unknown[]) => { errors.push(parts.join(' ')); });
    process.argv = ['node', 'deploy_prod.mjs', '--skip-smoke'];
    await expect(import('./deploy_prod.mjs?pages-fails')).rejects.toThrow('Pages upload failed');
    expect(events).toEqual(['gate-1', 'check', 'worker']);
    expect(errors.join('\n')).toContain('wrangler.js rollback previous-version');
  });
});
