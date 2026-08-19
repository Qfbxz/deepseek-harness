# dsh-experts-roster — 自有专家置顶接入 agency-agents

把 `~/.agents/` 与 `~/.kimi-code/agents/` 下的智能体（领域大师优先）转换为
`@michengai/dsh-agency-agents` 插件的 persona 格式，写入 `~/.dsh/experts/0-masters/`。
分区名 `0-masters` 按字母序排在 `academic` 之前 → 设置页与选择器中自有专家恒置顶。

## 结构

```
~/.dsh/experts/            ← 插件 config.root（cordis.patch.yml 的 agency-agents 条目）
├── 0-masters/             ← 自有 22 位（convert-my-experts.mjs 生成，勿手改）
├── academic/ … testing/   ← 内置 17 分区（sync-builtin-experts.mjs 从插件资产镜像）
└── .builtin-version       ← 已同步的插件版本戳
```

## 升级同步（三层）

1. **启动**：runtime-patches-autorun 依次跑 convert + sync（幂等；版本一致时零拷贝）
2. **运行中**：`~/.dsh/profiles/web/plugins/dsh-local/experts-roster-watch.mjs` 每 60s
   比对插件版本与戳文件，不一致自动重同步（日志 `~/.dsh/experts-roster-watch.log`）
3. **手动**：`node personal-plugins/dsh-experts-roster/sync-builtin-experts.mjs`

插件升级 → 内置名册自动拉最新；自有专家在源目录增删后，下次启动/手动跑 convert 即入册。

## 转换规则

- frontmatter 取 `name`/`description`，补 `descriptionEn`（暂用中文）、`color`（轮换色板）、
  `emoji`（关键词映射）、`vibe`（描述首句）；`model`/`tools` 丢弃（provider 由插件管理）
- 同名去重：`~/.agents` 优先于 `~/.kimi-code/agents`
- 正文原样保留作为子代理系统提示
