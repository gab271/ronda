import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { DrawDemo } from './DrawDemo'
import { LanguageToggle } from '~/features/i18n/LanguageToggle'
import styles from './LandingRoute.module.css'

/**
 * The landing page.
 *
 * Deliberately imports NO auth code and no supabase-js. A signed-in organiser
 * clicking "Entrar" is routed onward by the sign-in route itself; checking the
 * session here would pull ~51KB of auth client onto the one page whose whole job
 * is to load fast for a stranger.
 *
 * The hero is the product, not a description of it: DrawDemo renders a real
 * bracket that fills itself in. Everything below it stays quiet so that stays
 * the one memorable thing.
 */
export default function LandingRoute() {
  const { t } = useTranslation('landing')
  // The product name lives in `common` so it reads identically on every surface.
  const { t: tCommon } = useTranslation('common')

  const formats = ['roundRobin', 'knockout', 'double', 'groups', 'swiss', 'courts'] as const
  const steps = ['one', 'two', 'three'] as const
  const linkPoints = ['one', 'two', 'three'] as const

  return (
    <div className={styles.page}>
      <a className={styles.skipLink} href="#contenido">
        {t('nav.skipToContent')}
      </a>

      {/* ── The court ─────────────────────────────────────────────────────── */}
      <header className={styles.court}>
        <div className={styles.markings} aria-hidden="true">
          {/* A padel court seen from above: outer box, service lines, centre
              line. Scaled up and cropped so it reads as surface, not diagram. */}
          <svg
            className={styles.markingsSvg}
            viewBox="0 0 200 100"
            preserveAspectRatio="xMidYMid slice"
          >
            <rect x="10" y="8" width="180" height="84" strokeWidth="0.5" />
            <line x1="100" y1="8" x2="100" y2="92" strokeWidth="0.5" />
            <line x1="45" y1="8" x2="45" y2="92" strokeWidth="0.5" />
            <line x1="155" y1="8" x2="155" y2="92" strokeWidth="0.5" />
            <line x1="45" y1="50" x2="155" y2="50" strokeWidth="0.5" />
          </svg>
        </div>

        <div className={styles.courtInner}>
          <nav className={styles.bar}>
            <span className={styles.wordmark}>
              <span className={styles.wordmarkRule} aria-hidden="true" />
              {tCommon('appName')}
            </span>

            <div className={styles.barActions}>
              <LanguageToggle onBrand />
              <Link className={styles.barLink} to="/entrar">
                {t('nav.signIn')}
              </Link>
            </div>
          </nav>

          <div className={styles.hero}>
            <div className={styles.heroCopy}>
              <p className={styles.eyebrow}>{t('hero.eyebrow')}</p>
              <h1 className={styles.title}>{t('hero.title')}</h1>
              <p className={styles.lead}>{t('hero.lead')}</p>

              <div className={styles.actions}>
                <Link className={styles.primaryCta} to="/registro">
                  {t('hero.primary')}
                </Link>
                <Link className={styles.secondaryCta} to="/t/ejemplo">
                  {t('hero.secondary')}
                </Link>
              </div>

              <p className={styles.note}>{t('hero.note')}</p>
            </div>

            <div className={styles.drawBlock}>
              <DrawDemo />
            </div>
          </div>
        </div>
      </header>

      <main id="contenido">
        {/* ── Before / after ──────────────────────────────────────────────── */}
        <section className={styles.section}>
          <div className={styles.sectionHead}>
            <p className={styles.sectionEyebrow}>{t('before.eyebrow')}</p>
            <h2 className={styles.sectionTitle}>{t('before.title')}</h2>
          </div>

          <div className={styles.compare}>
            <article className={styles.panel} data-tone="old">
              <h3 className={styles.panelTitle}>{t('before.old.title')}</h3>
              <p className={styles.panelBody}>{t('before.old.body')}</p>
            </article>
            <article className={styles.panel} data-tone="new">
              <h3 className={styles.panelTitle}>{t('before.new.title')}</h3>
              <p className={styles.panelBody}>{t('before.new.body')}</p>
            </article>
          </div>
        </section>

        {/* ── Steps ───────────────────────────────────────────────────────── */}
        <section className={styles.section}>
          <div className={styles.sectionHead}>
            <p className={styles.sectionEyebrow}>{t('how.eyebrow')}</p>
            <h2 className={styles.sectionTitle}>{t('how.title')}</h2>
          </div>

          <ol className={styles.steps}>
            {steps.map((step, index) => (
              <li key={step} className={styles.step}>
                <span className={styles.stepNumber}>{index + 1}</span>
                <h3 className={styles.stepTitle}>{t(`how.steps.${step}.title`)}</h3>
                <p className={styles.stepBody}>{t(`how.steps.${step}.body`)}</p>
              </li>
            ))}
          </ol>
        </section>

        {/* ── Formats: the engine is the moat, so it gets the most detail ─── */}
        <section className={styles.section}>
          <div className={styles.sectionHead}>
            <p className={styles.sectionEyebrow}>{t('formats.eyebrow')}</p>
            <h2 className={styles.sectionTitle}>{t('formats.title')}</h2>
            <p className={styles.sectionLead}>{t('formats.lead')}</p>
          </div>

          <div className={styles.formats}>
            {formats.map((format) => (
              <article key={format} className={styles.format}>
                <h3 className={styles.formatTitle}>{t(`formats.${format}.title`)}</h3>
                <p className={styles.formatBody}>{t(`formats.${format}.body`)}</p>
              </article>
            ))}
          </div>
        </section>

        {/* ── The public link ─────────────────────────────────────────────── */}
        <section className={styles.linkSection}>
          <div className={styles.linkInner}>
            <div>
              <p className={styles.eyebrow}>{t('link.eyebrow')}</p>
              <h2 className={styles.linkTitle}>{t('link.title')}</h2>
              <p className={styles.linkBody}>{t('link.body')}</p>
            </div>

            <ul className={styles.linkPoints}>
              {linkPoints.map((point) => (
                <li key={point} className={styles.linkPoint}>
                  <span className={styles.linkTick} aria-hidden="true" />
                  {t(`link.points.${point}`)}
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* ── Pricing ─────────────────────────────────────────────────────── */}
        <section className={styles.section}>
          <div className={styles.sectionHead}>
            <p className={styles.sectionEyebrow}>{t('pricing.eyebrow')}</p>
            <h2 className={styles.sectionTitle}>{t('pricing.title')}</h2>
          </div>

          <div className={styles.plans}>
            <article className={styles.plan} data-featured="true">
              <h3 className={styles.planTitle}>{t('pricing.free.title')}</h3>
              <p className={styles.planPrice}>{t('pricing.free.price')}</p>
              <p className={styles.planBody}>{t('pricing.free.body')}</p>
              <Link className={styles.planCta} to="/registro">
                {t('pricing.free.cta')}
              </Link>
            </article>

            <article className={styles.plan} data-featured="false">
              <h3 className={styles.planTitle}>{t('pricing.club.title')}</h3>
              <p className={styles.planPrice}>{t('pricing.club.price')}</p>
              <p className={styles.planBody}>{t('pricing.club.body')}</p>
              <Link className={styles.planCta} to="/contacto">
                {t('pricing.club.cta')}
              </Link>
            </article>
          </div>
        </section>
      </main>

      {/* ── Footer ────────────────────────────────────────────────────────── */}
      <footer className={styles.footer}>
        <div className={styles.footerInner}>
          <div>
            <span className={styles.wordmark} data-on-light="true">
              {t('footer.company')}
            </span>
            <p className={styles.footerTagline}>{t('footer.tagline')}</p>
          </div>

          <div>
            <h2 className={styles.footerHeading}>{t('footer.product')}</h2>
            <ul className={styles.footerList}>
              <li>
                <a className={styles.footerLink} href="#contenido">
                  {t('footer.formats')}
                </a>
              </li>
              <li>
                <Link className={styles.footerLink} to="/entrar">
                  {t('footer.signIn')}
                </Link>
              </li>
            </ul>
          </div>

          <div>
            <h2 className={styles.footerHeading}>{t('footer.company')}</h2>
            <ul className={styles.footerList}>
              <li>
                <Link className={styles.footerLink} to="/contacto">
                  {t('footer.contact')}
                </Link>
              </li>
              <li>
                <Link className={styles.footerLink} to="/terminos">
                  {t('footer.terms')}
                </Link>
              </li>
            </ul>
          </div>
        </div>

        <p className={styles.footerBottom}>{t('footer.rights')}</p>
      </footer>
    </div>
  )
}
