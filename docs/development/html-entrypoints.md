# HTML Entry Points

The root HTML files are Vite multi-page entry points and stable URLs used by the app, Worker routes, metadata generation, and admin tooling. They should look intentional in the repository even though they are not typical static one-off files.

| File | Purpose |
| --- | --- |
| `index.html` | Main game/editor shell |
| `dashboard.html` | Signed-in user dashboard |
| `launch-admin.html` | Launch and comment review admin surface |
| `background-admin.html` | User-uploaded background review admin surface |
| `suspicious-admin.html` | Suspicious run/admin review surface |
| `school-admin.html` | Classroom/teacher admin surface |
| `school-login.html` | Classroom/student login surface |
| `minted-room.html` | Minted room metadata preview surface |
| `room-preview-render.html` | Room preview render surface used by metadata/backfill scripts |
| `reward-stings-preview.html` | Reward animation preview surface |

If a page is moved or renamed, update all of these together:

- `vite.config.ts` build inputs
- `knip.json` entry/project configuration
- Worker route helpers under `src/cloudflare/worker/`
- scripts that render room metadata or preview images
- in-page links between admin surfaces
