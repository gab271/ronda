import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { I18nextProvider, initReactI18next } from 'react-i18next'
import { createInstance } from 'i18next'

import esAuth from '~/i18n/locales/es/auth.json'
import enAuth from '~/i18n/locales/en/auth.json'

/**
 * Renders the sign-in route for real (jsdom) rather than only type-checking it.
 *
 * What this actually guards:
 *   - Spanish is what a user sees by default, with no explicit language choice.
 *   - The form is labelled, so it is reachable by keyboard and screen reader.
 *   - A failed sign-in produces a translated, actionable message rather than
 *     Supabase's developer-facing English string.
 */

const signInWithPassword = vi.fn<(args: unknown) => Promise<{ error: unknown }>>()

// The client is mocked so this test never needs network or credentials. Mocking
// at the module boundary (rather than stubbing fetch) keeps the test honest
// about what the component actually calls.
vi.mock('~/data/supabase/client', () => ({
  supabase: { auth: { signInWithPassword } },
}))

async function makeI18n(lng: 'es' | 'en' = 'es') {
  const instance = createInstance()
  await instance.use(initReactI18next).init({
    lng,
    fallbackLng: 'es',
    defaultNS: 'common',
    ns: ['auth'],
    resources: { es: { auth: esAuth }, en: { auth: enAuth } },
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
  })
  return instance
}

async function renderSignIn(lng: 'es' | 'en' = 'es') {
  const { default: SignInRoute } = await import('./SignInRoute')
  const i18n = await makeI18n(lng)
  const router = createMemoryRouter([{ path: '/entrar', Component: SignInRoute }], {
    initialEntries: ['/entrar'],
  })

  render(
    <I18nextProvider i18n={i18n}>
      <RouterProvider router={router} />
    </I18nextProvider>,
  )
}

describe('SignInRoute', () => {
  beforeEach(() => {
    signInWithPassword.mockReset()
  })

  it('renders in Spanish by default', async () => {
    await renderSignIn()

    expect(screen.getByRole('heading', { name: 'Entrar en Ronda' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Entrar' })).toBeInTheDocument()
  })

  it('labels every input, so the form is keyboard and screen-reader reachable', async () => {
    await renderSignIn()

    // getByLabelText fails unless label/input association is correct — this is
    // the assertion that catches a decorative <label> with no htmlFor.
    expect(screen.getByLabelText('Correo electrónico')).toBeInTheDocument()
    expect(screen.getByLabelText('Contraseña')).toBeInTheDocument()
  })

  it('shows a translated, actionable message when credentials are rejected', async () => {
    signInWithPassword.mockResolvedValue({
      error: { message: 'Invalid login credentials', code: 'invalid_credentials', status: 400 },
    })

    await renderSignIn()
    const user = userEvent.setup()

    await user.type(screen.getByLabelText('Correo electrónico'), 'club@example.es')
    await user.type(screen.getByLabelText('Contraseña'), 'wrong-password')
    await user.click(screen.getByRole('button', { name: 'Entrar' }))

    // Not Supabase's "Invalid login credentials".
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'El correo o la contraseña no son correctos.',
    )
  })

  it('renders in English when that language is active', async () => {
    await renderSignIn('en')

    expect(screen.getByRole('heading', { name: 'Sign in to Ronda' })).toBeInTheDocument()
  })
})
