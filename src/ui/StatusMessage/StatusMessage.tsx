import type { ReactNode } from 'react'
import styles from './StatusMessage.module.css'

export type StatusTone = 'loading' | 'empty' | 'error'

export interface StatusMessageProps {
  readonly tone: StatusTone
  readonly title: string
  readonly body?: string | undefined
  /** The recovery action. An error without one is just bad news. */
  readonly action?: ReactNode
}

/**
 * One component for loading, empty and error states.
 *
 * Consolidating them enforces the house rule that an error says what happened
 * AND how to fix it: `body` is where the explanation goes and `action` is the
 * way out. A state that has neither reads as obviously unfinished in review.
 */
export function StatusMessage({ tone, title, body, action }: StatusMessageProps) {
  return (
    <div
      className={styles.status}
      data-tone={tone}
      // Errors interrupt; loading and empty states are announced politely so a
      // screen reader is not talked over mid-sentence.
      role={tone === 'error' ? 'alert' : 'status'}
      aria-live={tone === 'error' ? 'assertive' : 'polite'}
    >
      {tone === 'loading' ? <div className={styles.spinner} aria-hidden="true" /> : null}
      <p className={styles.title}>{title}</p>
      {body ? <p className={styles.body}>{body}</p> : null}
      {action}
    </div>
  )
}
