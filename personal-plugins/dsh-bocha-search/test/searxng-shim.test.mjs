/**
 * searxng-shim TDD — dsh-search-failover 的 searxng 后端契约：
 *   GET {baseURL}/search?q=<query>&format=json  (UA: dsh-search-failover/*)
 *   ← { results: [{ url, title?, content?, publishedDate? }] }
 * 垫片把该契约翻译成博查 API（POST /v1/web-search, Bearer, 计数）。
 * 运行：node --test test/searxng-shim.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { parseSearxngQuery, bochaToSearxng, createShimHandler } from '../lib/searxng-shim.mjs'

// ---------- parseSearxngQuery ----------

test('parseSearxngQuery 提取 q 与 format', () => {
  const r = parseSearxngQuery('http://127.0.0.1:3080/dsh-local/bocha-searxng/search?q=%E6%B7%B1%E5%BA%A6%E5%AD%A6%E4%B9%A0&format=json')
  assert.equal(r.query, '深度学习')
  assert.equal(r.format, 'json')
})

test('parseSearxngQuery 缺 q 返回 null', () => {
  assert.equal(parseSearxngQuery('http://x/search?format=json'), null)
  assert.equal(parseSearxngQuery('http://x/search'), null)
})

test('parseSearxngQuery 容忍缺 format（只认 q）', () => {
  const r = parseSearxngQuery('http://x/search?q=abc')
  assert.equal(r.query, 'abc')
})

// ---------- bochaToSearxng ----------

const BOCHA_OK = {
  code: 200,
  data: {
    webPages: {
      value: [
        { name: '结果一', url: 'https://a.com/1', snippet: '片段一', summary: '摘要一', dateLastCrawled: '2026-08-20T00:00:00Z' },
        { name: '结果二', url: 'https://b.com/2', snippet: '片段二' },
        { name: '重复URL', url: 'https://a.com/1', snippet: '应被去重' },
        { name: '无URL', snippet: '跳过' },
      ],
    },
  },
}

test('bochaToSearxng 映射字段并去重', () => {
  const out = bochaToSearxng(BOCHA_OK)
  assert.equal(out.results.length, 2)
  assert.equal(out.results[0].url, 'https://a.com/1')
  assert.equal(out.results[0].title, '结果一')
  assert.equal(out.results[0].content, '摘要一', 'summary 优先于 snippet')
  assert.equal(out.results[0].publishedDate, '2026-08-20T00:00:00+08:00', 'dateLastCrawled Z→+08:00')
  assert.equal(out.results[1].content, '片段二')
  assert.equal(out.results[1].publishedDate, undefined)
})

test('bochaToSearxng 空结果/异常形态返回空数组', () => {
  assert.deepEqual(bochaToSearxng({ code: 200, data: {} }).results, [])
  assert.deepEqual(bochaToSearxng(null).results, [])
})

// ---------- createShimHandler ----------

function fakeRes() {
  const state = { status: 0, headers: null, body: '' }
  return {
    state,
    writeHead(status, headers) { state.status = status; state.headers = headers },
    end(body) { state.body = body ?? '' },
  }
}

function fakeReq(url) {
  return { method: 'GET', url, headers: { 'user-agent': 'dsh-search-failover/0.3.6' } }
}

const BOCHA_FETCH_OK = async (url, init) => ({
  ok: true,
  status: 200,
  json: async () => BOCHA_OK,
})

test('happy path：翻译请求、映射响应、计数一次', async () => {
  const calls = []
  const usage = []
  const handler = createShimHandler({
    getConfig: async () => ({ apiKey: 'sk-test', baseURL: 'https://api.bochaai.com' }),
    fetchImpl: async (url, init) => { calls.push({ url, init }); return BOCHA_FETCH_OK(url, init) },
    recordUsage: () => { usage.push(1) },
  })
  const res = fakeRes()
  await handler(fakeReq('/dsh-local/bocha-searxng/search?q=%E6%B5%8B%E8%AF%95&format=json'), res)
  assert.equal(res.state.status, 200)
  assert.match(res.state.headers['content-type'], /application\/json/)
  const body = JSON.parse(res.state.body)
  assert.equal(body.results.length, 2)
  assert.equal(body.results[0].title, '结果一')
  // 博查请求形态
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, 'https://api.bochaai.com/v1/web-search')
  assert.equal(calls[0].init.method, 'POST')
  assert.equal(calls[0].init.headers.authorization, 'Bearer sk-test')
  const sent = JSON.parse(calls[0].init.body)
  assert.equal(sent.query, '测试')
  assert.equal(sent.freshness, 'noLimit')
  assert.ok(sent.count >= 1 && sent.count <= 50)
  assert.equal(usage.length, 1, '成功搜索计数一次')
})

test('缺 q → 400', async () => {
  const handler = createShimHandler({ getConfig: async () => ({ apiKey: 'k', baseURL: 'https://x' }), fetchImpl: BOCHA_FETCH_OK, recordUsage: () => {} })
  const res = fakeRes()
  await handler(fakeReq('/dsh-local/bocha-searxng/search?format=json'), res)
  assert.equal(res.state.status, 400)
})

test('无 key → 503 且不计数', async () => {
  const usage = []
  const handler = createShimHandler({ getConfig: async () => ({ apiKey: '', baseURL: 'https://x' }), fetchImpl: BOCHA_FETCH_OK, recordUsage: () => usage.push(1) })
  const res = fakeRes()
  await handler(fakeReq('/dsh-local/bocha-searxng/search?q=a&format=json'), res)
  assert.equal(res.state.status, 503)
  assert.equal(usage.length, 0)
})

test('博查 401 → 垫片回 401（池按 auth 分类）', async () => {
  const handler = createShimHandler({
    getConfig: async () => ({ apiKey: 'bad', baseURL: 'https://x' }),
    fetchImpl: async () => ({ ok: false, status: 401, json: async () => ({ code: 401, msg: 'unauthorized' }) }),
    recordUsage: () => {},
  })
  const res = fakeRes()
  await handler(fakeReq('/dsh-local/bocha-searxng/search?q=a&format=json'), res)
  assert.equal(res.state.status, 401)
})

test('博查 429/额度 → 垫片回 429（池按 quota 熔断 1h）', async () => {
  const handler = createShimHandler({
    getConfig: async () => ({ apiKey: 'k', baseURL: 'https://x' }),
    fetchImpl: async () => ({ ok: false, status: 200, json: async () => ({ code: 429, msg: 'rate limited' }) }),
    recordUsage: () => {},
  })
  const res = fakeRes()
  await handler(fakeReq('/dsh-local/bocha-searxng/search?q=a&format=json'), res)
  assert.equal(res.state.status, 429)
})

test('网络异常 → 502 且不计数', async () => {
  const usage = []
  const handler = createShimHandler({
    getConfig: async () => ({ apiKey: 'k', baseURL: 'https://x' }),
    fetchImpl: async () => { throw new Error('ECONNRESET') },
    recordUsage: () => usage.push(1),
  })
  const res = fakeRes()
  await handler(fakeReq('/dsh-local/bocha-searxng/search?q=a&format=json'), res)
  assert.equal(res.state.status, 502)
  assert.equal(usage.length, 0)
})
