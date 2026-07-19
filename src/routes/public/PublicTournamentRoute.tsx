import { useLoaderData, useRevalidator } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import type { PublicLoaderData } from './publicLoader'
import { Button } from '~/ui/Button/Button'
import { StatusMessage } from '~/ui/StatusMessage/StatusMessage'
import styles from './PublicTournamentRoute.module.css'

/**
 * PLACEHOLDER — the real draw sheet, bracket and standings are milestone 4.
 *
 * What is real here and must stay real: this component imports no auth code and
 * no supabase-js (enforced by eslint.config.js), and it touches no browser API
 * during render, so it can be server-rendered at the edge. The .ssr.test.tsx
 * beside this file checks that on every run.
 */
export default function PublicTournamentRoute() {
  const data = useLoaderData<PublicLoaderData>()
  const revalidator = useRevalidator()
  const { t } = useTranslation('public')
  const { t: tCommon } = useTranslation('common')

  if (data.errorKind !== null) {
    const tone = 'error' as const
    const retry = (
      <Button
        variant="secondary"
        onClick={() => {
          void revalidator.revalidate()
        }}
      >
        {t('offline.action')}
      </Button>
    )

    // Each failure gets its own message because the recovery differs: a wrong
    // link cannot be retried, a dropped connection can, and a 500 is not the
    // player's fault and should say so.
    if (data.errorKind === 'not-found') {
      return (
        <main className={styles.main}>
          <StatusMessage tone={tone} title={t('notFound.title')} body={t('notFound.body')} />
        </main>
      )
    }

    if (data.errorKind === 'server') {
      return (
        <main className={styles.main}>
          <StatusMessage
            tone={tone}
            title={t('serverError.title')}
            body={t('serverError.body')}
            action={retry}
          />
        </main>
      )
    }

    return (
      <main className={styles.main}>
        <StatusMessage
          tone={tone}
          title={t('offline.title')}
          body={t('offline.body')}
          action={retry}
        />
      </main>
    )
  }

  const tournament = data.tournament

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <span className={styles.wordmark}>{tCommon('appName')}</span>
        </div>
      </header>

      <main className={styles.main}>
        <h1 className={styles.tournamentName}>{tournament?.name ?? t('placeholder.title')}</h1>
        <p className="muted">{t('placeholder.body')}</p>
      </main>
    </div>
  )
}
