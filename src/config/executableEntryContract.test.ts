import { readdirSync, readFileSync } from 'node:fs';
import { posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

type KnipConfig = {
  entry: string[];
};

type PackageJson = {
  scripts: Record<string, string>;
  devDependencies: Record<string, string>;
};

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));

const readRepoFile = (relativePath: string): string =>
  readFileSync(new URL(`../../${relativePath}`, import.meta.url), 'utf8');

const readRepoJson = <T>(relativePath: string): T =>
  JSON.parse(readRepoFile(relativePath)) as T;

const sorted = (values: Iterable<string>): string[] => [...values].sort();

const extractMatches = (source: string, expression: RegExp): string[] =>
  [...source.matchAll(expression)].map((match) => match[1]);

const viteConfigSource = readRepoFile('vite.config.ts');
const viteHtmlEntries = new Set(
  extractMatches(
    viteConfigSource,
    /resolve\(process\.cwd\(\), '([^']+\.html)'\)/g,
  ),
);

const viteModuleEntries = new Set<string>();
for (const htmlEntry of viteHtmlEntries) {
  const htmlSource = readRepoFile(htmlEntry);
  for (const moduleEntry of extractMatches(
    htmlSource,
    /<script\b[^>]*\btype=["']module["'][^>]*\bsrc=["']\/([^"']+)["'][^>]*>/g,
  )) {
    viteModuleEntries.add(moduleEntry);
  }
}

const wranglerWorkerEntries = new Set<string>();
for (const file of readdirSync(repoRoot, { withFileTypes: true })) {
  if (!file.isFile() || !/^wrangler(?:\.[a-z0-9-]+)?\.jsonc$/i.test(file.name)) {
    continue;
  }
  const mainEntry = readRepoFile(file.name).match(/"main"\s*:\s*"([^"]+)"/)?.[1];
  if (mainEntry) {
    wranglerWorkerEntries.add(mainEntry);
  }
}

const partyKitEntries = new Set<string>();
for (const file of readdirSync(repoRoot, { withFileTypes: true })) {
  if (!file.isFile() || !/^partykit(?:\.[a-z0-9-]+)?\.json$/i.test(file.name)) {
    continue;
  }
  const config = readRepoJson<{ main: string }>(file.name);
  partyKitEntries.add(config.main);
}

const packageJson = readRepoJson<PackageJson>('package.json');
const packageScriptEntries = new Set<string>();
for (const command of Object.values(packageJson.scripts)) {
  for (const scriptEntry of extractMatches(
    command,
    /\b(?:node|tsx)\s+(scripts\/[a-z0-9_./-]+\.(?:js|mjs|ts))/gi,
  )) {
    packageScriptEntries.add(scriptEntry);
  }
}

// These are intentional command-line or dynamically imported roots that are not
// named by package scripts. Keeping the list explicit prevents helper/test files
// from becoming Knip roots merely because they live under scripts/.
const manualScriptEntries = new Set([
  'scripts/backfill-room-token-metadata.ts',
  'scripts/build-player-combat-actions-atlas.mjs',
  'scripts/generate_autotile_edge_case_tiles.mjs',
  'scripts/overworld_zoom_perf_probe.mjs',
  'scripts/remote_rollout_check.mjs',
  'scripts/render-room-preview-data-url.mjs',
  'scripts/safety_ranked_run_spoof_probe.js',
  'scripts/smoke_launch_admin_game_jams.mjs',
  'scripts/smoke_wallet_email_link_modal.mjs',
]);

const importedOnlyScriptModules = new Set([
  'scripts/overworld_tile_pyramid_probe_helpers.mjs',
]);

const scriptModules = new Set(
  readdirSync(new URL('../../scripts/', import.meta.url), { withFileTypes: true })
    .filter(
      (file) =>
        file.isFile()
        && /\.(?:js|mjs|ts)$/.test(file.name)
        && !/\.test\.(?:js|mjs|ts)$/.test(file.name),
    )
    .map((file) => posix.join('scripts', file.name)),
);

const executableScriptEntries = new Set([
  ...packageScriptEntries,
  ...manualScriptEntries,
]);

const generatorEntries = new Set(
  readdirSync(new URL('../../gen-avatar/', import.meta.url), { withFileTypes: true })
    .filter((file) => file.isFile() && file.name.endsWith('.mjs'))
    .map((file) => posix.join('gen-avatar', file.name)),
);

const earlyBootstrapEntry = viteConfigSource.match(
  /const entryPath = resolve\(process\.cwd\(\), '([^']+)'\)/,
)?.[1];

const containerRunner = readRepoFile(
  'cloudflare/cryptopunk-avatar-queue/Dockerfile',
).match(/CMD\s+\["node",\s*"\/app\/runner\/([^"]+)"\]/)?.[1];

describe('executable entry contract', () => {
  it('keeps the pinned dead-code audit report-only', () => {
    expect(packageJson.devDependencies.knip).toBe('6.32.2');
    expect(packageJson.scripts['dead-code:report']).toBe('knip --no-exit-code');
    expect(packageJson.scripts.check).not.toContain('dead-code:report');
  });

  it('classifies every script module as an executable root or imported-only helper', () => {
    expect(sorted(scriptModules)).toEqual(
      sorted(new Set([...executableScriptEntries, ...importedOnlyScriptModules])),
    );
  });

  it('keeps Knip synchronized with every executable and build-time root', () => {
    expect(earlyBootstrapEntry).toBe('src/main/earlyWorldTileBootstrap.classic.ts');
    expect(containerRunner).toBe('server.mjs');

    const expectedEntries = new Set([
      ...viteHtmlEntries,
      ...viteModuleEntries,
      'eslint.config.js',
      'vite.config.ts',
      'vitest.config.ts',
      earlyBootstrapEntry!,
      'src/pages/worker.ts',
      ...wranglerWorkerEntries,
      ...partyKitEntries,
      'cloudflare/cryptopunk-avatar-queue/runner/server.mjs',
      ...executableScriptEntries,
      ...generatorEntries,
    ]);
    const knipConfig = readRepoJson<KnipConfig>('knip.json');

    expect(sorted(knipConfig.entry)).toEqual(sorted(expectedEntries));
    expect(knipConfig.entry.every((entry) => !entry.includes('*'))).toBe(true);
    expect(knipConfig.entry).not.toContain('public/_worker.js');
    expect(knipConfig.entry).not.toContain('src/background-admin.ts');
    expect(knipConfig.entry).not.toContain('src/main.ts');

    for (const entry of knipConfig.entry) {
      expect(readFileSync(new URL(`../../${entry}`, import.meta.url))).toBeDefined();
    }
  });
});
