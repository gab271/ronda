import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { createTournament, RepoError } from '~/data/tournaments/tournamentsRepo'
import type { Sport, TournamentFormat } from '~/data/supabase/database.types'
import { Button } from '~/ui/Button/Button'
import { Field } from '~/ui/Field/Field'
import styles from './NewTournamentRoute.module.css'

/**
 * Creating a tournament.
 *
 * ── Time zone is a required choice, not a default ────────────────────────────
 * Spain spans two zones. A club in Las Palmas running on Europe/Madrid shows
 * every player a time an hour off, and nothing in the product would look wrong
 * — the schedule is internally consistent, just wrong for everyone reading it.
 * Both options are presented rather than silently defaulting to the mainland,
 * because the mistake is invisible until people miss matches.
 *
 * ── Format is radio cards, not a select ─────────────────────────────────────
 * It is the decision an organiser is least sure about, and the one that shapes
 * the whole tournament. A native select hides the explanations behind a tap.
 */

const SPORTS: readonly Sport[] = ['padel', 'futbol7', 'baloncesto', 'ajedrez']

const FORMATS: readonly TournamentFormat[] = [
  'groups_knockout',
  'single_elim',
  'round_robin',
  'double_elim',
  'swiss',
]

/** Both Spanish zones. Deliberately not a full IANA list — see above. */
const TIMEZONES = [
  { value: 'Europe/Madrid', labelKey: 'timezone.madrid' },
  { value: 'Atlantic/Canary', labelKey: 'timezone.canary' },
] as const

export default function NewTournamentRoute() {
  const { t } = useTranslation('organiser')
  const navigate = useNavigate()

  const [name, setName] = useState('')
  const [sport, setSport] = useState<Sport>('padel')
  const [format, setFormat] = useState<TournamentFormat>('groups_knockout')
  const [timezone, setTimezone] = useState<string>('Europe/Madrid')
  const [startsOn, setStartsOn] = useState('')
  const [endsOn, setEndsOn] = useState('')

  const [errorKey, setErrorKey] = useState<
    'error.nameRequired' | 'error.createFailed' | 'error.noClub' | null
  >(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setErrorKey(null)

    if (name.trim() === '') {
      setErrorKey('error.nameRequired')
      return
    }

    setSubmitting(true)
    try {
      const tournament = await createTournament({
        name,
        sport,
        format,
        timezone,
        startsOn: startsOn === '' ? null : startsOn,
        endsOn: endsOn === '' ? null : endsOn,
      })
      await navigate(`/panel/torneos/${tournament.id}`, { replace: true })
    } catch (cause) {
      // no_club means handle_new_user() did not run for this account, which the
      // organiser can do nothing about — it needs saying differently from a
      // transient failure they should retry.
      setErrorKey(
        cause instanceof RepoError && cause.code === 'no_club'
          ? 'error.noClub'
          : 'error.createFailed',
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className={styles.page}>
      <div className={styles.mark} aria-hidden="true" />
      <h1 className={styles.title}>{t('new.title')}</h1>
      <p className={styles.subtitle}>{t('new.subtitle')}</p>

      <form className={styles.form} onSubmit={(e) => void handleSubmit(e)} noValidate>
        {errorKey ? (
          <p className={styles.formError} role="alert">
            {t(errorKey)}
          </p>
        ) : null}

        <Field
          label={t('new.name')}
          name="name"
          value={name}
          onChange={(e) => {
            setName(e.target.value)
          }}
          placeholder={t('new.namePlaceholder')}
          autoComplete="off"
          required
        />

        <fieldset className={styles.group}>
          <legend className={styles.legend}>{t('new.sport')}</legend>
          <div className={styles.options}>
            {SPORTS.map((value) => (
              <label
                key={value}
                className={`${styles.option} ${sport === value ? styles.optionSelected : ''}`}
              >
                <input
                  className={styles.optionInput}
                  type="radio"
                  name="sport"
                  value={value}
                  checked={sport === value}
                  onChange={() => {
                    setSport(value)
                  }}
                />
                <span className={styles.optionLabel}>{t(`sport.${value}`)}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className={styles.group}>
          <legend className={styles.legend}>{t('new.format')}</legend>
          <div className={styles.options}>
            {FORMATS.map((value) => (
              <label
                key={value}
                className={`${styles.option} ${format === value ? styles.optionSelected : ''}`}
              >
                <input
                  className={styles.optionInput}
                  type="radio"
                  name="format"
                  value={value}
                  checked={format === value}
                  onChange={() => {
                    setFormat(value)
                  }}
                />
                <span className={styles.optionLabel}>{t(`format.${value}`)}</span>
                <span className={styles.optionHint}>{t(`format.${value}Hint`)}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className={styles.group}>
          <legend className={styles.legend}>{t('new.timezone')}</legend>
          <p className={styles.hint}>{t('new.timezoneHint')}</p>
          <div className={styles.options}>
            {TIMEZONES.map(({ value, labelKey }) => (
              <label
                key={value}
                className={`${styles.option} ${timezone === value ? styles.optionSelected : ''}`}
              >
                <input
                  className={styles.optionInput}
                  type="radio"
                  name="timezone"
                  value={value}
                  checked={timezone === value}
                  onChange={() => {
                    setTimezone(value)
                  }}
                />
                <span className={styles.optionLabel}>{t(labelKey)}</span>
                <span className={styles.optionHint}>{value}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className={styles.group}>
          <div className={styles.row}>
            <Field
              label={t('new.startsOn')}
              type="date"
              name="startsOn"
              value={startsOn}
              onChange={(e) => {
                setStartsOn(e.target.value)
              }}
            />
            <Field
              label={t('new.endsOn')}
              type="date"
              name="endsOn"
              value={endsOn}
              onChange={(e) => {
                setEndsOn(e.target.value)
              }}
            />
          </div>
          <p className={styles.hint}>{t('new.datesHint')}</p>
        </div>

        <div className={styles.actions}>
          <Button type="submit" disabled={submitting}>
            {submitting ? t('new.submitting') : t('new.submit')}
          </Button>
        </div>
      </form>
    </main>
  )
}
