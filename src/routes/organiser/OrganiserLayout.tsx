import { Outlet } from 'react-router-dom'
import { AuthProvider } from '~/features/auth/AuthProvider'

/**
 * Wraps the organiser area in auth context.
 *
 * AuthProvider is mounted HERE rather than at the app root on purpose. It
 * imports supabase-js (~51 kB gzip), and mounting it above the router would pull
 * that into the public tournament page's critical path — the exact cost the
 * public data layer exists to avoid. Scoping it to this layout means a player
 * opening a shared link never downloads auth code at all.
 *
 * The route-level guard (requireSession) is separate and runs in the loader,
 * before this renders. This provider supplies the session to components that
 * need to display it; it is not the access control.
 */
export default function OrganiserLayout() {
  return (
    <AuthProvider>
      <Outlet />
    </AuthProvider>
  )
}
