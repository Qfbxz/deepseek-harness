/** Covers cross-copy scheduler identity: profile-installed plugin copies of this package must interoperate with the host copy. */

import { describe, expect, it } from 'vitest'
import { TOOL_RUNTIME_SCHEDULER } from '@deepseek-ai/dsh-tools'

describe('TOOL_RUNTIME_SCHEDULER', () => {
  it('keys the global symbol registry under the documented name', () => {
    expect(TOOL_RUNTIME_SCHEDULER).toBe(Symbol.for('@deepseek-ai/dsh-tools.scheduler'))
  })
})
