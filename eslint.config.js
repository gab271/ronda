import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import jsxA11y from 'eslint-plugin-jsx-a11y'
import i18next from 'eslint-plugin-i18next'

/**
 * Ronda lint configuration.
 *
 * This file exists mostly to enforce three architectural boundaries that are
 * otherwise unenforceable and expensive to repair once violated:
 *
 *   1. src/engine/** is pure — no React, no network, no Supabase.
 *   2. The public tournament route never reaches auth or supabase-js.
 *   3. No user-facing string is hardcoded (Spanish-first i18n).
 *
 * These rules are written before any feature code because retrofitting them
 * means fixing every violation at once, which never happens.
 */
export default tseslint.config(
  { ignores: ['dist', 'coverage', 'node_modules', 'supabase/.temp'] },

  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,

  {
    languageOptions: {
      parserOptions: {
        // Every tsconfig is listed explicitly rather than using projectService.
        // The configs deliberately partition the codebase (app / engine / test /
        // build), so no single "nearest tsconfig.json" covers everything — test
        // files in particular are excluded from tsconfig.json on purpose.
        project: [
          './tsconfig.json',
          './tsconfig.engine.json',
          './tsconfig.test.json',
          './tsconfig.node.json',
        ],
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  // Plain JS config files are not part of any TypeScript project, so type-aware
  // rules cannot run on them and would otherwise error.
  {
    files: ['**/*.js', '**/*.mjs'],
    extends: [tseslint.configs.disableTypeChecked],
  },

  // ---------------------------------------------------------------------------
  // Application code
  // ---------------------------------------------------------------------------
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'jsx-a11y': jsxA11y,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      ...jsxA11y.flatConfigs.recommended.rules,

      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // `enum` and `namespace` are banned by erasableSyntaxOnly in tsconfig; this
      // gives a clearer message at lint time than the compiler error does.
      '@typescript-eslint/no-namespace': 'error',

      // React Router's redirect() returns a Response, and `throw redirect(...)`
      // from a loader is the documented way to guard a route — the throw is how
      // the router interrupts the navigation. Allowing Response here keeps the
      // rule's real value (catching `throw 'a string'`) without fighting the
      // framework.
      '@typescript-eslint/only-throw-error': ['error', { allow: [{ from: 'lib', name: 'Response' }] }],
    },
  },

  // ---------------------------------------------------------------------------
  // BOUNDARY 1 — engine purity
  //
  // tsconfig.engine.json is the real gate (no DOM lib means DOM APIs cannot
  // type-check). This adds the import-level half, which types alone cannot
  // express: React and Supabase have perfectly valid types, they just have no
  // business in a fixture-generation algorithm.
  // ---------------------------------------------------------------------------
  {
    files: ['src/engine/**/*.ts'],
    languageOptions: {
      // Not browser, not node. The engine gets no ambient globals at all.
      globals: {},
    },
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'react', message: 'src/engine must stay framework-free.' },
            { name: 'react-dom', message: 'src/engine must stay framework-free.' },
            { name: 'react-router-dom', message: 'src/engine must stay framework-free.' },
            { name: 'i18next', message: 'The engine has no user-facing strings by design.' },
            { name: 'react-i18next', message: 'The engine has no user-facing strings by design.' },
          ],
          patterns: [
            {
              group: ['@supabase/*'],
              message: 'src/engine must not touch the database. Pass data in as arguments.',
            },
            {
              group: ['~/data/*', '~/routes/*', '~/features/*', '~/ui/*', '~/i18n/*'],
              message: 'src/engine may only import from src/engine.',
            },
            {
              group: ['../data/*', '../routes/*', '../features/*', '../ui/*', '../i18n/*'],
              message: 'src/engine may only import from src/engine.',
            },
          ],
        },
      ],
      // Deterministic fixtures require a seeded PRNG (src/engine/rng.ts) whose
      // seed is persisted, so a disputed bracket can be reproduced exactly.
      'no-restricted-properties': [
        'error',
        {
          object: 'Math',
          property: 'random',
          message:
            'Use the seeded PRNG in src/engine/rng.ts. Draws must be reproducible from tournaments.draw_seed.',
        },
      ],
      'no-restricted-globals': [
        'error',
        { name: 'fetch', message: 'src/engine must not perform I/O.' },
        { name: 'window', message: 'src/engine must not touch the DOM.' },
        { name: 'document', message: 'src/engine must not touch the DOM.' },
        { name: 'localStorage', message: 'src/engine must not touch browser storage.' },
      ],
    },
  },

  // ---------------------------------------------------------------------------
  // BOUNDARY 2 — the public tournament route
  //
  // The public page is the storefront: it must be fast on bad 4G and must render
  // identically for an anonymous player and for a signed-in organiser previewing
  // the link. Importing supabase-js here would break both — it adds ~40KB gzip of
  // auth/realtime/storage, and it would attach the organiser's JWT so RLS
  // evaluates as `authenticated` rather than `anon`.
  //
  // Use src/data/public/publicClient.ts instead: a plain fetch wrapper that sends
  // no user token and runs unmodified in a Cloudflare Worker (milestone 4).
  // ---------------------------------------------------------------------------
  {
    files: ['src/routes/public/**/*.{ts,tsx}', 'src/data/public/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@supabase/*'],
              message:
                'The public route must not bundle supabase-js. Use src/data/public/publicClient.ts (fetch-based, anon-only, Worker-portable).',
            },
            {
              group: ['~/features/auth/*', '../../features/auth/*', '~/data/supabase/*'],
              message:
                'The public route must not reach auth code. It renders for anonymous visitors only.',
            },
          ],
        },
      ],
    },
  },

  // ---------------------------------------------------------------------------
  // BOUNDARY 3 — no hardcoded user-facing strings
  //
  // Scoped to the surfaces that actually render text. The engine is excluded
  // because it has no user-facing strings by construction, and lib/ and data/
  // deal in identifiers rather than copy.
  // ---------------------------------------------------------------------------
  {
    files: ['src/routes/**/*.tsx', 'src/features/**/*.tsx', 'src/ui/**/*.tsx'],
    plugins: { i18next },
    rules: {
      // 'jsx-text-only' checks rendered text nodes. Attribute-level copy
      // (aria-label, placeholder, title) is covered by the callee/attribute
      // defaults the plugin ships; className and data-* stay structural.
      'i18next/no-literal-string': ['error', { mode: 'jsx-text-only' }],
    },
  },

  // ---------------------------------------------------------------------------
  // Tests and build-time files
  // ---------------------------------------------------------------------------
  {
    files: ['src/**/*.test.{ts,tsx}', 'src/test/**/*.ts'],
    rules: {
      'i18next/no-literal-string': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
    },
  },
  {
    files: ['vite.config.ts', 'scripts/**/*.{js,mjs,ts}', 'eslint.config.js'],
    languageOptions: {
      globals: globals.node,
    },
    rules: {
      'i18next/no-literal-string': 'off',
    },
  },
)
