import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { I18nextProvider, initReactI18next } from 'react-i18next'
import { createInstance } from 'i18next'

import esOrganiser from '~/i18n/locales/es/organiser.json'
import enOrganiser from '~/i18n/locales/en/organiser.json'

const createTournament = vi.fn<(input: unknown) => Promise<{ id: string }>>()

class FakeRepoError extends Error {
  readonly code: string
  constructor(code: string) {
    super(code)
    this.name = 'RepoError'
    this.code = code
  }
}

vi.mock('~/data/tournaments/tournamentsRepo', () => ({
  createTournament: (input: unknown) => createTournament(input),
  RepoError: FakeRepoError,
}))

async function makeI18n(lng: 'es' | 'en' = 'es') {
  const instance = createInstance()
  await instance.use(initReactI18next).init({
    lng,
    fallbackLng: 'es',
    defaultNS: 'organiser',
    ns: ['organiser'],
    resources: { es: { organiser: esOrganiser }, en: { organiser: enOrganiser } },
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
  })
  return instance
}

async function renderRoute(lng: 'es' | 'en' = 'es') {
  const { default: NewTournamentRoute } = await import('./NewTournamentRoute')
  const i18n = await makeI18n(lng)
  const router = createMemoryRouter(
    [
      { path: '/panel/torneos/nuevo', Component: NewTournamentRoute },
      { path: '/panel/torneos/:id', Component: () => <h1>Detalle</h1> },
    ],
    { initialEntries: ['/panel/torneos/nuevo'] },
  )

  render(
    <I18nextProvider i18n={i18n}>
      <RouterProvider router={router} />
    </I18nextProvider>,
  )
}

describe('NewTournamentRoute', () => {
  beforeEach(() => {
    createTournament.mockReset()
  })

  it('renders in Spanish by default', async () => {
    await renderRoute()
    expect(screen.getByRole('heading', { name: 'Nuevo torneo' })).toBeInTheDocument()
  })

  it('offers both Spanish time zones', async () => {
    // The roadmap calls this out specifically: a club in Las Palmas running on
    // Europe/Madrid shows every player a time an hour off, and nothing in the
    // product looks wrong — the schedule is internally consistent, just wrong
    // for everyone reading it.
    await renderRoute()

    expect(screen.getByRole('radio', { name: /Península y Baleares/ })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /Canarias/ })).toBeInTheDocument()
    expect(screen.getByText('Atlantic/Canary')).toBeInTheDocument()
  })

  it('gives every format an accessible radio, not a hidden select', async () => {
    await renderRoute()

    // Five formats, each nameable — the linter can only verify the association,
    // so this checks the accessible name actually resolves.
    for (const name of [
      /Liguilla/,
      /Eliminatoria/,
      /Doble eliminación/,
      /Grupos y eliminatoria/,
      /Suizo/,
    ]) {
      expect(screen.getByRole('radio', { name })).toBeInTheDocument()
    }
  })

  it('refuses an empty name without calling the server', async () => {
    await renderRoute()
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'Crear torneo' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Ponle un nombre al torneo.')
    expect(createTournament).not.toHaveBeenCalled()
  })

  it('sends the chosen options and navigates to the new tournament', async () => {
    createTournament.mockResolvedValue({ id: 'new-id' })

    await renderRoute()
    const user = userEvent.setup()

    await user.type(screen.getByLabelText('Nombre del torneo'), 'Torneo de primavera')
    await user.click(screen.getByRole('radio', { name: /Canarias/ }))
    await user.click(screen.getByRole('radio', { name: /Liguilla/ }))
    await user.click(screen.getByRole('button', { name: 'Crear torneo' }))

    expect(await screen.findByRole('heading', { name: 'Detalle' })).toBeInTheDocument()
    expect(createTournament).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Torneo de primavera',
        timezone: 'Atlantic/Canary',
        format: 'round_robin',
        sport: 'padel',
      }),
    )
  })

  it('sends null rather than an empty string for omitted dates', async () => {
    // starts_on is a date column; "" is not a date and Postgres would reject it.
    createTournament.mockResolvedValue({ id: 'new-id' })

    await renderRoute()
    const user = userEvent.setup()

    await user.type(screen.getByLabelText('Nombre del torneo'), 'Sin fechas')
    await user.click(screen.getByRole('button', { name: 'Crear torneo' }))

    expect(createTournament).toHaveBeenCalledWith(
      expect.objectContaining({ startsOn: null, endsOn: null }),
    )
  })

  it('distinguishes a missing club from a transient failure', async () => {
    // no_club means handle_new_user() did not run for this account. Telling the
    // organiser to "try again" would send them round a loop that cannot succeed.
    createTournament.mockRejectedValue(new FakeRepoError('no_club'))

    await renderRoute()
    const user = userEvent.setup()

    await user.type(screen.getByLabelText('Nombre del torneo'), 'Torneo')
    await user.click(screen.getByRole('button', { name: 'Crear torneo' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Tu cuenta no tiene ningún club asociado.',
    )
  })

  it('asks the organiser to retry a transient failure', async () => {
    createTournament.mockRejectedValue(new Error('network went away'))

    await renderRoute()
    const user = userEvent.setup()

    await user.type(screen.getByLabelText('Nombre del torneo'), 'Torneo')
    await user.click(screen.getByRole('button', { name: 'Crear torneo' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'No hemos podido crear el torneo.',
    )
  })

  it('renders in English when that language is active', async () => {
    await renderRoute('en')
    expect(screen.getByRole('heading', { name: 'New tournament' })).toBeInTheDocument()
  })
})
