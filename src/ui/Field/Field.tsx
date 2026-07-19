import { useId, type InputHTMLAttributes, type Ref } from 'react'
import styles from './Field.module.css'

export interface FieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'className' | 'id'> {
  readonly label: string
  readonly error?: string | undefined
  readonly hint?: string | undefined
  readonly ref?: Ref<HTMLInputElement>
}

/**
 * A labelled input with wired-up error and hint associations.
 *
 * The accessibility plumbing lives here rather than at each call site because
 * `aria-describedby` pointing at the right ids is exactly the thing that gets
 * forgotten, and a screen reader then announces an error that isn't connected to
 * anything.
 */
export function Field({ label, error, hint, ref, ...props }: FieldProps) {
  const id = useId()
  const errorId = `${id}-error`
  const hintId = `${id}-hint`

  const describedBy = [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(' ')

  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={id}>
        {label}
      </label>

      <input
        {...props}
        id={id}
        ref={ref}
        className={styles.input}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy || undefined}
      />

      {hint ? (
        <p className={styles.hint} id={hintId}>
          {hint}
        </p>
      ) : null}

      {error ? (
        // role="alert" so the message is announced when it appears after a
        // failed submit, not only when focus happens to land on the input.
        <p className={styles.error} id={errorId} role="alert">
          <svg
            className={styles.errorIcon}
            width="16"
            height="16"
            viewBox="0 0 16 16"
            aria-hidden="true"
            focusable="false"
          >
            <path
              fill="currentColor"
              d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1Zm0 3.2c.5 0 .9.4.9.9v3.6a.9.9 0 1 1-1.8 0V5.1c0-.5.4-.9.9-.9Zm0 6.4a1 1 0 1 1 0 2 1 1 0 0 1 0-2Z"
            />
          </svg>
          {error}
        </p>
      ) : null}
    </div>
  )
}
