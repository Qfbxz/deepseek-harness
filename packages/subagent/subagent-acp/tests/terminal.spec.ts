import { describe, expect, it } from 'vitest'
import type { CreateTerminalRequest } from '@agentclientprotocol/sdk'
import type { SubprocessCollectedOutputs, SubprocessHandle, SubprocessOutcome, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import {
  AcpTerminalPool,
  clampTailBytes,
  DEFAULT_TERMINAL_OUTPUT_BYTE_LIMIT,
  validatedCreate,
} from '../src/terminal.ts'

/** Scripted collect-mode reader over a fixed retained tail. */
class FakeReader {
  constructor(readonly text: string, readonly lossy = false) {}
  readFrom(fromByte: number): { text: string; nextOffset: number; lossy: boolean } {
    // The pool only ever reads whole snapshots (fromByte 0); a nonzero cursor
    // would mean a protocol change on our side.
    expect(fromByte).toBe(0)
    return { text: this.text, nextOffset: Buffer.byteLength(this.text), lossy: this.lossy }
  }
}

/** A subprocess-seam handle scripted for one terminal command. */
class FakeHandle implements SubprocessHandle {
  readonly pid = 4321
  readonly stdin = undefined
  readonly stdout = undefined
  readonly stderr = undefined
  terminateCount = 0
  constructor(
    private readonly outcome: SubprocessOutcome | Error,
    readonly collected: SubprocessCollectedOutputs,
  ) {}
  get done(): Promise<SubprocessOutcome> {
    return this.outcome instanceof Error ? Promise.reject(this.outcome) : Promise.resolve(this.outcome)
  }
  terminate(): void {
    this.terminateCount += 1
  }
  waitForExit(): Promise<boolean> {
    return Promise.resolve(true)
  }
}

/** A spawn fn that records the spec and hands back the scripted handle. */
function scriptedSpawn(handle: FakeHandle): { spawn: (spec: SubprocessSpawnSpec) => SubprocessHandle; last(): SubprocessSpawnSpec } {
  let last: SubprocessSpawnSpec | undefined
  const spawn = (spec: SubprocessSpawnSpec): SubprocessHandle => {
    last = spec
    return handle
  }
  return { spawn, last: () => last! }
}

function pool(handle: FakeHandle, outputByteLimit = DEFAULT_TERMINAL_OUTPUT_BYTE_LIMIT): AcpTerminalPool {
  return new AcpTerminalPool({
    spawn: scriptedSpawn(handle).spawn,
    defaultCwd: '/work',
    graceMs: 3_000,
    outputByteLimit,
  })
}

function untrusted(params: unknown): CreateTerminalRequest {
  return params as CreateTerminalRequest
}

describe('clampTailBytes', () => {
  it('keeps a snapshot within the bound unchanged', () => {
    expect(clampTailBytes('abc', 16)).toEqual({ text: 'abc', truncated: false })
  })

  it('drops whole leading bytes beyond the bound', () => {
    expect(clampTailBytes('abcdef', 3)).toEqual({ text: 'def', truncated: true })
  })

  it('does not split a multibyte character at the cut', () => {
    // 'éé' is 4 bytes; a 3-byte bound must keep the LAST whole character.
    expect(clampTailBytes('éé', 3)).toEqual({ text: 'é', truncated: true })
  })
})

describe('validatedCreate', () => {
  it('fills the cwd, env, and limit defaults', () => {
    expect(validatedCreate({ sessionId: 's', command: 'ls' })).toEqual({
      argv: ['ls'],
      cwd: '',
      env: {},
      outputByteLimit: DEFAULT_TERMINAL_OUTPUT_BYTE_LIMIT,
    })
  })

  it('passes through argv, cwd, env, and the request limit', () => {
    expect(validatedCreate({
      sessionId: 's',
      command: 'echo',
      args: ['hi'],
      cwd: '/tmp',
      env: [{ name: 'A', value: '1' }],
      outputByteLimit: 10,
    })).toEqual({ argv: ['echo', 'hi'], cwd: '/tmp', env: { A: '1' }, outputByteLimit: 10 })
  })

  it('rejects a wire-shaped non-command and non-string args', () => {
    expect(() => validatedCreate({ sessionId: 's', command: '' })).toThrow('command must be a non-empty string')
    expect(() => validatedCreate(untrusted({ sessionId: 's', command: 7, args: [1] }))).toThrow('command must be a non-empty string')
    expect(() => validatedCreate(untrusted({ sessionId: 's', command: 'ls', env: [{ name: 'A', value: 1 }] }))).toThrow('env entries must be { name, value } strings')
  })

  it('rejects a non-positive outputByteLimit', () => {
    expect(() => validatedCreate({ sessionId: 's', command: 'ls', outputByteLimit: 0 })).toThrow('outputByteLimit must be a positive integer')
  })
})

describe('AcpTerminalPool', () => {
  it('spawns through the seam with collect dispositions and serves the merged snapshot', async () => {
    const handle = new FakeHandle(
      { exitCode: 0, signal: null },
      {
        stdout: new FakeReader('out-tail'),
        stderr: new FakeReader('err-tail'),
      },
    )
    const { spawn, last } = scriptedSpawn(handle)
    const m = new AcpTerminalPool({ spawn, defaultCwd: '/work', graceMs: 3_000, outputByteLimit: DEFAULT_TERMINAL_OUTPUT_BYTE_LIMIT }).clientMethods()
    const { terminalId } = await m.createTerminal!({ sessionId: 's', command: 'make', args: ['-j2'], env: [{ name: 'J', value: '2' }] })
    expect(last()).toMatchObject({
      argv: ['make', '-j2'],
      cwd: '/work',
      graceMs: 3_000,
      env: { J: '2' },
      stdio: { stdin: 'ignore', stdout: { maxBytes: DEFAULT_TERMINAL_OUTPUT_BYTE_LIMIT }, stderr: { maxBytes: DEFAULT_TERMINAL_OUTPUT_BYTE_LIMIT } },
    })
    expect(await m.terminalOutput!({ sessionId: 's', terminalId })).toEqual({
      output: 'out-tailerr-tail',
      truncated: false,
      // The fake handle's `done` is already resolved, so the status is settled
      // by the time the snapshot is read.
      exitStatus: { exitCode: 0, signal: null },
    })
    expect(await m.waitForTerminalExit!({ sessionId: 's', terminalId })).toEqual({ exitCode: 0, signal: null })
  })

  it('marks lossy collection and clamps the merged snapshot to the terminal limit', async () => {
    const handle = new FakeHandle(
      { exitCode: 0, signal: null },
      { stdout: new FakeReader('abcdefghij', true), stderr: new FakeReader('xyz') },
    )
    const m = pool(handle, 8).clientMethods()
    const { terminalId } = await m.createTerminal!({ sessionId: 's', command: 'ls', outputByteLimit: 8 })
    // 13 merged bytes clamp to the LAST 8 and the lossy reader flags truncation;
    // the already-resolved fake settles the exit status.
    expect(await m.terminalOutput!({ sessionId: 's', terminalId })).toEqual({
      output: 'fghijxyz',
      truncated: true,
      exitStatus: { exitCode: 0, signal: null },
    })
  })

  it('kill keeps the id valid; release invalidates it', async () => {
    const handle = new FakeHandle({ exitCode: null, signal: 'SIGTERM' }, {})
    const m = pool(handle).clientMethods()
    const { terminalId } = await m.createTerminal!({ sessionId: 's', command: 'sleep' })
    await m.killTerminal!({ sessionId: 's', terminalId })
    expect(handle.terminateCount).toBe(1)
    await expect(m.terminalOutput!({ sessionId: 's', terminalId })).resolves.toBeDefined()
    await m.releaseTerminal!({ sessionId: 's', terminalId })
    expect(handle.terminateCount).toBe(2)
    await expect(m.terminalOutput!({ sessionId: 's', terminalId })).rejects.toThrow()
  })

  it('maps a spawn-level failure to output text and exit 127', async () => {
    const handle = new FakeHandle(new Error('spawn ENOENT: nosuchcmd'), {})
    const m = pool(handle).clientMethods()
    const { terminalId } = await m.createTerminal!({ sessionId: 's', command: 'nosuchcmd' })
    expect(await m.waitForTerminalExit!({ sessionId: 's', terminalId })).toEqual({ exitCode: 127, signal: null })
    expect(await m.terminalOutput!({ sessionId: 's', terminalId })).toMatchObject({ output: 'spawn ENOENT: nosuchcmd' })
  })

  it('releaseAll terminates and forgets every terminal', async () => {
    const handle = new FakeHandle({ exitCode: 0, signal: null }, {})
    const p = pool(handle)
    const m = p.clientMethods()
    const a = (await m.createTerminal!({ sessionId: 's', command: 'a' })).terminalId
    const b = (await m.createTerminal!({ sessionId: 's', command: 'b' })).terminalId
    await p.releaseAll()
    expect(handle.terminateCount).toBe(2)
    await expect(m.terminalOutput!({ sessionId: 's', terminalId: a })).rejects.toThrow()
    await expect(m.terminalOutput!({ sessionId: 's', terminalId: b })).rejects.toThrow()
  })
})
