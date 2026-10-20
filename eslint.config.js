import tseslint from 'typescript-eslint';

// New files stay under 1,500 non-blank lines. Files already over it are pinned at their size on
// 2026-10-11 so they can shrink but not grow; lower a number when you split a file (F067).
const MAX_LINES = 1500;
const OVERSIZED_FILE_LINES = {
  'src/scenes/OverworldPlayScene.ts': 6355,
  'src/scenes/overworld/worldStreaming.ts': 5765,
  'src/scenes/CourseEditorScene.ts': 3464,
  'src/scenes/editor/editRuntime.ts': 3287,
  'src/scenes/overworld/liveObjects/swordsmanController.ts': 2608,
  'src/scenes/overworld/liveObjects.ts': 2340,
  'src/scenes/editor/uiBridge.ts': 2257,
  'src/scenes/EditorScene.ts': 1984,
  'src/scenes/overworld/worldTiles/controller.ts': 1975,
  'src/cloudflare/worker/rooms/store.ts': 1819,
  'src/admin/launch/app.ts': 1816,
  'src/cloudflare/worker/runs/difficulty.ts': 1762,
  'src/main/earlyWorldTileBootstrap.classic.ts': 1718,
  'src/scenes/overworld/movementController.ts': 1638,
  'src/ui/setup/paletteController.ts': 1590,
  'src/ui/setup/profileModal.ts': 1556,
  'src/scenes/editor/musicPatternEditor.ts': 1528,
  'src/scenes/editor/musicWorkflow.ts': 1488,
  'src/scenes/overworld/roomComments.ts': 1483,
  'src/autotiling/solver.ts': 1503,
};

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'src/cloudflare/worker/exports/**',
      'src/cloudflare/emailExportWorker.ts',
      'scripts/build/**',
    ],
  },
  {
    files: ['src/**/*.ts', 'partykit/**/*.ts', 'scripts/**/*.ts'],
    plugins: {
      '@typescript-eslint': tseslint.plugin,
    },
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        projectService: {
          allowDefaultProject: [
            'scripts/runtime_performance_trace.test.ts',
            'scripts/smoke_worlds_pilot.ts',
            'scripts/world_tile_asset_contract_check.ts',
            'scripts/smoke_activity_tabs.ts',
            'scripts/reconcile-room-token-cache.ts',
          ],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      // An async function passed where a void callback is expected (an event listener, say)
      // drops its rejection. Checking `if (promise)` on purpose is allowed.
      '@typescript-eslint/no-misused-promises': ['error', { checksConditionals: false }],
      // A switch over a union with no default must list every member, so a new goal type,
      // tool or object category can't fall through unhandled (F070). A default opts out.
      '@typescript-eslint/switch-exhaustiveness-check': ['error', {
        considerDefaultExhaustiveForUnions: true,
        requireDefaultForNonUnion: false,
      }],
      'max-lines': ['error', { max: MAX_LINES, skipBlankLines: true }],
    },
  },
  ...Object.entries(OVERSIZED_FILE_LINES).map(([file, max]) => ({
    files: [file],
    rules: { 'max-lines': ['error', { max, skipBlankLines: true }] },
  })),
  {
    // Test doubles are routinely async where the real callback is not.
    files: ['**/*.test.ts'],
    rules: { '@typescript-eslint/no-misused-promises': 'off', 'max-lines': 'off' },
  },
  {
    files: ['scripts/**/*.js', 'scripts/**/*.mjs'],
    ...tseslint.configs.disableTypeChecked,
  },
);
