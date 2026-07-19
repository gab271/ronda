import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { I18nextProvider, initReactI18next } from 'react-i18next'
import { createInstance } from 'i18next'

import esAuth from '~/i18n/locales/es/auth.json'
import enAuth from '~/i18n/locales/en/auth.json'

/**
 * What this guards, beyond "the component renders":
 *   - The 8-character rule the copy promises is actually enforced, and enforced
 *     before the network call rather than by a server whose own minimum is 6.
 *   - An already-registered address does not produce a different visible result
 *     from a new one. That is a privacy property, and it is exactly the kind
 *     that a well-meaning "improve the error message" change would undo.
 *   - Both post-signup branches (confirmation required / already signed in) go
 *     somewhere sensible.
 */

const signUp =
  vi.fn<
    (args: unknown) => Promise<{
      data: { session: unknown; user: unknown }
      error: unknown
    }>
  >()

vi.mock('~/data/supabase/client', () => ({
  supabase: { auth: { signUp } },
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

async function renderSignUp(lng: 'es' | 'en' = 'es') {
  const { default: SignUpRoute } = await import('./SignUpRoute')
  const i18n = await makeI18n(lng)
  const router = createMemoryRouter(
    [
      { path: '/registro', Component: SignUpRoute },
      // Real destination so the redirect branch is observable rather than mocked.
      { path: '/panel', Component: () => <h1>Panel</h1> },
    ],
    { initialEntries: ['/registro'] },
  )

  render(
    <I18nextProvider i18n={i18n}>
      <RouterProvider router={router} />
    </I18nextProvider>,
  )
}

async function fillAndSubmit(email: string, password: string) {
  const user = userEvent.setup()
  await user.type(screen.getByLabelText('Correo electrónico'), email)
  await user.type(screen.getByLabelText('Contraseña'), password)
  await user.click(screen.getByRole('button', { name: 'Crear cuenta' }))
}

describe('SignUpRoute', () => {
  beforeEach(() => {
    signUp.mockReset()
  })

  it('renders in Spanish by default', async () => {
    await renderSignUp()

    expect(screen.getByRole('heading', { name: 'Crear cuenta' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Crear cuenta' })).toBeInTheDocument()
  })

  it('labels every input', async () => {
    await renderSignUp()

    expect(screen.getByLabelText('Correo electrónico')).toBeInTheDocument()
    expect(screen.getByLabelText('Contraseña')).toBeInTheDocument()
  })

  it('rejects a short password without calling the server', async () => {
    // Supabase's own minimum is 6, so a 7-character password would be accepted
    // server-side while error.weakPassword promises 8. Checking locally is what
    // keeps the promise true.
    await renderSignUp()
    await fillAndSubmit('club@example.es', 'siete77')

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'La contraseña debe tener al menos 8 caracteres.',
    )
    expect(signUp).not.toHaveBeenCalled()
  })

  it('confirms by email when the project requires confirmation', async () => {
    signUp.mockResolvedValue({ data: { session: null, user: { id: 'u1' } }, error: null })

    await renderSignUp()
    await fillAndSubmit('club@example.es', 'contrasena-larga')

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Te hemos enviado un correo a club@example.es. Ábrelo para confirmar tu cuenta.',
    )
  })

  it('does not reveal that an address is already registered', async () => {
    // With confirmations on, Supabase returns a success shaped like a new signup
    // for an existing address; an empty `identities` array is the only tell.
    // Surfacing that would turn this form into an account-existence oracle.
    signUp.mockResolvedValue({
      data: { session: null, user: { id: 'u1', identities: [] } },
      error: null,
    })

    await renderSignUp()
    await fillAndSubmit('yaexiste@example.es', 'contrasena-larga')

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Te hemos enviado un correo a yaexiste@example.es.',
    )
    // Nothing anywhere should say the account already exists.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByText(/Ya existe una cuenta/)).not.toBeInTheDocument()
  })

  it('goes straight to the dashboard when confirmation is disabled', async () => {
    signUp.mockResolvedValue({
      data: { session: { access_token: 'tok' }, user: { id: 'u1' } },
      error: null,
    })

    await renderSignUp()
    await fillAndSubmit('club@example.es', 'contrasena-larga')

    expect(await screen.findByRole('heading', { name: 'Panel' })).toBeInTheDocument()
  })

  it('translates a server-side failure', async () => {
    signUp.mockResolvedValue({
      data: { session: null, user: null },
      error: { message: 'User already registered', code: 'user_already_exists', status: 400 },
    })

    await renderSignUp()
    await fillAndSubmit('club@example.es', 'contrasena-larga')

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Ya existe una cuenta con este correo. Entra en su lugar.',
    )
  })

  it('renders in English when that language is active', async () => {
    await renderSignUp('en')

    expect(screen.getByRole('heading', { name: 'Create account' })).toBeInTheDocument()
  })
})
