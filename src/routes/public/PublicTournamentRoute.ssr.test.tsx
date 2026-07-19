import { describe, expect, it } from 'vitest'
import { renderToString } from 'react-dom/server'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { I18nextProvider } from 'react-i18next'
import { createInstance } from 'i18next'
import { initReactI18next } from 'react-i18next'

import PublicTournamentRoute from './PublicTournamentRoute'
import type { PublicLoaderData } from './publicLoader'
import esPublic from '~/i18n/locales/es/public.json'
import esCommon from '~/i18n/locales/es/common.json'

/**
 * SSR-SAFETY GUARANTEE for the public tournament page.
 *
 * This test runs in a DOM-less node environment (see the `ssr` project in
 * vite.config.ts) and renders the public route with renderToString. If anyone
 * introduces a `window`/`document` reference at module scope or during render,
 * this fails immediately.
 *
 * It is written in milestone 1, against a placeholder component, on purpose.
 * Milestone 4 moves this page to edge rendering in a Cloudflare Worker, and
 * SSR-safety is exactly the kind of property that silently rots if it is only
 * checked at the point it becomes necessary — by then there are fifty components
 * to fix at once. Checking it from the first commit keeps the cost at zero.
 */

async function makeI18n() {
  const instance = createInstance()
  await instance.use(initReactI18next).init({
    lng: 'es',
    fallbackLng: 'es',
    defaultNS: 'common',
    ns: ['common', 'public'],
    resources: { es: { common: esCommon, public: esPublic } },
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
  })
  return instance
}

function renderRoute(loaderData: PublicLoaderData, i18n: Awaited<ReturnType<typeof makeI18n>>) {
  const router = createMemoryRouter(
    [
      {
        path: '/t/:slug',
        Component: PublicTournamentRoute,
        loader: () => loaderData,
      },
    ],
    { initialEntries: ['/t/aB3xK9pQ2m'] },
  )

  return renderToString(
    <I18nextProvider i18n={i18n}>
      <RouterProvider router={router} />
    </I18nextProvider>,
  )
}

describe('PublicTournamentRoute server rendering', () => {
  it('has no DOM available in this environment', () => {
    // Guards the guard: if the project config regressed to jsdom, this test
    // would pass vacuously and prove nothing.
    expect(typeof globalThis.document).toBe('undefined')
  })

  it('renders without touching browser globals', async () => {
    const i18n = await makeI18n()

    expect(() => {
      renderRoute({ tournament: null, errorKind: null }, i18n)
    }).not.toThrow()
  })

  it('renders each error state without a DOM', async () => {
    const i18n = await makeI18n()

    for (const kind of ['not-found', 'offline', 'server'] as const) {
      expect(() => {
        renderRoute({ tournament: null, errorKind: kind }, i18n)
      }, `errorKind=${kind}`).not.toThrow()
    }
  })
})
