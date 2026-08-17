# personal-plugins — zoubo 分支专属

官方 master 之上仅追加的个人插件，独立于 pnpm workspace（不参与仓库构建链）。
2026-08-17 从 `~/.dsh/profiles/web/plugins/dsh-local/` 抢救归档（当日 ~/.dsh 曾被整体拖入废纸篓）。

## dsh-bocha-status — 博查用量显示

状态栏显示 `博查 已用 N/M 条`：克隆 QQ98 皮肤最后一个状态栏单元格，轮询同源
host 路由 `/dsh-local/bocha-balance`（官方余额 + 本机 web_search 计数，key 不出宿主）。
计数文件 `~/.dsh/bocha-usage.json` 由 bocha 搜索 provider（见 archive/bocha.mjs）写入；
没有 provider 时计数显示 0，余额仍正常。

依赖：`@linxin666/dsh-client-ui-skin-qq98`（锚点单元格）。

## dsh-desktop-chrome — 复古标题栏 + 用量小组件（健康圆点+3圆环）

1. QQ98 复古标题栏可拖动，min/max/close 接桌面壳 preload bridge（`window.dshDesktop`，
   纯浏览器环境自动降级为装饰按钮）。
2. 用量小组件：把 dsh-usage-stats 的 footer badge 重构为仅当前模型的两行仪表盘——
   会话窗口圆环、缓存命中圆环、重置时间（或余额）、今日 tokens（K/M/B）。

依赖：`@linxin666/dsh-client-ui-skin-qq98`、`dsh-usage-stats`（github:Ychris12138/dsh-usage-stats#v0.1.2）。

## 安装（官方 CLI 即可，无需本仓库构建）

```sh
dsh plugin --profile web add <本仓库路径>/personal-plugins/dsh-bocha-status
dsh plugin --profile web add <本仓库路径>/personal-plugins/dsh-desktop-chrome
```

`dsh plugin add` 会自动装上声明的依赖并挂载 bundle 层。

## archive/ — 其余本地插件与配置快照（未声明为独立包）

- `bocha.mjs` — 博查搜索 provider（web capability 的 searchProvider，写用量计数）
- `temperature.mjs` — 温度参数插件
- `core-hygiene.mjs` — 调度器 Symbol.for 卫生哨兵（配合 ~/.dsh/check-scheduler-symbol.py）
- `profile-cordis.patch.yml-20260817` — web profile 补丁层快照（argo MCP、bocha provider、
  aionui-panel 禁用等），重建 profile 时可参考

## 依赖说明（market 遮蔽告警辨析）

dsh-crawler / dsh-context-ring 的 node_modules/@deepseek-ai/* 是指向
~/.dsh/profiles/node_modules（宿主共享层）的 symlink，版本与宿主恒等
（同源同版本），运行时不存在重复加载；package.json 已将全部宿主包声明为
peerDependencies（use-host 语义）。市场清单扫描若按 node_modules 存在即
告警的规则判定，对本目录为误报。
