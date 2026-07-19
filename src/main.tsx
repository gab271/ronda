import { StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router-dom'
import { I18nextProvider } from 'react-i18next'

import { initI18n, i18next } from './i18n'
import { router } from './router'

// The single global stylesheet. Every other stylesheet in the app is a CSS
// Module scoped to one component.
import './styles/global.css'

/**
 * i18n is initialised before the first render rather than rendering a fallback
 * and swapping strings in. Text reflowing after paint is worse than waiting a
 * few milliseconds for the statically bundled Spanish resources, which are
 * already in the main chunk.
 *
 * AuthProvider is deliberately NOT mounted here. It imports supabase-js, and
 * wrapping the whole tree would pull ~40KB of auth code into the public
 * tournament page's critical path. Auth is provided inside the organiser routes
 * only — the public storefront must stay free of it.
 */
async function bootstrap() {
  await initI18n()

  const container = document.getElementById('root')
  if (!container) {
    throw new Error('Root element #root is missing from index.html')
  }

  createRoot(container).render(
    <StrictMode>
      <I18nextProvider i18n={i18next}>
        <Suspense fallback={null}>
          <RouterProvider router={router} />
        </Suspense>
      </I18nextProvider>
    </StrictMode>,
  )
}

void bootstrap()
