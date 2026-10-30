# HTML Entry Points

The root HTML files are Vite multi-page entry points and stable URLs used by the app, Worker routes, metadata generation, and admin tooling. They should look intentional in the repository even though they are not typical static one-off files.

| File | Module root | Purpose |
| --- | --- | --- |
| `index.html` | `src/main/coarseFirstEntry.ts` | Main game/editor shell |
| `jam.html` | `src/jam.ts` | Solo Room Jam surface |
| `dashboard.html` | `src/dashboard.ts` | Signed-in user dashboard |
| `launch-admin.html` | `src/launch-admin.ts` | Unified launch, photo, comment, builder, and infrastructure admin surface |
| `guest-replays.html` | `src/admin/replays.ts` | Guest replay review |
| `bug-reports.html` | `src/admin/bugReports.ts` | Bug report review |
| `worlds-admin.html` | `src/worlds-admin.ts` | World administration |
| `background-admin.html` | Inline redirect | Compatibility redirect to Launch Admin photo review |
| `suspicious-admin.html` | `src/suspicious-admin.ts` | Suspicious run/admin review surface |
| `school-admin.html` | `src/school-admin.ts` | Classroom/teacher admin surface |
| `school-login.html` | `src/school-login.ts` | Classroom/student login surface |
| `minted-room.html` | `src/minted-room.ts` | Minted room metadata preview surface |
| `room-preview-render.html` | `src/room-preview-render.ts` | Room preview render surface used by metadata/backfill scripts |
| `world-tile-render.html` | `src/world-tile-render.ts` | Browser world-tile renderer used by the renderer Worker |


The main shell has one additional build-time entry: `vite.config.ts` reads and injects
`src/main/earlyWorldTileBootstrap.classic.ts` before
`src/main/coarseFirstEntry.ts` dynamically loads `src/main.ts`. Because the early
bootstrap is composed by Vite rather than imported from the application graph, it
must remain an explicit executable entry.

If a page is moved or renamed, update all of these together:

- `vite.config.ts` build inputs
- `knip.json` entry/project configuration
- `src/config/executableEntryContract.test.ts`
- Worker route helpers under `src/cloudflare/worker/`
- scripts that render room metadata or preview images
- in-page links between admin surfaces

`npm run dead-code:report` is intentionally report-only. It inventories findings
without participating in `npm run check`; findings become gating only after they
have been triaged.

`reward-stings-preview.html` is a developer-only page served by `vite dev` at
`/reward-stings-preview.html`. It is intentionally absent from production inputs
and executable roots. The documented `background-admin.html` compatibility
redirect remains in production; new photo-review links use Launch Admin directly.
