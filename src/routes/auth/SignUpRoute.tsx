import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { supabase } from '~/data/supabase/client'
import { toAuthErrorKey, type AuthErrorKey } from '~/features/auth/authErrors'
import { Button } from '~/ui/Button/Button'
import { Field } from '~/ui/Field/Field'
import styles from './AuthCard.module.css'

/**
 * Account creation — the landing page's primary CTA.
 *
 * Nothing here collects a club name. `handle_new_user()` provisions a profile,
 * a personal club and an owner membership from the auth row alone, defaulting
 * the club to "Mi club", so `tournaments.club_id` is never null and an organiser
 * can reach their first tournament without an onboarding form in the way.
 * Renaming the club belongs with the rest of club settings, not here.
 */

/**
 * Enforced client-side because Supabase's own default minimum is 6, while
 * `error.weakPassword` promises 8. Without this check a 7-character password is
 * accepted by the server and the user is never shown the rule they just met —
 * or worse, is shown a rule that did not apply.
 */
export const PASSWORD_MIN_LENGTH = 8

export default function SignUpRoute() {
  const { t } = useTranslation('auth')
  const navigate = useNavigate()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [errorKey, setErrorKey] = useState<AuthErrorKey | null>(null)
  // Set when the account exists but the session does not yet — see below.
  const [pendingEmail, setPendingEmail] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setErrorKey(null)

    if (password.length < PASSWORD_MIN_LENGTH) {
      setErrorKey('error.weakPassword')
      return
    }

    setSubmitting(true)
    try {
      const { data, error } = await supabase.auth.signUp({ email, password })
      if (error) {
        setErrorKey(toAuthErrorKey(error))
        return
      }

      // Two legitimate outcomes, decided by the project's email-confirmation
      // setting rather than by anything the client controls:
      //
      //   * session present  — confirmations are off, the user is already signed
      //                        in, go straight to the dashboard.
      //   * session absent   — a confirmation mail is on its way.
      //
      // The absent-session branch ALSO covers an address that is already
      // registered: with confirmations on, Supabase deliberately returns a
      // success shaped exactly like a new signup (an empty `identities` array is
      // the only tell) so that this form cannot be used to discover who has an
      // account. Reporting "email taken" here would hand that back. The user who
      // genuinely owns the address gets a mail either way; anyone probing learns
      // nothing.
      if (data.session) {
        await navigate('/panel', { replace: true })
        return
      }
      setPendingEmail(email)
    } catch (cause) {
      setErrorKey(toAuthErrorKey(cause))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className={styles.page}>
      <div className={styles.card}>
        <div className={styles.mark} aria-hidden="true" />
        <h1 className={styles.title}>{t('signUp.title')}</h1>
        <p className={styles.subtitle}>{t('signUp.subtitle')}</p>

        {pendingEmail ? (
          <p className={styles.formNotice} role="status">
            {t('signUp.checkEmail', { email: pendingEmail })}
          </p>
        ) : (
          <form className={styles.form} onSubmit={(e) => void handleSubmit(e)} noValidate>
            {errorKey ? (
              <p className={styles.formError} role="alert">
                {t(errorKey)}
              </p>
            ) : null}

            <Field
              label={t('signIn.email')}
              type="email"
              name="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value)
              }}
              autoComplete="email"
              inputMode="email"
              required
            />

            <Field
              label={t('signIn.password')}
              type="password"
              name="password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value)
              }}
              autoComplete="new-password"
              minLength={PASSWORD_MIN_LENGTH}
              required
            />

            <Button type="submit" fullWidth disabled={submitting}>
              {submitting ? t('signUp.submitting') : t('signUp.submit')}
            </Button>
          </form>
        )}

        <p className={styles.footer}>
          {t('signUp.hasAccount')}{' '}
          <a className={styles.link} href="/entrar">
            {t('signUp.goToSignIn')}
          </a>
        </p>
      </div>
    </main>
  )
}
