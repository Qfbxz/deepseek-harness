#!/usr/bin/env node
// 补丁 34：vision-router localLmStudio 支持 API Token 鉴权（LM Studio 新版
// 默认开启 Token 认证，匿名 /models 与视觉调用均 401）。三处幂等修改：
//   1) Config schema localLmStudio 增加 apiKeyEnv 字段（环境变量名）；
//   2) localLmStudioProvidersOf 透传 apiKeyEnv（原硬编码空串）；
//   3) test-connection 探针 probeModels 增加第三参 apiKeyEnv，带 Bearer 请求
//      （localProbe 与 httpRouteProviders 两处调用同步透传）。
// 用法：replay-vision-router-lmstudio-key.mjs <vision-router/index.js>
import { readFileSync, writeFileSync } from 'node:fs'
const target = process.argv[2]
if (!target) { console.error('usage: replay-vision-router-lmstudio-key.mjs <index.js>'); process.exit(1) }
let s = readFileSync(target, 'utf8')
if (s.includes('/*patch(lmstudio-key)*/')) { console.log('[skip] already patched:', target); process.exit(0) }
let changed = 0
const edit = (oldStr, newStr) => {
  if (s.includes(oldStr)) { s = s.replace(oldStr, newStr); changed++; return true }
  return false
}
// 1) schema
edit(
  "      temperature: z.number().min(0).max(2),\n      top_p: z.number().min(0).max(1),\n    })\n    .default({}),",
  "      temperature: z.number().min(0).max(2),\n      top_p: z.number().min(0).max(1),\n      /*patch(lmstudio-key)*/apiKeyEnv: z.string().default(''),\n    })\n    .default({}),",
)
// 2) provider 透传
edit(
  "      name: 'local-lmstudio',\n      baseURL,\n      model,\n      apiKeyEnv: '',",
  "      name: 'local-lmstudio',\n      baseURL,\n      model,\n      apiKeyEnv: typeof local.apiKeyEnv === 'string' ? local.apiKeyEnv : '',",
)
// 3) 探针带 Key
edit(
  "const probeModels = async (baseURL, expectedModel) => {\n          try {\n            const response = await fetch(`${baseURL.replace(/\\/$/, '')}/models`, {\n              method: 'GET',\n              signal: AbortSignal.timeout(8000),\n            })",
  "const probeModels = async (baseURL, expectedModel, apiKeyEnv) => {\n          try {\n            /*patch(lmstudio-key)*/const token = typeof apiKeyEnv === 'string' && apiKeyEnv !== '' && typeof process !== 'undefined' && process.env ? (process.env[apiKeyEnv] ?? '') : ''\n            const response = await fetch(`${baseURL.replace(/\\/$/, '')}/models`, {\n              method: 'GET',\n              signal: AbortSignal.timeout(8000),\n              ...(token !== '' ? { headers: { authorization: `Bearer ${token}` } } : {}),\n            })",
)
edit("(provider) => probeModels(provider.baseURL, provider.model),", "(provider) => probeModels(provider.baseURL, provider.model, provider.apiKeyEnv),")
edit("if (entry !== undefined) return probeModels(entry.baseURL, entry.model)", "if (entry !== undefined) return probeModels(entry.baseURL, entry.model, entry.apiKeyEnv)")
edit("if (httpFirst !== undefined) return probeModels(httpFirst.baseURL, httpFirst.model)", "if (httpFirst !== undefined) return probeModels(httpFirst.baseURL, httpFirst.model, httpFirst.apiKeyEnv)")
if (changed === 0) { console.error('[fail] no anchor matched — plugin updated?'); process.exit(1) }
writeFileSync(target, s)
console.log(`[ok] lmstudio-key patched (${changed}/6 anchors)`)
