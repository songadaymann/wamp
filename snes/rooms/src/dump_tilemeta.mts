// Dumps snes/tools/tilemeta.json: {"<gid>": {"solid": bool, "kind": string|null}} for every gid
// of the SNES ruleset-v0 tile library (ARCHITECTURE.md 2.1), straight from the repo's own
// getTerrainCollisionProfileForGid / getSpecialTileKindForGid.
//
//   WAMP_SRC=<copy of /home/user/wamp/src with @tonaljs/key + tonal resolvable> \
//     npx --yes tsx dump_tilemeta.mts <out.json>
// (see build.sh, which prepares the scratch copy)
import { writeFileSync } from 'node:fs';

const R = process.env.WAMP_SRC;
if (!R) throw new Error('set WAMP_SRC to a scratch copy of the WAMP src/ directory (see build.sh)');
const { getTerrainCollisionProfileForGid, getSpecialTileKindForGid, getTilesetByGid } = await import(`${R}/config.ts`);

// [firstGid, lastGid] of contract table 2.1
const RANGES: [number, number][] = [
  [1, 72], [73, 144], [217, 321], [322, 387], [388, 459], [492, 536], [669, 732], [2073, 2076], [2077, 2148],
];
const out: Record<string, { solid: boolean; kind: string | null; tileset: string }> = {};
for (const [a, b] of RANGES) {
  for (let gid = a; gid <= b; gid += 1) {
    const ts = getTilesetByGid(gid);
    if (!ts) throw new Error(`gid ${gid} has no tileset`);
    out[String(gid)] = {
      solid: Boolean(getTerrainCollisionProfileForGid(gid).hasCollision),
      kind: getSpecialTileKindForGid(gid) ?? null,
      tileset: ts.key,
    };
  }
}
writeFileSync(process.argv[2] ?? 'tilemeta.json', JSON.stringify(out, null, 0).replace(/\},/g, '},\n') + '\n');
console.log(`tilemeta: ${Object.keys(out).length} gids`);
