/**
 * TYPED TRANSLATION KEYS.
 *
 * This is the mechanism that makes "no hardcoded strings" actually hold. Without
 * it, `t('dashbaord.title')` renders the raw key at a real tournament in front of
 * forty people. With it, that typo is a compile error.
 *
 * Keys are derived from the Spanish files because Spanish is the source of
 * truth — English is the translation. A key present in en but missing in es is a
 * mistake, and typing it this way surfaces that immediately.
 */

import type common from './locales/es/common.json'
import type publicNs from './locales/es/public.json'
import type auth from './locales/es/auth.json'
import type organiser from './locales/es/organiser.json'
import type landing from './locales/es/landing.json'

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'common'
    resources: {
      common: typeof common
      public: typeof publicNs
      auth: typeof auth
      organiser: typeof organiser
      landing: typeof landing
    }
    // Our JSON uses nested objects; this is i18next's default but stating it
    // keeps the key type inference stable across upgrades.
    keySeparator: '.'
    nsSeparator: ':'
  }
}
