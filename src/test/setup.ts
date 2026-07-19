import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

/**
 * Unmount between tests.
 *
 * @testing-library/react only auto-registers this when Vitest `globals` are
 * enabled, and they are not — we import describe/it/expect explicitly so the
 * engine project can run with no ambient globals at all. Without this, renders
 * accumulate in the same jsdom document and queries fail with "found multiple
 * elements", which reads like a component bug rather than a config gap.
 */
afterEach(() => {
  cleanup()
})
