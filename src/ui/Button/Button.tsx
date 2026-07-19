import type { ButtonHTMLAttributes, Ref } from 'react'
import styles from './Button.module.css'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'> {
  readonly variant?: ButtonVariant
  readonly fullWidth?: boolean
  /** React 19: ref is a normal prop, forwardRef is gone. */
  readonly ref?: Ref<HTMLButtonElement>
}

export function Button({
  variant = 'primary',
  fullWidth = false,
  type = 'button',
  ...props
}: ButtonProps) {
  return (
    <button
      className={styles.button}
      data-variant={variant}
      data-full={fullWidth ? 'true' : undefined}
      // Explicit default: an unqualified <button> inside a form submits it,
      // which is a recurring source of accidental submissions.
      type={type}
      {...props}
    />
  )
}
