/**
 * dsh-git-commit — host 半边：git 状态/提交/推送回环 API。
 * GET  /api/dsh-git-commit/status?cwd=…   → 分支/领先落后/暂存与未暂存增删行数
 * POST /api/dsh-git-commit/commit          → {cwd, message, includeUnstaged}
 * POST /api/dsh-git-commit/push            → {cwd}
 * 全部仅限回环访问；cwd 必须是 git 仓库（git rev-parse 校验）。
 */
import { spawn } from 'node:child_process'

export const inject = ['tools']
export const name = 'dsh-git-commit'

function git(cwd, args, timeoutMs = 30000) {
  return new Promise((resolve) => {
    const p = spawn('git', ['-C', cwd, ...args], { timeout: timeoutMs })
    let out = '', err = ''
    p.stdout.on('data', (d) => { out += d })
    p.stderr.on('data', (d) => { err += d })
    p.on('error', (e) => resolve({ code: -1, out: '', err: String(e) }))
    p.on('close', (code) => resolve({ code, out, err }))
  })
}

async function isRepo(cwd) {
  const r = await git(cwd, ['rev-parse', '--is-inside-work-tree'])
  return r.code === 0 && r.out.trim() === 'true'
}

function loopback(req) {
  const a = req.socket.remoteAddress
  return a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1'
}

function parseNumstat(text) {
  let add = 0, del = 0, n = 0
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    const [a, d] = line.split('\t')
    const ai = a === '-' ? 0 : parseInt(a, 10)
    const di = d === '-' ? 0 : parseInt(d, 10)
    if (Number.isFinite(ai)) add += ai
    if (Number.isFinite(di)) del += di
    n += 1
  }
  return { n, add, del }
}

async function statusOf(cwd) {
  const st = await git(cwd, ['status', '--porcelain=v1', '-b'])
  if (st.code !== 0) throw new Error(st.err.trim() || 'git status failed')
  const lines = st.out.split('\n')
  let branch = '', ahead = 0, behind = 0, untracked = 0, stagedN = 0, unstagedN = 0
  for (const line of lines) {
    if (line.startsWith('##')) {
      // 惰性组必须以 \.\.\. 或行尾收束：无锚点+可选尾组时 (.+?) 匹配到首字母
      // 即成功——branch 变成 "z"（"zoubo" 的首字母），提交面板因此插入幽灵分支
      const m = line.match(/^## (.+?)(?:\.\.\.|$)/)
      branch = (m ? m[1] : line.slice(3)).replace(/\s.*$/, '')
      const am = line.match(/ahead (\d+)/); if (am) ahead = parseInt(am[1], 10)
      const bm = line.match(/behind (\d+)/); if (bm) behind = parseInt(bm[1], 10)
      continue
    }
    if (!line) continue
    const x = line[0], y = line[1]
    if (x === '?') { untracked += 1; continue }
    if (x !== ' ' && x !== '?') stagedN += 1
    if (y !== ' ' && y !== '?') unstagedN += 1
  }
  const [cached, work] = await Promise.all([
    git(cwd, ['diff', '--cached', '--numstat']),
    git(cwd, ['diff', '--numstat']),
  ])
  const staged = parseNumstat(cached.out)
  const unstaged = parseNumstat(work.out)
  return {
    branch, ahead, behind, untracked,
    staged: { n: stagedN, add: staged.add, del: staged.del },
    unstaged: { n: unstagedN, add: unstaged.add, del: unstaged.del },
    dirty: stagedN + unstagedN + untracked > 0,
  }
}

export function apply(ctx) {
  // 晚挂载：webServer 服务未就绪时静态 inject 会永远等待（无报错 404）
  ctx.inject(['webServer'], (host) => host.effect(() => {
    const send = (res, status, body) => {
      res.writeHead(status, { 'content-type': 'application/json' })
      res.end(JSON.stringify(body))
    }
    const readBody = (req) => new Promise((resolve) => {
      let raw = ''
      req.on('data', (c) => { raw += c })
      req.on('end', () => { try { resolve(JSON.parse(raw)) } catch { resolve(null) } })
    })
    const route = {
      kind: 'exact', path: '/api/dsh-git-commit/status',
      handler: async (req, res) => {
        if (!loopback(req)) return send(res, 403, { ok: false, error: 'loopback only' })
        try {
          const url = new URL(req.url ?? '/', 'http://dsh.internal')
          const cwd = url.searchParams.get('cwd') ?? ''
          if (!cwd || !(await isRepo(cwd))) return send(res, 400, { ok: false, error: 'not a git repo: ' + cwd })
          return send(res, 200, { ok: true, status: await statusOf(cwd) })
        } catch (e) { return send(res, 500, { ok: false, error: String(e.message || e) }) }
      },
    }
    const branchesRoute = {
      kind: 'exact', path: '/api/dsh-git-commit/branches',
      handler: async (req, res) => {
        if (!loopback(req)) return send(res, 403, { ok: false, error: 'loopback only' })
        try {
          const url = new URL(req.url ?? '/', 'http://dsh.internal')
          const cwd = url.searchParams.get('cwd') ?? ''
          if (!cwd || !(await isRepo(cwd))) return send(res, 400, { ok: false, error: 'not a git repo' })
          const r = await git(cwd, ['for-each-ref', '--format=%(refname:short)', 'refs/heads'])
          if (r.code !== 0) return send(res, 500, { ok: false, error: r.err.trim() || 'git for-each-ref failed' })
          const cur = await git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD'])
          const branches = r.out.split('\n').map((b) => b.trim()).filter(Boolean)
          return send(res, 200, { ok: true, current: cur.out.trim(), branches })
        } catch (e) { return send(res, 500, { ok: false, error: String(e.message || e) }) }
      },
    }
    const commitRoute = {
      kind: 'exact', path: '/api/dsh-git-commit/commit',
      handler: async (req, res) => {
        if (!loopback(req)) return send(res, 403, { ok: false, error: 'loopback only' })
        if (req.method !== 'POST') return send(res, 405, { ok: false })
        const body = await readBody(req)
        if (!body || typeof body.cwd !== 'string') return send(res, 400, { ok: false, error: 'invalid json' })
        try {
          if (!(await isRepo(body.cwd))) return send(res, 400, { ok: false, error: 'not a git repo' })
          let switched = ''
          if (typeof body.targetBranch === 'string' && body.targetBranch !== '') {
            const cur = await git(body.cwd, ['rev-parse', '--abbrev-ref', 'HEAD'])
            if (cur.out.trim() !== body.targetBranch) {
              const co = await git(body.cwd, ['checkout', '-q', body.targetBranch])
              if (co.code !== 0) return send(res, 500, { ok: false, error: '切换分支失败: ' + (co.err.trim() || body.targetBranch) })
              switched = '已切换到 ' + body.targetBranch + ' · '
            }
          }
          if (body.includeUnstaged) {
            const a = await git(body.cwd, ['add', '-A'])
            if (a.code !== 0) return send(res, 500, { ok: false, error: a.err.trim() || 'git add failed' })
          }
          const st = await git(body.cwd, ['status', '--porcelain'])
          if (st.out.trim() === '') return send(res, 400, { ok: false, error: '没有可提交的更改' })
          let msg = String(body.message ?? '').trim()
          if (msg === '') {
            const s = await statusOf(body.cwd)
            const total = s.staged.n + s.untracked
            msg = `auto: +${s.staged.add}/-${s.staged.del} · ${total} 个文件 · ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`
          }
          const c = await git(body.cwd, ['commit', '-m', msg])
          if (c.code !== 0) return send(res, 500, { ok: false, error: c.err.trim() || 'git commit failed' })
          const h = await git(body.cwd, ['rev-parse', '--short', 'HEAD'])
          return send(res, 200, { ok: true, commit: h.out.trim(), message: msg, switched })
        } catch (e) { return send(res, 500, { ok: false, error: String(e.message || e) }) }
      },
    }
    const pushRoute = {
      kind: 'exact', path: '/api/dsh-git-commit/push',
      handler: async (req, res) => {
        if (!loopback(req)) return send(res, 403, { ok: false, error: 'loopback only' })
        if (req.method !== 'POST') return send(res, 405, { ok: false })
        const body = await readBody(req)
        if (!body || typeof body.cwd !== 'string') return send(res, 400, { ok: false, error: 'invalid json' })
        try {
          if (!(await isRepo(body.cwd))) return send(res, 400, { ok: false, error: 'not a git repo' })
          const p = await git(body.cwd, ['push'], 120000)
          if (p.code !== 0) return send(res, 500, { ok: false, error: (p.err || p.out).trim().slice(0, 300) || 'git push failed' })
          return send(res, 200, { ok: true, output: (p.out + p.err).trim().slice(0, 300) })
        } catch (e) { return send(res, 500, { ok: false, error: String(e.message || e) }) }
      },
    }
    const disposers = [route, branchesRoute, commitRoute, pushRoute].map((r) => host.webServer.register(r))
    return () => { for (const d of disposers) d() }
  }, 'dsh-git-commit: routes'), 'dsh-git-commit: webServer')
}
