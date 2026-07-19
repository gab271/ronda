import { useTranslation } from 'react-i18next'
import { SUPPORTED_LANGUAGES, persistLanguage, type SupportedLanguage } from '~/i18n'
import styles from './LanguageToggle.module.css'

/**
 * Two-option language switch.
 *
 * Rendered as a pair of toggle buttons rather than a <select> because with
 * exactly two options a select costs an extra tap and hides the current value
 * behind a native picker — worse on a phone, which is where this is used.
 *
 * `onBrand` inverts the colours for placement on the blue header band. Both
 * variants keep their contrast targets; see LanguageToggle.module.css.
 */
export function LanguageToggle({ onBrand = false }: { readonly onBrand?: boolean }) {
  const { t, i18n } = useTranslation('common')

  async function choose(language: SupportedLanguage) {
    await i18n.changeLanguage(language)
    persistLanguage(language)
  }

  return (
    <div
      className={styles.toggle}
      data-on-brand={onBrand ? 'true' : undefined}
      role="group"
      aria-label={t('language.label')}
    >
      {SUPPORTED_LANGUAGES.map((language) => (
        <button
          key={language}
          className={styles.option}
          type="button"
          // aria-pressed rather than a radio group: these are toggle buttons,
          // and the pressed state is what a screen reader should announce.
          aria-pressed={i18n.resolvedLanguage === language}
          onClick={() => void choose(language)}
        >
          {t(`language.${language}`)}
        </button>
      ))}
    </div>
  )
}
