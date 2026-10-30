import tseslint from 'typescript-eslint';

// New files stay under 1,500 non-blank lines. Files already over it are pinned at their size so
// they can shrink but not grow (F067). A pin must match its file's current size, counted as
// max-lines counts it (non-blank lines, comments included), give or take 25 lines: when a pinned
// file shrinks by more, lower its pin, and delete the pin once the file is at or under 1,500. A pin
// never goes up. `npm run max-lines:pins -- --write` does both, and scripts/check_max_lines_pins.test.ts
// fails `npm test` when a pin sits more than 25 lines above its file (F498).
const MAX_LINES = 1500;
const OVERSIZED_FILE_LINES = {
  'src/scenes/OverworldPlayScene.ts': 5141,
  'src/scenes/overworld/worldStreaming.ts': 5065,
  'src/scenes/CourseEditorScene.ts': 2908,
  'src/scenes/editor/editRuntime.ts': 3277,
  'src/scenes/overworld/liveObjects/swordsmanController.ts': 2596,
  'src/scenes/overworld/liveObjects.ts': 2341,
  'src/scenes/editor/uiBridge.ts': 2176,
  'src/scenes/EditorScene.ts': 1871,
  'src/scenes/overworld/worldTiles/controller.ts': 1955,
  'src/cloudflare/worker/rooms/store.ts': 1770,
  'src/admin/launch/app.ts': 1816,
  'src/main/earlyWorldTileBootstrap.classic.ts': 1718,
  'src/scenes/overworld/movementController.ts': 1627,
  'src/ui/setup/paletteController.ts': 1584,
  'src/ui/setup/profileModal.ts': 1553,
  'src/scenes/editor/musicPatternEditor.ts': 1514,
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
