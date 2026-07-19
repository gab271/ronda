/**
 * i18n setup. Spanish first, English second.
 *
 * ── Bundle strategy ─────────────────────────────────────────────────────────
 * Spanish is roughly 95% of expected traffic, and the public tournament page is
 * the surface that must be fast on bad 4G. So:
 *
 *   - es/common and es/public are STATICALLY imported. They are on the critical
 *     path of the storefront, and a few KB inline beats a second round trip.
 *   - Everything else (all of English, plus the organiser and auth namespaces)
 *     is lazily fetched. English costs an English speaker one small extra
 *     request; the organiser namespaces never load for a player at all.
 *
 * ── Namespaces map to surfaces ──────────────────────────────────────────────
 * common | public | auth | organiser. Because the split follows the routes, lazy
 * loading is automatic: useTranslation('organiser') triggers the fetch, and a
 * visitor who only ever opens a public link never downloads organiser copy.
 *
 * ── Detection ───────────────────────────────────────────────────────────────
 * Querystring → localStorage → browser. Deliberately NOT a path prefix.
 * The product promise is ONE link per tournament; /es/t/abc and /en/t/abc would
 * be two canonical URLs for the same draw, which breaks sharing and makes the
 * link longer to read aloud at a club. ?lang=en is enough of an override.
 */

import i18next from 'i18next'
import { initReactI18next } from 'react-i18next'
import resourcesToBackend from 'i18next-resources-to-backend'

import esCommon from './locales/es/common.json'
import esPublic from './locales/es/public.json'

export const SUPPORTED_LANGUAGES = ['es', 'en'] as const
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number]

export const DEFAULT_LANGUAGE: SupportedLanguage = 'es'
export const DEFAULT_NS = 'common'

const STORAGE_KEY = 'ronda.lang'

function isSupported(value: string | null | undefined): value is SupportedLanguage {
  return (
    typeof value === 'string' && (SUPPORTED_LANGUAGES as readonly string[]).includes(value)
  )
}

/**
 * Resolves the initial language without pulling in i18next-browser-languagedetector.
 * The detector is ~3KB for logic this app can express in ten lines, and it lands
 * on the public page's critical path.
 */
export function detectLanguage(): SupportedLanguage {
  if (typeof window === 'undefined') return DEFAULT_LANGUAGE

  const fromQuery = new URLSearchParams(window.location.search).get('lang')
  if (isSupported(fromQuery)) return fromQuery

  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    if (isSupported(stored)) return stored
  } catch {
    // Safari private mode throws on localStorage access. A language preference
    // is not worth breaking the page over.
  }

  // navigator.language is "es-ES", "en-GB" etc. — match on the primary subtag.
  const fromBrowser = window.navigator.language.split('-')[0]
  if (isSupported(fromBrowser)) return fromBrowser

  return DEFAULT_LANGUAGE
}

export function persistLanguage(language: SupportedLanguage): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, language)
  } catch {
    // See above — non-fatal.
  }
  document.documentElement.lang = language
}

export async function initI18n(): Promise<typeof i18next> {
  await i18next
    .use(
      // Everything not statically bundled above is fetched on demand. The
      // template literal keeps the dynamic import analysable so Rolldown emits
      // one chunk per locale file rather than bundling them all together.
      resourcesToBackend(
        (language: string, namespace: string) =>
          import(`./locales/${language}/${namespace}.json`),
      ),
    )
    .use(initReactI18next)
    .init({
      lng: detectLanguage(),
      fallbackLng: DEFAULT_LANGUAGE,
      supportedLngs: SUPPORTED_LANGUAGES,
      defaultNS: DEFAULT_NS,
      ns: [DEFAULT_NS],

      resources: {
        es: { common: esCommon, public: esPublic },
      },
      // Tells i18next the statically bundled namespaces are already present, so
      // it does not fire a redundant request for them on first render.
      partialBundledLanguages: true,

      interpolation: {
        // React escapes for us; double-escaping mangles apostrophes in Spanish
        // copy ("¿Aún no tienes cuenta?" is fine, but "l'equip" would not be).
        escapeValue: false,
      },

      react: {
        useSuspense: true,
      },
    })

  document.documentElement.lang = i18next.language

  return i18next
}

export { i18next }
