import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import {
  countEnteredResults,
  generateAndPersistFixtures,
  getTournament,
  listParticipants,
  publishTournament,
  replaceParticipants,
  RepoError,
} from '~/data/tournaments/tournamentsRepo'
import { parseParticipantList } from '~/data/tournaments/parseParticipants'
import type { Database } from '~/data/supabase/database.types'
import { Button } from '~/ui/Button/Button'
import { StatusMessage } from '~/ui/StatusMessage/StatusMessage'
import styles from './TournamentDetailRoute.module.css'

type TournamentRow = Database['public']['Tables']['tournaments']['Row']

/**
 * One tournament: entry list, fixture generation, publish.
 *
 * ── Regenerating is a confirmation, not a warning ────────────────────────────
 * The repository refuses to overwrite entered results unless forced. This screen
 * surfaces that refusal as a second, explicit button rather than a dialog with a
 * default — scores are entered courtside on a phone, cannot be reconstructed
 * from anything, and a mis-tap that discards them is not recoverable.
 *
 * ── The public link exists before publishing ─────────────────────────────────
 * public_slug is minted at creation, so the link shown here does not change when
 * the tournament is published. An organiser can share it in advance and it will
 * start working rather than breaking.
 */
export default function TournamentDetailRoute() {
  const { id = '' } = useParams()
  const { t } = useTranslation('organiser')
  const { t: tCommon } = useTranslation('common')

  const [tournament, setTournament] = useState<TournamentRow | null>(null)
  const [participantCount, setParticipantCount] = useState(0)
  const [matchCount, setMatchCount] = useState(0)
  const [resultCount, setResultCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)

  const [pasted, setPasted] = useState('')
  const [busy, setBusy] = useState<'participants' | 'fixtures' | 'publish' | null>(null)
  const [errorText, setErrorText] = useState<string | null>(null)
  const [confirmingRegenerate, setConfirmingRegenerate] = useState(false)
  const [copied, setCopied] = useState(false)

  const refresh = useCallback(async () => {
    const [loaded, participants, results] = await Promise.all([
      getTournament(id),
      listParticipants(id),
      countEnteredResults(id),
    ])
    setTournament(loaded)
    setParticipantCount(participants.length)
    setResultCount(results)
  }, [id])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        await refresh()
      } catch {
        if (!cancelled) setLoadFailed(true)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [refresh])

  // Parsed live, so the organiser sees duplicates and repeated seeds before
  // saving rather than after the list has already replaced the old one.
  const parsed = useMemo(() => parseParticipantList(pasted), [pasted])

  async function handleSaveParticipants() {
    setBusy('participants')
    setErrorText(null)
    try {
      await replaceParticipants(id, parsed.participants)
      await refresh()
      setPasted('')
    } catch (cause) {
      setErrorText(cause instanceof RepoError ? cause.message : t('error.actionFailed'))
    } finally {
      setBusy(null)
    }
  }

  async function handleGenerate(force: boolean) {
    setBusy('fixtures')
    setErrorText(null)
    try {
      const { matchCount: generated } = await generateAndPersistFixtures(id, { force })
      setMatchCount(generated)
      setConfirmingRegenerate(false)
      await refresh()
    } catch (cause) {
      if (cause instanceof RepoError && cause.code === 'results_exist') {
        setConfirmingRegenerate(true)
      } else {
        setErrorText(cause instanceof RepoError ? cause.message : t('error.actionFailed'))
      }
    } finally {
      setBusy(null)
    }
  }

  async function handlePublish() {
    setBusy('publish')
    setErrorText(null)
    try {
      await publishTournament(id)
      await refresh()
    } catch (cause) {
      setErrorText(
        cause instanceof RepoError && cause.code === 'no_fixtures'
          ? t('detail.publish.needFixtures')
          : t('error.actionFailed'),
      )
    } finally {
      setBusy(null)
    }
  }

  if (loading) {
    return (
      <main className={styles.page}>
        <StatusMessage tone="loading" title={tCommon('state.loading')} />
      </main>
    )
  }

  if (loadFailed || !tournament) {
    return (
      <main className={styles.page}>
        <StatusMessage
          tone="error"
          title={t('error.loadFailed.title')}
          body={t('error.loadFailed.body')}
        />
      </main>
    )
  }

  const publicUrl = `${globalThis.location.origin}/t/${tournament.public_slug}`
  const isPublished = tournament.status !== 'draft'
  const hasFixtures = matchCount > 0 || resultCount > 0 || isPublished

  return (
    <main className={styles.page}>
      <a className={styles.back} href="/panel">
        {t('detail.back')}
      </a>

      <header className={styles.header}>
        <h1 className={styles.title}>{tournament.name}</h1>
        <span
          className={`${styles.status} ${isPublished ? styles.statusPublished : ''}`}
        >
          {isPublished ? t('dashboard.published') : t('dashboard.draft')}
        </span>
      </header>

      {errorText ? (
        <p className={styles.noticeError} role="alert">
          {errorText}
        </p>
      ) : null}

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>{t('detail.participants.title')}</h2>
        <p className={styles.hint}>{t('detail.participants.hint')}</p>

        <label className={styles.hint} htmlFor="participants">
          {t('detail.participants.label')}
        </label>
        <textarea
          className={styles.textarea}
          id="participants"
          value={pasted}
          onChange={(e) => {
            setPasted(e.target.value)
          }}
          placeholder={t('detail.participants.placeholder')}
          disabled={hasFixtures}
          spellCheck={false}
        />

        {hasFixtures ? (
          <p className={styles.notice}>{t('detail.participants.locked')}</p>
        ) : null}

        {parsed.participants.length > 0 ? (
          <p className={styles.notice}>
            <span className={styles.count}>
              {t('detail.participants.count', { count: parsed.participants.length })}
            </span>
          </p>
        ) : null}

        {parsed.duplicates.length > 0 ? (
          <p className={styles.notice} role="status">
            {t('detail.participants.duplicates', {
              count: parsed.duplicates.length,
              names: parsed.duplicates.map((d) => d.displayName).join(', '),
            })}
          </p>
        ) : null}

        {parsed.repeatedSeeds.length > 0 ? (
          <p className={`${styles.notice} ${styles.noticeWarning}`} role="status">
            {t('detail.participants.repeatedSeeds', {
              seeds: parsed.repeatedSeeds.join(', '),
            })}
          </p>
        ) : null}

        <div className={styles.actions}>
          <Button
            type="button"
            onClick={() => void handleSaveParticipants()}
            disabled={busy !== null || parsed.participants.length === 0 || hasFixtures}
          >
            {busy === 'participants'
              ? t('detail.participants.saving')
              : t('detail.participants.save')}
          </Button>
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>{t('detail.fixtures.title')}</h2>

        {participantCount > 0 ? (
          <p className={styles.hint}>
            {t('detail.participants.count', { count: participantCount })}
          </p>
        ) : (
          <p className={styles.hint}>{t('detail.fixtures.empty')}</p>
        )}

        {matchCount > 0 ? (
          <p className={styles.notice}>
            <span className={styles.count}>
              {t('detail.fixtures.count', { count: matchCount })}
            </span>
          </p>
        ) : null}

        {confirmingRegenerate ? (
          <>
            <p className={`${styles.notice} ${styles.noticeWarning}`} role="alert">
              {t('detail.fixtures.resultsWarning', { count: resultCount })}
            </p>
            <div className={styles.actions}>
              {/* Destructive action is not the default and is labelled with its
                  consequence, not with "OK". */}
              <Button
                type="button"
                variant="danger"
                onClick={() => void handleGenerate(true)}
                disabled={busy !== null}
              >
                {t('detail.fixtures.confirm')}
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setConfirmingRegenerate(false)
                }}
                disabled={busy !== null}
              >
                {t('detail.fixtures.cancel')}
              </Button>
            </div>
          </>
        ) : (
          <div className={styles.actions}>
            <Button
              type="button"
              onClick={() => void handleGenerate(false)}
              disabled={busy !== null || participantCount < 2}
            >
              {busy === 'fixtures'
                ? t('detail.fixtures.generating')
                : hasFixtures
                  ? t('detail.fixtures.regenerate')
                  : t('detail.fixtures.generate')}
            </Button>
          </div>
        )}
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>{t('detail.publish.title')}</h2>
        <p className={styles.hint}>{t('detail.publish.hint')}</p>

        <a className={styles.link} href={publicUrl}>
          {publicUrl}
        </a>

        <div className={styles.actions}>
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              void globalThis.navigator.clipboard.writeText(publicUrl).then(() => {
                setCopied(true)
              })
            }}
          >
            {copied ? t('detail.publish.copied') : t('detail.publish.copy')}
          </Button>

          {!isPublished ? (
            <Button
              type="button"
              onClick={() => void handlePublish()}
              disabled={busy !== null}
            >
              {busy === 'publish' ? t('detail.publish.publishing') : t('detail.publish.action')}
            </Button>
          ) : null}
        </div>
      </section>
    </main>
  )
}
