import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import ApprovalService, { approvalShapeKey, commandPrefixTokens, forbiddenPrefixReason, setApprovalPolicy } from '@deepseek-ai/dsh-user-approval'
import type { ApprovalOutcome, ApprovalRequest } from '@deepseek-ai/dsh-user-approval'

/**
 * A minimal Agent stand-in over one private fake session — the service only
 * reaches `agent.session.append` and folds `.events`. Seeded inside an open
 * turn (request()'s turn-enclosure precondition). Returns the recorded audit
 * appends alongside the fake.
 */
function fakeAgent(): { agent: Agent; appended: Array<{ type: string; data: Record<string, unknown> }> } {
  const appended: Array<{ type: string; data: Record<string, unknown> }> = []
  const agent = {
    session: {
      events: [{ type: 'turn/start' }, { type: 'user/message' }],
      append: (type: string, data: Record<string, unknown>) => {
        appended.push({ type, data })
        return { type, data } as unknown as SessionEvent
      },
    },
  } as unknown as Agent
  return { agent, appended }
}

async function mounted(config: Partial<{ policy: 'ask' | 'never'; cacheMaxEntries: number }> = {}): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(ApprovalService, config)
  return ctx
}

function requestOf(agent: Agent, args: unknown, overrides: Partial<ApprovalRequest> = {}): ApprovalRequest {
  return { agent, toolName: 'bash', arguments: args, ...overrides }
}

/** Mount a counting answerer that grants every consultation. */
function consultationCount(ctx: Context): { value: () => number } {
  let count = 0
  ctx.on('approval/request', () => {
    count += 1
    return Promise.resolve<ApprovalOutcome>('allowed-once')
  })
  return { value: () => count }
}

describe('approvalShapeKey normalization', () => {
  it('collapses whitespace runs inside strings but keeps quoting and case significant', () => {
    expect(approvalShapeKey('bash', { command: 'cargo   test' }))
      .toBe(approvalShapeKey('bash', { command: 'cargo test' }))
    expect(approvalShapeKey('bash', { command: ' cargo\ttest\n' }))
      .toBe(approvalShapeKey('bash', { command: 'cargo test' }))
    // Quotes can change what a command does, so they stay part of the shape.
    expect(approvalShapeKey('bash', { command: 'echo "a b"' }))
      .not.toBe(approvalShapeKey('bash', { command: 'echo a b' }))
    // Case stays significant for the same reason.
    expect(approvalShapeKey('bash', { command: 'Cargo test' }))
      .not.toBe(approvalShapeKey('bash', { command: 'cargo test' }))
  })

  it('ignores object member order but keeps array order', () => {
    expect(approvalShapeKey('todo_write', { todos: 'x', mode: 'replace' }))
      .toBe(approvalShapeKey('todo_write', { mode: 'replace', todos: 'x' }))
    // argv order is semantic: a re-ordered token list is a different call.
    expect(approvalShapeKey('bash', { command: 'grep --foo bar' }))
      .not.toBe(approvalShapeKey('bash', { command: 'grep bar --foo' }))
    expect(approvalShapeKey('echo-tool', { parts: ['a', 'b'] }))
      .not.toBe(approvalShapeKey('echo-tool', { parts: ['b', 'a'] }))
  })

  it('keys on the exact tool name and treats an undefined member as absent', () => {
    expect(approvalShapeKey('bash', { command: 'ls' }))
      .not.toBe(approvalShapeKey('pwsh', { command: 'ls' }))
    expect(approvalShapeKey('todo_write', { todos: 'x', note: undefined }))
      .toBe(approvalShapeKey('todo_write', { todos: 'x' }))
  })

  it('normalizes nested shapes recursively', () => {
    const left = { command: '  run   it  ', options: { depth: 2, cache: true, drops: undefined } }
    const right = { options: { cache: true, depth: 2 }, command: 'run it' }
    expect(approvalShapeKey('bash', left)).toBe(approvalShapeKey('bash', right))
  })
})

describe('commandPrefixTokens', () => {
  it('splits, trims, and collapses; non-strings yield no tokens', () => {
    expect(commandPrefixTokens('  cargo   test --foo  ')).toEqual(['cargo', 'test', '--foo'])
    expect(commandPrefixTokens(undefined)).toEqual([])
    expect(commandPrefixTokens({ command: 'ls' })).toEqual([])
  })
})

describe('forbiddenPrefixReason', () => {
  it('refuses rm, heredocs, interpreters, and wrapper-resolved shapes; allows real prefixes', () => {
    expect(forbiddenPrefixReason(['rm', '-rf'])).toMatch(/forbidden command "rm"/)
    expect(forbiddenPrefixReason(['cargo', 'test', '<<EOF'])).toMatch(/heredoc operator/)
    expect(forbiddenPrefixReason(['sudo', 'rm', '-rf'])).toMatch(/forbidden command "rm"/)
    expect(forbiddenPrefixReason(['env', 'FOO=1', 'python3', '-c'])).toMatch(/forbidden command "python3"/)
    expect(forbiddenPrefixReason(['nohup', 'node', 'script.js'])).toMatch(/forbidden command "node"/)
    expect(forbiddenPrefixReason(['cargo', 'test'])).toBeUndefined()
    expect(forbiddenPrefixReason(['sudo', 'cargo', 'test'])).toBeUndefined()
  })

  it('refuses bare forbidden tokens anywhere, family spellings, and wrapper-only rules', () => {
    // Value-taking fronts still hit the bare-token check.
    expect(forbiddenPrefixReason(['timeout', '10', 'rm', '-rf'])).toMatch(/forbidden command "rm"/)
    expect(forbiddenPrefixReason(['xargs', 'python3'])).toMatch(/forbidden command "python3"/)
    // A leading spelling that extends a forbidden name is the same family.
    expect(forbiddenPrefixReason(['python3.11', '-c'])).toMatch(/"python" command family/)
    expect(forbiddenPrefixReason(['rmdir', 'tmp'])).toMatch(/"rm" command family/)
    // A rule resolving to nothing but wrappers would stand for every wrapper invocation.
    expect(forbiddenPrefixReason(['sudo'])).toMatch(/resolves to no concrete command/)
    expect(forbiddenPrefixReason(['env', 'FOO=1'])).toMatch(/resolves to no concrete command/)
    // The single-letter `R` member never prefix-matches (it would block every R-prefixed word).
    expect(forbiddenPrefixReason(['RustUp', 'show'])).toBeUndefined()
  })
})

describe('session approval cache', () => {
  it('asks once for the first shape and serves an identical second shape without consulting', async () => {
    const ctx = await mounted()
    const { agent, appended } = fakeAgent()
    const consulted = consultationCount(ctx)

    await expect(ctx.approval.request(requestOf(agent, { command: 'cargo test --foo' }))).resolves.toBe('allowed-once')
    expect(consulted.value()).toBe(1)
    await expect(ctx.approval.request(requestOf(agent, { command: 'cargo    test --foo' }))).resolves.toBe('allowed-once')
    // The cache answered the second ask: no answerer ran, and the durable
    // audit pair still lands for every ask.
    expect(consulted.value()).toBe(1)
    expect(appended.map(event => event.type)).toEqual([
      'approval/asked', 'approval/decided', 'approval/asked', 'approval/decided',
    ])
    expect(appended[3]?.data).toMatchObject({ outcome: 'allowed-once' })
  })

  it('asks again for a different shape, and a rejection is not cached', async () => {
    const ctx = await mounted()
    const { agent } = fakeAgent()
    let count = 0
    ctx.on('approval/request', () => {
      count += 1
      return Promise.resolve<ApprovalOutcome>('rejected')
    })

    await expect(ctx.approval.request(requestOf(agent, { command: 'rm -rf tmp' }))).resolves.toBe('rejected')
    await expect(ctx.approval.request(requestOf(agent, { command: 'rm -rf tmp' }))).resolves.toBe('rejected')
    expect(count).toBe(2)
    await expect(ctx.approval.request(requestOf(agent, { command: 'rm -rf other' }))).resolves.toBe('rejected')
    expect(count).toBe(3)
  })

  it('cancelled and unavailable outcomes are not cached', async () => {
    const ctx = await mounted()
    const { agent } = fakeAgent()
    let count = 0
    ctx.on('approval/request', () => {
      count += 1
      return Promise.resolve<ApprovalOutcome>('unavailable')
    })

    await expect(ctx.approval.request(requestOf(agent, { command: 'ls' }))).resolves.toBe('unavailable')
    await expect(ctx.approval.request(requestOf(agent, { command: 'ls' }))).resolves.toBe('unavailable')
    expect(count).toBe(2)
  })

  it('asks without arguments stay outside the cache entirely', async () => {
    const ctx = await mounted()
    const { agent } = fakeAgent()
    const consulted = consultationCount(ctx)

    await expect(ctx.approval.request({ agent, toolName: 'bash' })).resolves.toBe('allowed-once')
    await expect(ctx.approval.request({ agent, toolName: 'bash' })).resolves.toBe('allowed-once')
    expect(consulted.value()).toBe(2)
  })

  it('caches per session, not per process', async () => {
    const ctx = await mounted()
    const { agent: agentA } = fakeAgent()
    const { agent: agentB } = fakeAgent()
    const consulted = consultationCount(ctx)

    await expect(ctx.approval.request(requestOf(agentA, { command: 'ls' }))).resolves.toBe('allowed-once')
    await expect(ctx.approval.request(requestOf(agentB, { command: 'ls' }))).resolves.toBe('allowed-once')
    expect(consulted.value()).toBe(2)
  })

  it('evicts the oldest shape beyond the configured capacity', async () => {
    const ctx = await mounted({ cacheMaxEntries: 1 })
    const { agent } = fakeAgent()
    const consulted = consultationCount(ctx)

    await ctx.approval.request(requestOf(agent, { command: 'first' }))
    expect(consulted.value()).toBe(1)
    // Within capacity: the repeat is a hit.
    await ctx.approval.request(requestOf(agent, { command: 'first' }))
    expect(consulted.value()).toBe(1)
    // The second shape evicts "first" (capacity 1) and consults.
    await ctx.approval.request(requestOf(agent, { command: 'second' }))
    expect(consulted.value()).toBe(2)
    // "first" was evicted, so it asks again.
    await ctx.approval.request(requestOf(agent, { command: 'first' }))
    expect(consulted.value()).toBe(3)
  })

  it('refreshing a hit keeps it cached under capacity pressure', async () => {
    const ctx = await mounted({ cacheMaxEntries: 2 })
    const { agent } = fakeAgent()
    const consulted = consultationCount(ctx)

    await ctx.approval.request(requestOf(agent, { command: 'a' }))
    await ctx.approval.request(requestOf(agent, { command: 'b' }))
    await ctx.approval.request(requestOf(agent, { command: 'a' }))
    await ctx.approval.request(requestOf(agent, { command: 'c' }))
    expect(consulted.value()).toBe(3)
    // The "a" hit refreshed its position, so "c" evicted "b" — "a" survives.
    await ctx.approval.request(requestOf(agent, { command: 'a' }))
    expect(consulted.value()).toBe(3)
    // "b" was the evicted entry, so it asks again.
    await ctx.approval.request(requestOf(agent, { command: 'b' }))
    expect(consulted.value()).toBe(4)
  })

  it('cacheMaxEntries 0 disables the cache', async () => {
    const ctx = await mounted({ cacheMaxEntries: 0 })
    const { agent } = fakeAgent()
    const consulted = consultationCount(ctx)

    await ctx.approval.request(requestOf(agent, { command: 'ls' }))
    await ctx.approval.request(requestOf(agent, { command: 'ls' }))
    expect(consulted.value()).toBe(2)
  })

  it('rejects a non-integer or negative capacity at construction', () => {
    expect(() => new ApprovalService(new Context(), { cacheMaxEntries: 1.5 }))
      .toThrow('approval cacheMaxEntries must be a non-negative integer (0 disables the cache)')
    expect(() => new ApprovalService(new Context(), { cacheMaxEntries: -1 }))
      .toThrow('approval cacheMaxEntries must be a non-negative integer (0 disables the cache)')
  })

  it('never rejects deterministically even for a cached shape', async () => {
    const ctx = await mounted()
    // A real session so the approval/policy fold sees the switch (the fake
    // session's append does not grow its own folded events array).
    const session = Session.create(SessionId('sess-wp8-never-cache'))
    session.append('turn/start', { turn: 1 })
    const agent = { session } as unknown as Agent
    let count = 0
    ctx.on('approval/request', () => {
      count += 1
      return Promise.resolve<ApprovalOutcome>('allowed-once')
    })
    await ctx.approval.request(requestOf(agent, { command: 'ls' }))

    setApprovalPolicy(session, 'never')
    await expect(ctx.approval.request(requestOf(agent, { command: 'ls' }))).resolves.toBe('rejected')
    expect(count).toBe(1)
  })
})

describe('persisted prefix rules', () => {
  it('answers matching later asks without consulting and still audits the pair', async () => {
    const ctx = await mounted()
    const { agent, appended } = fakeAgent()
    const consulted = consultationCount(ctx)

    ctx.approval.persistPrefix(agent, 'bash', ['cargo', 'test'])
    await expect(ctx.approval.request(requestOf(agent, { command: 'cargo test --foo' }))).resolves.toBe('allowed-once')
    expect(consulted.value()).toBe(0)
    expect(appended.map(event => event.type)).toEqual(['approval/asked', 'approval/decided'])
    expect(appended[1]?.data).toMatchObject({ outcome: 'allowed-once' })
  })

  it('matches only the exact tool and the exact leading tokens', async () => {
    const ctx = await mounted()
    const { agent } = fakeAgent()
    const consulted = consultationCount(ctx)
    ctx.approval.persistPrefix(agent, 'bash', ['cargo', 'test'])

    // A different tool with the same command text is NOT covered: rules are
    // tool-scoped so a bash grant never governs another command-carrying tool.
    await expect(ctx.approval.request({ agent, toolName: 'pwsh', arguments: { command: 'cargo test --foo' } }))
      .resolves.toBe('allowed-once')
    expect(consulted.value()).toBe(1)
    // A different leading command is NOT covered.
    await expect(ctx.approval.request(requestOf(agent, { command: 'cargo build --release' })))
      .resolves.toBe('allowed-once')
    expect(consulted.value()).toBe(2)
    // Whitespace-normalized prefix match works.
    await expect(ctx.approval.request(requestOf(agent, { command: 'cargo   test' })))
      .resolves.toBe('allowed-once')
    expect(consulted.value()).toBe(2)
  })

  it('rejects forbidden shapes at persist time and stores nothing', async () => {
    const ctx = await mounted()
    const { agent } = fakeAgent()
    const consulted = consultationCount(ctx)

    for (const tokens of [['rm', '-rf'], ['sudo', 'rm'], ['python3'], ['env', 'FOO=1', 'python3', '-c'], ['bash', '-c'], ['timeout', '10', 'rm'], ['python3.11'], ['sudo']]) {
      expect(() => ctx.approval.persistPrefix(agent, 'bash', tokens)).toThrow(/forbidden command|heredoc operator|command family|no concrete command/)
    }
    expect(() => ctx.approval.persistPrefix(agent, 'bash', ['cargo', 'test', '<<EOF'])).toThrow(/heredoc operator/)

    // Nothing was stored: the rm-shaped ask still reaches the answerer.
    await expect(ctx.approval.request(requestOf(agent, { command: 'rm -rf tmp' }))).resolves.toBe('allowed-once')
    expect(consulted.value()).toBe(1)
  })

  it('never matches a rule for a command without tokens', async () => {
    const ctx = await mounted()
    const { agent } = fakeAgent()
    const consulted = consultationCount(ctx)
    ctx.approval.persistPrefix(agent, 'bash', ['cargo', 'test'])

    await expect(ctx.approval.request(requestOf(agent, { command: '   ' }))).resolves.toBe('allowed-once')
    expect(consulted.value()).toBe(1)
  })

  it('validates tokens before storing', async () => {
    const ctx = await mounted()
    const { agent } = fakeAgent()
    expect(() => ctx.approval.persistPrefix(agent, 'bash', [])).toThrow('a prefix rule needs at least one command token')
    expect(() => ctx.approval.persistPrefix(agent, 'bash', ['cargo', ''])).toThrow('every prefix-rule token must be a non-empty string')
    expect(() => ctx.approval.persistPrefix(agent, 'bash', ['cargo', 3 as unknown as string]))
      .toThrow('every prefix-rule token must be a non-empty string')
  })

  it('persists an exact duplicate as the same rule', async () => {
    const ctx = await mounted()
    const { agent } = fakeAgent()
    ctx.approval.persistPrefix(agent, 'bash', ['cargo', 'test'])
    expect(() => ctx.approval.persistPrefix(agent, 'bash', ['cargo', 'test'])).not.toThrow()
  })

  it('scopes rules to their session', async () => {
    const ctx = await mounted()
    const { agent: agentA } = fakeAgent()
    const { agent: agentB } = fakeAgent()
    const consulted = consultationCount(ctx)

    ctx.approval.persistPrefix(agentA, 'bash', ['cargo', 'test'])
    await expect(ctx.approval.request(requestOf(agentB, { command: 'cargo test --foo' }))).resolves.toBe('allowed-once')
    expect(consulted.value()).toBe(1)
  })

  it('never rejects deterministically even when a rule matches', async () => {
    const ctx = await mounted({ policy: 'never' })
    const { agent } = fakeAgent()
    let count = 0
    ctx.on('approval/request', (_req, next) => {
      count += 1
      return next()
    })
    ctx.approval.persistPrefix(agent, 'bash', ['cargo', 'test'])

    await expect(ctx.approval.request(requestOf(agent, { command: 'cargo test --foo' }))).resolves.toBe('rejected')
    expect(count).toBe(0)
  })

  it('asks without arguments never match a rule', async () => {
    const ctx = await mounted()
    const { agent } = fakeAgent()
    const consulted = consultationCount(ctx)
    ctx.approval.persistPrefix(agent, 'bash', ['cargo', 'test'])

    await expect(ctx.approval.request({ agent, toolName: 'bash' })).resolves.toBe('allowed-once')
    expect(consulted.value()).toBe(1)
  })
})
