import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { supabase } from '~/data/supabase/client'
import { toAuthErrorKey, type AuthErrorKey } from '~/features/auth/authErrors'
import { Button } from '~/ui/Button/Button'
import { Field } from '~/ui/Field/Field'
import styles from './SignInRoute.module.css'

/**
 * Email + password, not magic link.
 *
 * Supabase's built-in email service is rate-limited to roughly 2–4 messages an
 * hour and is explicitly not for production use. A magic-link-only sign-in would
 * therefore break the moment two organisers sign up in the same hour — a failure
 * that appears only under real usage. Password auth needs email solely for
 * resets, which is a far lower volume. See README on configuring real SMTP.
 */
export default function SignInRoute() {
  const { t } = useTranslation('auth')
  const navigate = useNavigate()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  // Typed as AuthErrorKey rather than string so it is accepted by the typed t().
  // That constraint is the point of src/i18n/resources.d.ts: an error message
  // key that does not exist becomes a compile error rather than a raw key
  // rendered on screen.
  const [errorKey, setErrorKey] = useState<AuthErrorKey | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitting(true)
    setErrorKey(null)

    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) {
        setErrorKey(toAuthErrorKey(error))
        return
      }
      await navigate('/panel', { replace: true })
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
        <h1 className={styles.title}>{t('signIn.title')}</h1>
        <p className={styles.subtitle}>{t('signIn.subtitle')}</p>

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
            autoComplete="current-password"
            required
          />

          <Button type="submit" fullWidth disabled={submitting}>
            {submitting ? t('signIn.submitting') : t('signIn.submit')}
          </Button>
        </form>

        <p className={styles.footer}>
          {t('signIn.noAccount')}{' '}
          <a className={styles.link} href="/registro">
            {t('signIn.goToSignUp')}
          </a>
        </p>
      </div>
    </main>
  )
}
