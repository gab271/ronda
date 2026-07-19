import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { supabase } from '~/data/supabase/client'
import { useAuth } from '~/features/auth/useAuth'
import { StatusMessage } from '~/ui/StatusMessage/StatusMessage'
import { LanguageToggle } from '~/features/i18n/LanguageToggle'
import styles from './DashboardRoute.module.css'

/**
 * Organiser shell. Milestone 1 ships the chrome and an empty state; tournament
 * listing and creation arrive in milestone 3.
 *
 * data-theme="auto" opts this surface into following the OS colour scheme. The
 * public tournament page deliberately does not — see theme-dark.css.
 */
export default function DashboardRoute() {
  const { t } = useTranslation('organiser')
  // The action vocabulary ("Salir") lives in common so the same word is used
  // everywhere the action appears.
  const { t: tCommon } = useTranslation('common')
  const navigate = useNavigate()
  const auth = useAuth()

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
        <h1 className={styles.title}>{t('dashboard.title')}</h1>

        {/* The loader guard already guarantees a session, so `loading` here is
            only the brief window before the provider resolves it. Showing a
            loading state rather than the empty state avoids telling an organiser
            they have no tournaments before we actually know. */}
        {auth.status === 'loading' ? (
          <StatusMessage tone="loading" title={tCommon('state.loading')} />
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
