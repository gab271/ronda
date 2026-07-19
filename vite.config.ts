import { fileURLToPath, URL } from 'node:url'
// defineConfig comes from vitest/config so the `test` key is typed; loadEnv and
// the Plugin type are not re-exported there, so they come from vite itself.
import { loadEnv, type Plugin } from 'vite'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

/**
 * Injects `<link rel="preconnect">` for the Supabase origin into index.html.
 *
 * Why: the public tournament page's first paint is gated on a request to a
 * brand-new origin, which costs DNS + TCP + TLS (~3 round trips, easily 500ms+
 * on the bad 4G this page is designed for). Preconnect overlaps that handshake
 * with bundle download instead of serialising after it.
 *
 * This is done as a plugin rather than a hardcoded tag because the origin is
 * environment-specific and must not be duplicated between .env and index.html.
 */
function supabasePreconnect(supabaseUrl: string): Plugin {
  return {
    name: 'ronda:supabase-preconnect',
    transformIndexHtml() {
      if (!supabaseUrl) return []
      let origin: string
      try {
        origin = new URL(supabaseUrl).origin
      } catch {
        // A malformed URL is caught loudly at runtime by src/lib/env.ts. Here we
        // just decline to emit a broken tag rather than failing the whole build.
        return []
      }
      return [
        {
          tag: 'link',
          attrs: { rel: 'preconnect', href: origin, crossorigin: '' },
          injectTo: 'head-prepend' as const,
        },
        {
          tag: 'link',
          attrs: { rel: 'dns-prefetch', href: origin },
          injectTo: 'head-prepend' as const,
        },
      ]
    },
  }
}

export default defineConfig(({ mode }) => {
  // Only VITE_-prefixed vars are loaded, matching what actually reaches the client.
  const env = loadEnv(mode, process.cwd(), 'VITE_')

  return {
    plugins: [react(), supabasePreconnect(env['VITE_SUPABASE_URL'] ?? '')],

    resolve: {
      alias: {
        '~': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },

    css: {
      modules: {
        // Forces `styles.matchCard` as the only valid access form, so a rename
        // in CSS surfaces as a TypeScript error rather than an undefined class.
        localsConvention: 'camelCaseOnly',
      },
    },

    build: {
      // NOTE: Vite 8 is Rolldown/Oxc based. The option is `rolldownOptions`, not
      // `rollupOptions` — the old name is accepted but deprecated and silently
      // does nothing in places. Do not set the `esbuild` key at all; Vite 8 uses Oxc.
      target: 'es2022',
      sourcemap: true,
      // Report compressed size so the public-route budget is visible on every build.
      reportCompressedSize: true,
    },

    test: {
      // Vitest 4 removed the `workspace` field. `projects` is the replacement.
      // Two projects, and the split doubles as engine-purity enforcement: engine
      // tests run with environment 'node', so a DOM API in engine code fails the
      // test run and not just the typecheck.
      projects: [
        {
          extends: true,
          test: {
            name: { label: 'engine', color: 'cyan' },
            environment: 'node',
            include: ['src/engine/**/*.test.ts'],
          },
        },
        {
          extends: true,
          test: {
            name: { label: 'app', color: 'magenta' },
            environment: 'jsdom',
            setupFiles: ['./src/test/setup.ts'],
            include: ['src/**/*.test.{ts,tsx}'],
            exclude: ['src/engine/**', 'src/**/*.ssr.test.{ts,tsx}'],
          },
        },
        {
          extends: true,
          test: {
            // SSR-safety project: renders public route components with
            // renderToString in a DOM-less environment. Written in milestone 1
            // against a placeholder on purpose — this is exactly the guarantee
            // that rots silently if it is not checked from the start, and
            // milestone 4 moves the public page to edge rendering.
            name: { label: 'ssr', color: 'yellow' },
            environment: 'node',
            include: ['src/**/*.ssr.test.{ts,tsx}'],
          },
        },
      ],
    },
  }
})
