/**
 * The ACP `terminal/*` reverse-RPC family served over the `dsh-subprocess`
 * seam. Each `terminal/create` spawns a tree-scoped subprocess with bounded
 * per-stream collection (the seam retains the tail), `terminal/output` reads
 * the retained snapshots, and kill/release ride the seam's SIGTERM → grace →
 * SIGKILL escalation. This unlocks children that route tool execution through
 * the client instead of self-serving in their own process (e.g. `kimi acp`).
 * @module @deepseek-ai/dsh-subagent-acp/terminal
 */

import { randomUUID } from 'node:crypto'
import {
  RequestError,
  type Client,
  type CreateTerminalRequest,
  type CreateTerminalResponse,
  type EnvVariable,
  type KillTerminalRequest,
  type KillTerminalResponse,
  type ReleaseTerminalRequest,
  type ReleaseTerminalResponse,
  type TerminalExitStatus,
  type TerminalOutputRequest,
  type TerminalOutputResponse,
  type WaitForTerminalExitRequest,
  type WaitForTerminalExitResponse,
} from '@agentclientprotocol/sdk'
import type { SubprocessHandle, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'

/** Default retained-output byte cap per terminal when create omits `outputByteLimit`. */
export const DEFAULT_TERMINAL_OUTPUT_BYTE_LIMIT = 1_000_000

/** The five optional `Client` methods this pool serves. */
export type TerminalClientMethods = Pick<Client,
  'createTerminal' | 'terminalOutput' | 'waitForTerminalExit' | 'killTerminal' | 'releaseTerminal'
>

/** Options for one run's terminal pool. */
export interface AcpTerminalPoolOptions {
  /** Spawn function from the subprocess seam (`ctx.subprocess.spawn`). */
  spawn: (spec: SubprocessSpawnSpec) => SubprocessHandle
  /** Working directory for terminals whose create request omits `cwd`. */
  defaultCwd: string
  /** Termination-escalation grace passed to every terminal spawn. */
  graceMs: number
  /** Retained-output byte cap reported through `terminal/output`. */
  outputByteLimit: number
}

/** One live or settled terminal and its settled exit facts. */
interface ManagedTerminal {
  /** The subprocess-seam handle for the command's process tree. */
  readonly handle: SubprocessHandle
  /** Retained-output byte cap for this terminal. */
  readonly outputByteLimit: number
  /** Exit facts; resolves also for spawn-level failures (mapped to exit 127). */
  readonly outcome: Promise<TerminalExitStatus>
  /** The settled exit facts, or null until `outcome` settles. */
  settled: TerminalExitStatus | null
  /** Spawn-level failure text; the terminal's only output when set. */
  spawnFailure: string | null
}

/** Normalize an unknown thrown value to its message text. */
function messageOf(value: unknown): string {
  return value instanceof Error ? value.message : String(value)
}

/**
 * Clamp `text` to at most `maxBytes` UTF-8 bytes by dropping whole characters
 * from the head, so the retained tail stays valid UTF-8.
 * @param text - the candidate output snapshot.
 * @param maxBytes - the byte bound for the emitted snapshot.
 * @returns the clamped text and whether any bytes were dropped.
 */
export function clampTailBytes(text: string, maxBytes: number): { text: string; truncated: boolean } {
  if (Buffer.byteLength(text) <= maxBytes) return { text, truncated: false }
  const buf = Buffer.from(text, 'utf8')
  let cut = buf.length - maxBytes
  while (cut < buf.length) {
    const byte = buf[cut]
    if (byte === undefined || (byte & 0xc0) !== 0x80) break
    cut += 1
  }
  return { text: buf.subarray(cut).toString('utf8'), truncated: true }
}

/**
 * Validate a `terminal/create` at the process boundary: the agent's tool JSON
 * is a wire input, so field types are checked, not trusted.
 * @param params - the raw create request from the child.
 * @returns the sanitized spawn inputs: argv, cwd, env entries, output byte limit.
 */
export function validatedCreate(params: CreateTerminalRequest): {
  argv: readonly string[]
  cwd: string
  env: Record<string, string>
  outputByteLimit: number
} {
  if (typeof params.command !== 'string' || params.command === '') {
    throw new Error('terminal/create: command must be a non-empty string')
  }
  if (params.args !== undefined && (!Array.isArray(params.args) || params.args.some(a => typeof a !== 'string'))) {
    throw new Error('terminal/create: args must be an array of strings')
  }
  const env: Record<string, string> = {}
  for (const entry of (params.env ?? []) as EnvVariable[]) {
    if (typeof entry?.name !== 'string' || typeof entry?.value !== 'string') {
      throw new Error('terminal/create: env entries must be { name, value } strings')
    }
    env[entry.name] = entry.value
  }
  const limit = params.outputByteLimit
  if (limit !== undefined && limit !== null && (!Number.isInteger(limit) || limit <= 0)) {
    throw new Error('terminal/create: outputByteLimit must be a positive integer')
  }
  return {
    argv: [params.command, ...(params.args ?? [])],
    cwd: typeof params.cwd === 'string' && params.cwd !== '' ? params.cwd : '',
    env,
    outputByteLimit: limit ?? DEFAULT_TERMINAL_OUTPUT_BYTE_LIMIT,
  }
}

/**
 * One run's terminals, keyed by the opaque ids handed to the child. Lives for
 * the run's lifetime only; {@link releaseAll} is wired into the run's disposal.
 */
export class AcpTerminalPool {
  private readonly terminals = new Map<string, ManagedTerminal>()

  constructor(private readonly options: AcpTerminalPoolOptions) {}

  /**
   * Spawn one terminal command as a tree-scoped subprocess with bounded
   * per-stream collection.
   * @param params - the raw `terminal/create` request from the child.
   * @returns the created terminal's id.
   */
  create(params: CreateTerminalRequest): string {
    const { argv, cwd, env, outputByteLimit } = validatedCreate(params)
    const handle = this.options.spawn({
      argv,
      cwd: cwd === '' ? this.options.defaultCwd : cwd,
      stdio: { stdin: 'ignore', stdout: { maxBytes: outputByteLimit }, stderr: { maxBytes: outputByteLimit } },
      graceMs: this.options.graceMs,
      env,
    })
    const managed: ManagedTerminal = {
      handle,
      outputByteLimit,
      settled: null,
      spawnFailure: null,
      outcome: handle.done.then(
        (outcome) => { managed.settled = outcome; return outcome },
        (error: unknown) => {
          // A spawn-level failure is still a terminal with output (the error)
          // and an exit status, matching real-shell not-found semantics.
          const outcome = { exitCode: 127, signal: null }
          managed.spawnFailure = messageOf(error)
          managed.settled = outcome
          return outcome
        },
      ),
    }
    const id = randomUUID()
    this.terminals.set(id, managed)
    return id
  }

  /**
   * The retained snapshot for one terminal: the collected stdout tail followed
   * by the collected stderr tail (snapshot order, not interleaving), clamped
   * to the terminal's byte limit.
   * @param id - the terminal id from `terminal/create`.
   * @returns the merged snapshot, truncation fact, and exit status when settled.
   */
  output(id: string): TerminalOutputResponse {
    const managed = this.get(id)
    if (managed.spawnFailure !== null) {
      return { output: managed.spawnFailure, truncated: false, exitStatus: managed.settled }
    }
    const stdout = managed.handle.collected.stdout?.readFrom(0)
    const stderr = managed.handle.collected.stderr?.readFrom(0)
    const merged = `${stdout?.text ?? ''}${stderr?.text ?? ''}`
    const clamped = clampTailBytes(merged, managed.outputByteLimit)
    return {
      output: clamped.text,
      truncated: clamped.truncated || (stdout?.lossy ?? false) || (stderr?.lossy ?? false),
      exitStatus: managed.settled,
    }
  }

  /**
   * Wait for one terminal's command to exit (bounded by the seam's own
   * escalation only if killed; a live command waits as long as it runs).
   * @param id - the terminal id from `terminal/create`.
   * @returns the exit code and terminating signal.
   */
  async waitForExit(id: string): Promise<WaitForTerminalExitResponse> {
    return await this.get(id).outcome
  }

  /**
   * Kill one terminal's command tree without releasing the id.
   * @param id - the terminal id from `terminal/create`.
   */
  kill(id: string): void {
    this.get(id).handle.terminate()
  }

  /**
   * Kill and forget one terminal; the id becomes invalid for every method.
   * @param id - the terminal id from `terminal/create`.
   */
  release(id: string): void {
    const managed = this.get(id)
    managed.handle.terminate()
    this.terminals.delete(id)
  }

  /**
   * Terminate every live terminal tree and await the seam's bounded exit
   * proof for each; called from the run's disposal.
   */
  async releaseAll(): Promise<void> {
    const entries = [...this.terminals]
    this.terminals.clear()
    await Promise.all(entries.map(([, managed]) => {
      managed.handle.terminate()
      return managed.handle.waitForExit()
    }))
  }

  /**
   * @param id - a terminal id from the child.
   * @returns the managed terminal.
   * @throws RequestError `resource not found` for an unknown or released id.
   */
  private get(id: string): ManagedTerminal {
    const managed = this.terminals.get(id)
    if (managed === undefined) throw RequestError.resourceNotFound(id)
    return managed
  }

  /**
   * The `Client` method set for this pool, spread into the run's ACP client.
   * @returns implementations for the five `terminal/*` reverse-RPC methods.
   */
  clientMethods(): TerminalClientMethods {
    // All five are async arrows: a synchronous throw inside (validation,
    // unknown id) must surface as a rejected promise, per the Client contract.
    return {
      createTerminal: async (params: CreateTerminalRequest): Promise<CreateTerminalResponse> =>
        ({ terminalId: this.create(params) }),
      terminalOutput: async (params: TerminalOutputRequest): Promise<TerminalOutputResponse> =>
        this.output(params.terminalId),
      waitForTerminalExit: async (params: WaitForTerminalExitRequest): Promise<WaitForTerminalExitResponse> =>
        await this.waitForExit(params.terminalId),
      killTerminal: async (params: KillTerminalRequest): Promise<KillTerminalResponse> => {
        this.kill(params.terminalId)
        return {}
      },
      releaseTerminal: async (params: ReleaseTerminalRequest): Promise<ReleaseTerminalResponse> => {
        this.release(params.terminalId)
        return {}
      },
    }
  }
}
