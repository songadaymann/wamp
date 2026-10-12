# Part of F070: goal-type switches

| Item | PR | Merge | Delivery |
|---|---|---|---|
| F070 (part) exhaustive goal switches and verification default | [#183](https://github.com/songadaymann/wamp/pull/183) | `6a8c132c` | Pages and API Worker `c0184a09` |

## What changed
- **Ranked verification:** any goal type it has no rule for now fails verification. Before, a newly added goal type would have passed with no checks.
- **Goal-type switches:** the code that draws goal flags (in play and in the editor), the code that checks goals each frame, and course marker validation now list every goal type. A new goal type has to be handled in each of them before typecheck or lint passes.
- **Lint rule:** a switch without a `default` must cover every case. Only three switches elsewhere needed a small change.

## Evidence
- `npm run check` passed (3,480 tests). CI passed, including the phone smoke.
- The new test, "unknown goal type fails verification", fails on main and passes here.
- **Simulated new goal type:**
  - typecheck flags `verification.ts`;
  - lint flags the three client goal switches;
  - before this change, `verification.ts` stayed silent.
- **API Worker `c0184a09`:** production smoke ok, `/api/health` 200.

## Left
- The typed goal registries (steps b–d of the review).
