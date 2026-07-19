import type { CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'

import { CHAMPION_AT, DEMO_MATCHES, DEMO_ROUNDS, type DemoMatch, type DemoSide } from './demoDraw'
import styles from './DrawDemo.module.css'

/**
 * The hero: a knockout bracket that fills itself in.
 *
 * Everything is CSS animation driven by per-element delays taken from the data,
 * so there is no timer, no state, and nothing to clean up — which also means it
 * server-renders as a finished bracket. The component is pure markup.
 */

/** Timeline delays are passed down as custom properties on the style attribute. */
function delay(values: Record<string, string>): CSSProperties {
  return values
}

const ms = (value: number) => `${String(value)}ms`

function Side({
  side,
  match,
  isFeeder,
  feederRound,
  feederIndex,
  isChampion,
}: {
  readonly side: DemoSide
  readonly match: DemoMatch
  readonly isFeeder: boolean
  readonly feederRound: number
  readonly feederIndex: number
  readonly isChampion: boolean
}) {
  const { t } = useTranslation('landing')

  // A slot in round 2+ starts as "Ganador C3" and is replaced when its feeder
  // resolves. Round 1 slots have their names from the start.
  const nameAppearsAt = isFeeder ? match.revealAt - 400 : 300

  return (
    <div
      className={styles.side}
      data-won={side.won ? 'true' : undefined}
      data-champion={isChampion ? 'true' : undefined}
      style={isChampion ? delay({ '--d-crown': ms(CHAMPION_AT) }) : undefined}
    >
      <span className={styles.seed}>{side.seed}</span>

      <span className={styles.nameCell}>
        {isFeeder ? (
          <span
            className={`${styles.pending} ${styles.fadeOut}`}
            style={delay({ '--d': ms(nameAppearsAt - 150) })}
            aria-hidden="true"
          >
            {t('draw.pending', { round: feederRound, index: feederIndex })}
          </span>
        ) : null}

        <span className={`${styles.name} ${styles.reveal}`} style={delay({ '--d': ms(nameAppearsAt) })}>
          {side.name}
        </span>
      </span>

      <span className={styles.sets}>
        {side.sets.map((games, index) => (
          <span
            key={index}
            className={`${styles.set} ${styles.reveal}`}
            style={delay({ '--d': ms(match.revealAt + index * 90) })}
          >
            {games}
          </span>
        ))}
      </span>

      {/* The champion emerges from the bracket rather than sitting in a column
          beside it: the winning side of the final fills in and takes a tag.
          More integrated, and it returns ~180px of width to the draw itself. */}
      {isChampion ? (
        <span className={styles.crown}>{t('draw.champion')}</span>
      ) : null}
    </div>
  )
}

export function DrawDemo() {
  const { t } = useTranslation('landing')

  const byRound = DEMO_ROUNDS.map((round) => DEMO_MATCHES.filter((m) => m.round === round))

  return (
    <figure className={styles.wrapper}>
      <div className={styles.scroller}>
        <div className={styles.bracket}>
          {DEMO_ROUNDS.map((round, roundIndex) => {
            const matches = byRound[roundIndex] ?? []
            const isLastRound = round === DEMO_ROUNDS.length

            return (
              <ol key={round} className={styles.round} data-round={round}>
                {matches.map((match, index) => {
                  // Which quarter-final feeds this slot, for the placeholder text.
                  const feederBase = index * 2 + 1

                  return (
                    <li key={match.id} className={styles.slot}>
                      <div
                        className={styles.match}
                        data-decided={undefined}
                        data-out={isLastRound ? undefined : 'true'}
                        data-in={round === 1 ? undefined : 'true'}
                        style={delay({
                          '--d-line': ms(200 + roundIndex * 260),
                        })}
                      >
                        {/* Vertical join, drawn once per pair from the upper match. */}
                        {!isLastRound && index % 2 === 0 ? (
                          <span
                            className={styles.join}
                            style={delay({ '--d-line': ms(320 + roundIndex * 260) })}
                            aria-hidden="true"
                          />
                        ) : null}

                        <Side
                          side={match.home}
                          match={match}
                          isFeeder={round !== 1}
                          feederRound={round - 1}
                          feederIndex={feederBase}
                          isChampion={isLastRound && match.home.won}
                        />
                        <Side
                          side={match.away}
                          match={match}
                          isFeeder={round !== 1}
                          feederRound={round - 1}
                          feederIndex={feederBase + 1}
                          isChampion={isLastRound && match.away.won}
                        />

                        {/* The single use of optic yellow: the final, in progress. */}
                        {match.liveFrom !== undefined ? (
                          <span
                            className={`${styles.live} ${styles.liveWindow}`}
                            style={delay({
                              '--d-in': ms(match.liveFrom),
                              '--live-duration': ms(match.revealAt - match.liveFrom - 150),
                            })}
                          >
                            <span className={styles.liveDot} aria-hidden="true" />
                            {t('draw.live')}
                          </span>
                        ) : null}
                      </div>
                    </li>
                  )
                })}
              </ol>
            )
          })}

        </div>
      </div>

      <figcaption className={styles.caption}>{t('draw.caption')}</figcaption>
    </figure>
  )
}
