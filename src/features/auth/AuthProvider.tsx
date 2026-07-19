import { createContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { supabase } from '~/data/supabase/client'

/**
 * Three states, not a nullable session.
 *
 * `loading` and `anonymous` are genuinely different things, and collapsing them
 * into `session === null` produces the bug where a signed-in organiser sees the
 * login screen flash on every page load while the session is read from storage.
 * Making the distinction unrepresentable-if-ignored is why this is a union.
 */
export type AuthState =
  | { readonly status: 'loading'; readonly session: null; readonly user: null }
  | { readonly status: 'anonymous'; readonly session: null; readonly user: null }
  | { readonly status: 'authenticated'; readonly session: Session; readonly user: User }

const LOADING: AuthState = { status: 'loading', session: null, user: null }
const ANONYMOUS: AuthState = { status: 'anonymous', session: null, user: null }

function toState(session: Session | null): AuthState {
  return session ? { status: 'authenticated', session, user: session.user } : ANONYMOUS
}

export const AuthContext = createContext<AuthState>(LOADING)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>(LOADING)

  useEffect(() => {
    let active = true

    // getSession() reads from local storage and only hits the network if the
    // stored token has expired, so this is fast in the common case.
    void supabase.auth
      .getSession()
      .then(({ data }) => {
        if (active) setState(toState(data.session))
      })
      .catch(() => {
        // A failure here means we cannot establish a session, which is
        // functionally anonymous. The sign-in form will surface the real error.
        if (active) setState(ANONYMOUS)
      })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      // CRITICAL: never await a Supabase call inside this callback. It runs
      // while GoTrue holds its navigator lock, and calling back into the client
      // here deadlocks — the app hangs with no error. Set state and react to it
      // in a separate effect if follow-up work is needed.
      if (active) setState(toState(session))
    })

    return () => {
      active = false
      // Required, not optional: React 19 StrictMode double-invokes effects in
      // development, so without this you get two live subscriptions and doubled
      // state transitions.
      subscription.unsubscribe()
    }
  }, [])

  // The context value is an object; memoising keeps consumers from re-rendering
  // on every parent render.
  const value = useMemo(() => state, [state])

  return <AuthContext value={value}>{children}</AuthContext>
}
