# pawl — DSH 通用爬虫插件

通用网页爬取插件（源码即本目录），挂进 DeepSeek Harness 后为 agent 提供 6 个工具。

## 引擎

| engine | 实现 | 适用 |
|---|---|---|
| http | Python stdlib（零依赖） | 静态页、API，最快 |
| crawl4ai | crawl4ai venv（~/.dsh/venvs/scrape） | LLM 友好 Markdown、结构化提取 |
| browser | patchright 反检测 Chromium + 持久 profile | JS 渲染、CF 防护站（先 unlock）、登录态复用 |

auto 策略：默认 browser（最通用）；http 够用的场景显式指定更快。

## Agent 工具

| 工具 | 用途 | 关键自由度 |
|---|---|---|
| crawler_config | get/set 默认值；enabled:false 一键全关 | engine/profileDir/outdir/headers/minDelayMs/defaults |
| crawler_fetch | 单页抓取 | mode(text/markdown/html/links)、selectors 映射、extractJs 任意 JS、meta、screenshot、scroll、waitForSelector |
| crawler_batch | 批量（断点续爬） | urls/urlsFile → outFile JSONL、resume、limit、并发与限速 |
| crawler_site | 整站 BFS | maxPages/maxDepth、include/exclude 正则、sameOrigin |
| crawler_unlock | 人工解锁 CF/登录（弹真实窗口，蜂鸣提醒） | url、loginHint、profileDir 持久化 |
| crawler_status | 健康检查 | venv/引擎/profile/输出文件 |

## 安装（挂载）

1. 把 cordis.patch.yml 的条目追加到 ~/.dsh/cordis.patch.yml
2. 重启 dsh web（host 侧插件需重启生效）
3. 可选 venv（启用 crawl4ai/browser 引擎）：
   uv venv --python 3.12 ~/.dsh/venvs/scrape
   uv pip install --python ~/.dsh/venvs/scrape/bin/python crawl4ai patchright
   ~/.dsh/venvs/scrape/bin/patchright install chromium

## 开关

- 会话级：crawler_config set {"enabled":false}
- 启动级：~/.dsh/cordis.patch.yml 里 config.enabled: false
- 卸载：删掉 patch 条目 + 重启

## 数据位置

- 运行时配置 ~/.dsh/crawler-config.json
- 浏览器 profile ~/.dsh/crawler-profiles/default（CF clearance/登录态）
- 存储文件夹（GUI「存储文件夹」，默认 ~/.dsh/crawler-out）：
  - fetch：saveTo="auto" → pages/<域名>.txt；saveTo="xxx.md"（相对）→ 存储文件夹内；绝对路径原样
  - batch：outFile 默认 batch.jsonl（相对名在存储文件夹内解析）
  - site：saveMode jsonl（默认，<站点>-site.jsonl 断点续爬）/ files（每页一个 .md/.txt/.html 于 pages/）/ both
  - 所有模式的相对路径统一在存储文件夹内解析，响应携带 savedTo/outFile/file 回执


## 依赖桥接（重要）

index.mjs 裸导入 @deepseek-ai/dsh-tools；pawl 物理路径不在 profile node_modules 下，
Node ESM 解析不到，所以 node_modules/@deepseek-ai/dsh-tools 是指向
～/.dsh/profiles/node_modules/@deepseek-ai/dsh-tools 的 symlink（换机重建：
  mkdir -p node_modules/@deepseek-ai && ln -s ~/.dsh/profiles/node_modules/@deepseek-ai/dsh-tools node_modules/@deepseek-ai/dsh-tools）。

## 测试

  node test/load-test.mjs   # mock cordis ctx：6 工具注册 + 开关守卫 + http 引擎实抓

## runner.py 协议

stdin: 一条 JSON 命令（mode + 参数 + config）→ stdout: 一条 JSON 结果。
独立于插件可单测：
  echo '{"mode":"fetch","url":"https://example.com","config":{}}' | python3 runner.py
