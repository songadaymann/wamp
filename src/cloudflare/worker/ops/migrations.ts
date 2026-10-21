/**
 * The newest file in migrations/. /api/health compares it with the database, so a Worker
 * deployed before `wrangler d1 migrations apply` reports 503. migrations.test.ts fails
 * when a new migration is added without updating this.
 */
export const LATEST_D1_MIGRATION = '0070_account_suspension.sql';
