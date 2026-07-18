import { spawnSync } from 'node:child_process';

const [action, ...rawArgs] = process.argv.slice(2);
const remote = rawArgs.includes('--remote');
const productionConfirmed = rawArgs.includes('--confirm-production');
const envIndex = rawArgs.indexOf('--env');
const environment = envIndex >= 0 ? rawArgs[envIndex + 1] : null;

if (action !== 'repair' && action !== 'parity') {
  console.error('Usage: npm run index:repair|index:parity -- [--remote] [--env safety] [--confirm-production]');
  process.exit(2);
}

if (remote && environment !== 'safety' && !productionConfirmed) {
  console.error('Production D1 access requires --confirm-production. Use --env safety for the safety database.');
  process.exit(2);
}

const commonArgs = ['wrangler', 'd1', 'execute', 'DB'];
if (remote) commonArgs.push('--remote');
else commonArgs.push('--local');
if (environment) commonArgs.push('--env', environment);

if (action === 'repair') {
  commonArgs.push('--file', 'migrations/0040_playable_content_index.sql');
} else {
  commonArgs.push(
    '--command',
    `SELECT
      (SELECT COUNT(*) FROM playable_content_index) AS indexed_targets,
      (SELECT COUNT(*) FROM playable_content_index WHERE target_type = 'room') AS standalone_targets,
      (SELECT COUNT(*) FROM playable_content_index WHERE target_type = 'expanded_room') AS expanded_targets,
      (SELECT COUNT(*) FROM (
        SELECT target_type, content_id, version_key, COUNT(*) AS count
        FROM playable_content_index
        GROUP BY target_type, content_id, version_key
        HAVING count > 1
      )) AS duplicate_targets,
      (SELECT COUNT(*)
       FROM playable_content_index standalone
       WHERE standalone.target_type = 'room'
         AND EXISTS (
           SELECT 1
           FROM expanded_rooms expanded
           INNER JOIN expanded_room_cells cells
             ON cells.expanded_room_id = expanded.id
            AND cells.expanded_room_version = expanded.published_version
           WHERE expanded.published_json IS NOT NULL
             AND expanded.archived_at IS NULL
             AND cells.room_id = standalone.content_id
             AND (SELECT COUNT(*)
                  FROM expanded_room_cells sibling
                  WHERE sibling.expanded_room_id = expanded.id
                    AND sibling.expanded_room_version = expanded.published_version) > 1
         )) AS unsuppressed_member_rooms,
      (SELECT COUNT(*)
       FROM playable_content_index
       WHERE representative_room_id IS NULL
          OR published_at IS NULL
          OR goal_type IS NULL) AS incomplete_targets;`,
  );
}

const result = spawnSync('npx', commonArgs, { stdio: 'inherit', shell: false });
if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 1);
