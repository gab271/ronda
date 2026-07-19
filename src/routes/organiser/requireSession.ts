import { redirect } from 'react-router-dom'
import { supabase } from '~/data/supabase/client'

/**
 * Route guard for the organiser area, implemented as a loader rather than a
 * component.
 *
 * Loaders run before React renders, so a signed-out visitor is redirected
 * without the protected shell ever mounting. The component-level alternative
 * (render, check context, redirect in an effect) flashes the dashboard chrome
 * for a frame and fires whatever data fetches the children start.
 */
export async function requireSession() {
  const { data, error } = await supabase.auth.getSession()

  if (error || !data.session) {
    // Preserve where they were going so sign-in can return them there. This
    // matters for the organiser opening a bookmarked tournament on match day.
    const from = new URL(window.location.href)
    const next = `${from.pathname}${from.search}`
    throw redirect(`/entrar?next=${encodeURIComponent(next)}`)
  }

  return { session: data.session }
}
