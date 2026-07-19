import type { AuthError } from '@supabase/supabase-js'

/**
 * Maps Supabase auth failures to translation keys.
 *
 * Supabase returns messages in English, written for developers ("Invalid login
 * credentials"). Showing those to a padel club organiser in Spain fails on two
 * counts: wrong language, and no indication of what to do next. This translates
 * them into the auth namespace, where every message says what happened AND how
 * to fix it.
 *
 * Matching is on `code` where Supabase provides one, falling back to message
 * inspection for the older errors that don't carry a code yet.
 */
export type AuthErrorKey =
  | 'error.invalidCredentials'
  | 'error.emailNotConfirmed'
  | 'error.weakPassword'
  | 'error.emailTaken'
  | 'error.rateLimited'
  | 'error.network'
  | 'error.unknown'

export function toAuthErrorKey(error: unknown): AuthErrorKey {
  if (!isAuthError(error)) {
    // A thrown non-AuthError on this path is almost always a transport failure —
    // the club's wifi, or a paused Supabase project.
    return 'error.network'
  }

  switch (error.code) {
    case 'invalid_credentials':
      return 'error.invalidCredentials'
    case 'email_not_confirmed':
      return 'error.emailNotConfirmed'
    case 'weak_password':
      return 'error.weakPassword'
    case 'user_already_exists':
    case 'email_exists':
      return 'error.emailTaken'
    case 'over_request_rate_limit':
    case 'over_email_send_rate_limit':
      return 'error.rateLimited'
    default:
      break
  }

  const message = error.message.toLowerCase()
  if (message.includes('invalid login credentials')) return 'error.invalidCredentials'
  if (message.includes('email not confirmed')) return 'error.emailNotConfirmed'
  if (message.includes('already registered')) return 'error.emailTaken'
  if (message.includes('rate limit')) return 'error.rateLimited'
  if (message.includes('password')) return 'error.weakPassword'
  if (error.status === 0 || message.includes('fetch')) return 'error.network'

  return 'error.unknown'
}

function isAuthError(error: unknown): error is AuthError {
  return (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof error.message === 'string'
  )
}
