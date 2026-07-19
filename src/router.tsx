import { createBrowserRouter } from 'react-router-dom'

/**
 * All route objects live in this one file.
 *
 * ── Why data mode ───────────────────────────────────────────────────────────
 * createBrowserRouter (data mode), not declarative mode and not framework mode.
 *
 * Declarative mode costs a render → mount → effect → fetch waterfall, which on
 * the public page is a few hundred milliseconds of pure latency on exactly the
 * connection we cannot afford it on. Framework mode implies a server build and
 * takes over the Vite config — unquantified risk against Vite 8/Rolldown, in
 * exchange for features a static SPA does not use yet.
 *
 * Data mode also has the property that matters for milestone 4: the same route
 * objects can be rendered server-side with createStaticHandler/createStaticRouter,
 * so edge-rendering the public page is not a framework migration.
 *
 * Keeping every route here (rather than colocated) is what makes that migration
 * mechanical rather than archaeological.
 *
 * ── Why the public route is lazy ────────────────────────────────────────────
 * The object form of `lazy` lets the loader chunk download in parallel with the
 * component chunk, instead of after it. Combined with the public route importing
 * neither auth nor supabase-js, this is what keeps the storefront bundle small.
 *
 * ── URLs are Spanish ────────────────────────────────────────────────────────
 * /entrar, /panel — the audience is Spanish clubs, and the URL is part of the
 * product's voice. /t/:slug stays short because it is read aloud and typed by
 * hand at courts.
 */
export const router = createBrowserRouter([
  // ── Landing ───────────────────────────────────────────────────────────────
  // The front door. Imports no auth code and no supabase-js: a signed-in
  // organiser clicking "Entrar" is routed onward by the sign-in route itself.
  // Checking the session here would pull ~51KB of auth client onto the one page
  // whose entire job is to load fast for a stranger who has never heard of us.
  //
  // The loader preloads the `landing` namespace so the page never paints with
  // missing copy — a marketing page flashing empty strings is worse than a
  // slightly later paint.
  {
    path: '/',
    lazy: {
      loader: async () => {
        const { loadNamespace } = await import('./i18n/loadNamespace')
        return () => loadNamespace('landing')
      },
      Component: async () => (await import('./routes/landing/LandingRoute')).default,
    },
  },

  // ── Public storefront ─────────────────────────────────────────────────────
  // No auth, no session, no supabase-js. See eslint.config.js.
  {
    path: '/t/:slug',
    lazy: {
      loader: async () => (await import('./routes/public/publicLoader')).publicLoader,
      Component: async () =>
        (await import('./routes/public/PublicTournamentRoute')).default,
    },
  },

  // ── Organiser ─────────────────────────────────────────────────────────────
  {
    path: '/entrar',
    lazy: {
      Component: async () => (await import('./routes/auth/SignInRoute')).default,
    },
  },
  // The landing page's primary CTA. Spanish URL, matching /entrar and /panel.
  {
    path: '/registro',
    lazy: {
      Component: async () => (await import('./routes/auth/SignUpRoute')).default,
    },
  },
  // The organiser area sits under a layout that provides auth context. Nesting
  // it (rather than mounting AuthProvider at the root) is what keeps supabase-js
  // out of the public route's bundle — see OrganiserLayout.tsx.
  {
    lazy: {
      Component: async () => (await import('./routes/organiser/OrganiserLayout')).default,
    },
    children: [
      {
        path: '/panel',
        lazy: {
          loader: async () => (await import('./routes/organiser/requireSession')).requireSession,
          Component: async () => (await import('./routes/organiser/DashboardRoute')).default,
        },
      },
    ],
  },

  {
    path: '*',
    lazy: {
      Component: async () => (await import('./routes/NotFoundRoute')).default,
    },
  },
])
