import { afterEach, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';

vi.mock('node:child_process', () => ({ execFileSync: vi.fn() }));
const originalArgs = process.argv;
afterEach(() => { process.argv = originalArgs; vi.resetAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
function mockCommands(events: string[], rejectGate: number | null = null) {
  let gates = 0;
  vi.mocked(execFileSync).mockImplementation((command, args) => {
    const values = (args ?? []) as string[];
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
      } else if (values[1] === 'build') events.push('build');
      return '';
    }
    if (values.includes('pages')) events.push('pages');
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
    expect(events).toEqual(['gate-1', 'build', 'worker', 'pages']);
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
    expect(events).toEqual(['gate-1', 'build', 'worker', 'activate', 'gate-2', 'pages']);
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
});
