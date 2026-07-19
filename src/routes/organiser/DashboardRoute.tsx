import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { supabase } from '~/data/supabase/client'
import { listTournaments } from '~/data/tournaments/tournamentsRepo'
import type { Database } from '~/data/supabase/database.types'
import { useAuth } from '~/features/auth/useAuth'
import { StatusMessage } from '~/ui/StatusMessage/StatusMessage'
import { Button } from '~/ui/Button/Button'
import { LanguageToggle } from '~/features/i18n/LanguageToggle'
import styles from './DashboardRoute.module.css'

type TournamentRow = Database['public']['Tables']['tournaments']['Row']

/**
 * Organiser shell and tournament list.
 *
 * data-theme="auto" opts this surface into following the OS colour scheme. The
 * public tournament page deliberately does not — see theme-dark.css.
 */

/** Status → translation key. Every status is named in words, never colour alone. */
const STATUS_KEY = {
  draft: 'dashboard.draft',
  published: 'dashboard.published',
  in_progress: 'dashboard.inProgress',
  finished: 'dashboard.finished',
  archived: 'dashboard.archived',
} as const

export default function DashboardRoute() {
  const { t } = useTranslation('organiser')
  // The action vocabulary ("Salir") lives in common so the same word is used
  // everywhere the action appears.
  const { t: tCommon } = useTranslation('common')
  const navigate = useNavigate()
  const auth = useAuth()

  const [tournaments, setTournaments] = useState<TournamentRow[] | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const rows = await listTournaments()
        if (!cancelled) setTournaments(rows)
      } catch {
        if (!cancelled) setFailed(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  async function handleSignOut() {
    await supabase.auth.signOut()
    await navigate('/entrar', { replace: true })
  }

  return (
    <div className={styles.page} data-theme="auto">
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <span className={styles.wordmark}>{tCommon('appName')}</span>
          <div className={styles.headerActions}>
            <LanguageToggle onBrand />
            <button
              className={styles.signOut}
              type="button"
              onClick={() => void handleSignOut()}
            >
              {tCommon('action.signOut')}
            </button>
          </div>
        </div>
      </header>

      <main className={styles.main}>
        <div className={styles.titleRow}>
          <h1 className={styles.title}>{t('dashboard.title')}</h1>
          <a className={styles.createLink} href="/panel/torneos/nuevo">
            <Button type="button">{t('dashboard.create')}</Button>
          </a>
        </div>

        {/* The loader guard already guarantees a session, so `loading` here is
            only the brief window before the provider resolves it. Showing a
            loading state rather than the empty state avoids telling an organiser
            they have no tournaments before we actually know — and the same
            applies to the list itself, which is null until it has loaded. */}
        {auth.status === 'loading' || (tournaments === null && !failed) ? (
          <StatusMessage tone="loading" title={tCommon('state.loading')} />
        ) : failed ? (
          <StatusMessage
            tone="error"
            title={t('error.loadFailed.title')}
            body={t('error.loadFailed.body')}
          />
        ) : tournaments && tournaments.length > 0 ? (
          <ul className={styles.list}>
            {tournaments.map((tournament) => (
              <li key={tournament.id}>
                <a className={styles.card} href={`/panel/torneos/${tournament.id}`}>
                  <span className={styles.cardName}>{tournament.name}</span>
                  <span className={styles.cardMeta}>
                    {t(`sport.${tournament.sport}`)} · {t(`format.${tournament.format}`)}
                  </span>
                  <span
                    className={styles.cardStatus}
                    data-status={tournament.status === 'draft' ? 'draft' : 'live'}
                  >
                    {t(STATUS_KEY[tournament.status])}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        ) : (
          <StatusMessage
            tone="empty"
            title={t('dashboard.empty.title')}
            body={t('dashboard.empty.body')}
          />
        )}
      </main>
    </div>
  )
}
