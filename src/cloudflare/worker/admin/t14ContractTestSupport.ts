import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { D1Database, D1PreparedStatement } from '../core/types';

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));

export interface RecordedD1Query {
  database: string;
  sql: string;
  bindings: unknown[];
}

type QueryResult = {
  first?: Record<string, unknown> | null;
  rows?: Array<Record<string, unknown>>;
};

export function readRepoFile(relativePath: string): string {
  return readFileSync(resolve(repoRoot, relativePath), 'utf8');
}

export function readTypeScriptImportClosure(relativeEntry: string): string {
  const pending = [resolve(repoRoot, relativeEntry)];
  const visited = new Set<string>();
  const sources: string[] = [];

  while (pending.length > 0) {
    const filePath = pending.pop();
    if (!filePath || visited.has(filePath)) continue;

    visited.add(filePath);
    const source = readFileSync(filePath, 'utf8');
    sources.push(source);

    for (const match of source.matchAll(/(?:from\s+|import\s+)['"](\.[^'"]+)['"]/g)) {
      const specifier = match[1];
      if (!specifier) continue;
      const unresolvedPath = resolve(dirname(filePath), specifier);
      const importedPath = [
        unresolvedPath,
        `${unresolvedPath}.ts`,
        join(unresolvedPath, 'index.ts'),
      ].find((candidate) => existsSync(candidate));
      if (importedPath?.endsWith('.ts')) pending.push(importedPath);
    }
  }

  return sources.join('\n');
}

export function normalizeSql(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim();
}

export function createRecordingDatabase(
  database: string,
  queries: RecordedD1Query[],
  resolveQuery: (query: RecordedD1Query) => QueryResult = () => ({}),
): D1Database {
  class Statement implements D1PreparedStatement {
    private readonly record: RecordedD1Query;

    constructor(sql: string) {
      this.record = { database, sql: normalizeSql(sql), bindings: [] };
      queries.push(this.record);
    }

    bind(...bindings: unknown[]): D1PreparedStatement {
      this.record.bindings = bindings;
      return this;
    }

    async first<T>(): Promise<T | null> {
      const result = resolveQuery(this.record);
      return (result.first ?? result.rows?.[0] ?? null) as T | null;
    }

    async all<T>(): Promise<{ results: T[] }> {
      return { results: (resolveQuery(this.record).rows ?? []) as T[] };
    }
  }

  return {
    prepare(sql: string): D1PreparedStatement {
      return new Statement(sql);
    },
    async batch<T>(statements: D1PreparedStatement[]): Promise<T[]> {
      return Promise.all(statements.map(async (statement) => await statement.all() as T));
    },
  };
}
