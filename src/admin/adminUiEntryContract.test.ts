import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));

const readRepoFile = (relativePath: string): string =>
  readFileSync(resolve(repoRoot, relativePath), 'utf8');

function readTypeScriptImportClosure(relativeEntry: string): string {
  const pending = [resolve(repoRoot, relativeEntry)];
  const visited = new Set<string>();
  const sources: string[] = [];

  while (pending.length > 0) {
    const filePath = pending.pop();
    if (!filePath || visited.has(filePath)) {
      continue;
    }

    visited.add(filePath);
    const source = readFileSync(filePath, 'utf8');
    sources.push(source);

    for (const match of source.matchAll(/(?:from\s+|import\s+)['"](\.[^'"]+)['"]/g)) {
      const specifier = match[1];
      const unresolvedPath = resolve(dirname(filePath), specifier);
      const candidates = [
        unresolvedPath,
        `${unresolvedPath}.ts`,
        join(unresolvedPath, 'index.ts'),
      ];
      const importedPath = candidates.find((candidate) => existsSync(candidate));
      if (importedPath?.endsWith('.ts')) {
        pending.push(importedPath);
      }
    }
  }

  return sources.join('\n');
}

function extractAttributeValues(source: string, attribute: string): string[] {
  const expression = new RegExp(`\\b${attribute}=["']([^"']+)["']`, 'g');
  return [...source.matchAll(expression)].map((match) => match[1]);
}

function expectRequiredIds(html: string, requiredIds: readonly string[]): void {
  const ids = new Set(extractAttributeValues(html, 'id'));
  for (const id of requiredIds) {
    expect(ids, `Missing #${id}`).toContain(id);
  }
}

const launchHtml = readRepoFile('launch-admin.html');
const suspiciousHtml = readRepoFile('suspicious-admin.html');
const viteConfig = readRepoFile('vite.config.ts');
const launchRuntime = readTypeScriptImportClosure('src/launch-admin.ts');
const suspiciousRuntime = readTypeScriptImportClosure('src/suspicious-admin.ts');

describe('admin UI executable entry contract', () => {
  it('keeps both standalone HTML URLs and module entry paths stable', () => {
    expect(viteConfig).toContain("launchAdmin: resolve(process.cwd(), 'launch-admin.html')");
    expect(viteConfig).toContain("suspiciousAdmin: resolve(process.cwd(), 'suspicious-admin.html')");
    expect(launchHtml).toMatch(
      /<script\s+type="module"\s+src="\/src\/launch-admin\.ts"><\/script>/,
    );
    expect(suspiciousHtml).toMatch(
      /<script\s+type="module"\s+src="\/src\/suspicious-admin\.ts"><\/script>/,
    );
    expect(launchHtml).toContain('href="/suspicious-admin.html"');
    expect(suspiciousHtml).toContain('href="/launch-admin.html"');
  });

  it('keeps the shared admin key in session storage and launch preferences in local storage', () => {
    for (const runtime of [launchRuntime, suspiciousRuntime]) {
      expect(runtime).toContain('ep_launch_admin_api_key');
      expect(runtime).toContain('sessionStorage.getItem');
      expect(runtime).toContain('sessionStorage.setItem');
      expect(runtime).toContain('sessionStorage.removeItem');
    }

    for (const storageKey of [
      'ep_launch_admin_activity_range',
      'ep_launch_admin_activity_filter',
      'ep_launch_admin_game_jam',
    ]) {
      expect(launchRuntime).toContain(storageKey);
    }
    expect(launchRuntime).toContain('localStorage.getItem');
    expect(launchRuntime).toContain('localStorage.setItem');
  });

  it('keeps launch navigation as native hash links with persisted activity and Game Jam choices', () => {
    const hashLinks = extractAttributeValues(launchHtml, 'href').filter((href) =>
      href.startsWith('#'),
    );
    expect(hashLinks).toEqual([
      '#overview',
      '#game-jams',
      '#photo-review',
      '#sprite-review',
      '#comment-review',
      '#builders',
      '#activity',
      '#infrastructure',
    ]);

    const ids = new Set(extractAttributeValues(launchHtml, 'id'));
    for (const hash of hashLinks) {
      expect(ids).toContain(hash.slice(1));
    }

    expect(launchRuntime).toMatch(
      /localStorage\.setItem\(\s*ACTIVITY_RANGE_STORAGE_KEY\s*,/,
    );
    expect(launchRuntime).toMatch(
      /localStorage\.setItem\(\s*ACTIVITY_FILTER_STORAGE_KEY\s*,/,
    );
    expect(launchRuntime).toMatch(
      /localStorage\.setItem\(\s*GAME_JAM_STORAGE_KEY\s*,/,
    );
  });

  it('characterizes the Suspicious queue tab as memory-only and defaulting to All', () => {
    expect(extractAttributeValues(suspiciousHtml, 'data-queue-tab')).toEqual([
      'all',
      'real_players',
      'generated_signals',
    ]);
    expect(suspiciousRuntime).toMatch(/queueTab:\s*'all'/);
    expect(suspiciousRuntime).not.toContain('localStorage');
    expect(suspiciousRuntime).not.toContain('location.hash');
    expect(suspiciousRuntime).not.toContain('history.pushState');
    expect(suspiciousRuntime).not.toContain('history.replaceState');
  });

  it('characterizes both pages as having no sorting control', () => {
    for (const html of [launchHtml, suspiciousHtml]) {
      const interactiveMarkup = html
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<script[\s\S]*?<\/script>/gi, '');
      expect(interactiveMarkup).not.toMatch(/\b(?:sort|sorting)\b/i);
    }
    expect(launchRuntime).not.toContain('data-sort');
    expect(suspiciousRuntime).not.toContain('data-sort');
  });
});

describe('admin UI DOM contract', () => {
  it('keeps the Launch Admin controller and renderer anchors available', () => {
    expectRequiredIds(launchHtml, [
      'admin-key-input',
      'save-key-button',
      'refresh-button',
      'clear-key-button',
      'auth-status',
      'last-updated',
      'warnings',
      'config-chips',
      'totals-grid',
      'game-jam-select',
      'game-jam-refresh-button',
      'game-jam-status',
      'game-jam-summary',
      'game-jam-participants-body',
      'activity-range-select',
      'activity-range-summary',
      'activity-filter-list',
      'activity-grid',
      'activity-feed',
      'partykit-summary',
      'partykit-shards-body',
      'progression-admin-panel',
      'progression-query-input',
      'progression-search-button',
      'progression-operator-input',
      'progression-status',
      'progression-results',
      'progression-selected',
      'progression-claim-input',
      'progression-publish-input',
      'progression-object-input',
      'progression-collectible-input',
      'progression-expanded-room-input',
      'progression-reason-input',
      'progression-save-button',
      'progression-clear-button',
      'room-comments-status-filter',
      'room-comments-operator-input',
      'room-comments-refresh-button',
      'room-comments-status',
      'room-comments-list',
    ]);
  });

  it('keeps the Suspicious Admin controller and renderer anchors available', () => {
    expectRequiredIds(suspiciousHtml, [
      'admin-key-input',
      'save-key-button',
      'refresh-button',
      'clear-key-button',
      'auth-status',
      'last-updated',
      'window-hours-select',
      'severity-select',
      'signal-select',
      'search-input',
      'apply-filters-button',
      'summary-grid',
      'recent-invalidations',
      'queue-heading',
      'queue-count',
      'queue-tabs',
      'queue-list',
      'detail-empty',
      'detail-shell',
      'detail-status',
      'detail-user-name',
      'detail-user-severity',
      'detail-user-meta',
      'detail-signals',
      'reason-input',
      'operator-label-input',
      'selection-summary',
      'select-all-runs-button',
      'clear-selected-runs-button',
      'preview-button',
      'execute-button',
      'action-status',
      'detail-room-runs',
      'detail-course-runs',
      'detail-point-events',
      'detail-invalidations',
      'preview-empty',
      'preview-shell',
      'preview-meta',
      'preview-users',
      'preview-point-events',
    ]);
  });
});

describe('admin UI API request contract', () => {
  it('pins Suspicious Admin routes, filters, authentication, and JSON request headers', () => {
    expect(suspiciousRuntime).toContain('/api/admin/suspicious/summary');
    expect(suspiciousRuntime).toContain('/api/admin/suspicious/users');
    expect(suspiciousRuntime).toMatch(
      /\/api\/admin\/suspicious\/users\/\$\{encodeURIComponent\([^)]+\)\}\/invalidate-preview/,
    );
    expect(suspiciousRuntime).toMatch(
      /\/api\/admin\/suspicious\/users\/\$\{encodeURIComponent\([^)]+\)\}\/invalidate/,
    );
    for (const parameter of ['windowHours', 'severity', 'signal', 'q', 'history']) {
      expect(suspiciousRuntime).toMatch(new RegExp(`\\.set\\('${parameter}'`));
    }
    expect(suspiciousRuntime).toContain("'Content-Type': 'application/json'");
    expect(suspiciousRuntime).toContain("'x-admin-key':");
    expect(suspiciousRuntime).toContain("method: 'POST'");
    expect(suspiciousRuntime).toContain("throw new Error('Invalid admin key.')");
  });

  it('pins Launch Admin routes, authentication, polling cadence, and mutation content type', () => {
    for (const endpoint of [
      '/api/admin/launch-stats',
      '/api/admin/game-jams',
      '/api/admin/progression/users?query=',
      '/api/admin/room-comments?status=',
    ]) {
      expect(launchRuntime).toContain(endpoint);
    }
    expect(launchRuntime).toMatch(
      /\/api\/admin\/progression\/users\/\$\{encodeURIComponent\([^)]+\)\}\/caps/,
    );
    expect(launchRuntime).toMatch(
      /\/api\/admin\/room-comments\/\$\{encodeURIComponent\([^)]+\)\}\/review/,
    );
    expect(launchRuntime).toContain("'x-admin-key':");
    expect(launchRuntime).toContain("'content-type': 'application/json'");
    expect(launchRuntime).toContain("const POLL_INTERVAL_MS = 10_000");
    expect(launchRuntime).toContain("document.visibilityState === 'visible'");
    expect(launchRuntime).toContain("throw new Error('Invalid admin key.')");
  });
});
