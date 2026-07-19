import { i18next } from './index'

/**
 * Preloads a translation namespace before a route renders.
 *
 * Namespaces other than `common` and `public` are fetched on demand, which keeps
 * them off the public tournament page's critical path. The cost is that a route
 * using a lazy namespace would otherwise paint through Suspense with no copy.
 *
 * Awaiting the namespace in the route's loader moves that wait to before the
 * navigation commits, so the page arrives complete. Worth it on the landing
 * page in particular: a marketing page that flashes empty strings reads as
 * broken to someone deciding whether to trust the product.
 */
export async function loadNamespace(namespace: string): Promise<null> {
  await i18next.loadNamespaces(namespace)
  return null
}
