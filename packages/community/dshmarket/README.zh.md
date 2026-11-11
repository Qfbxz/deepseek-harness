# @deepseek-ai/dsh-market

[English](README.md) | 中文

Web profile 的插件市场：宿主半边把 `/dsh-market/*` HTTP 路由（`registry`、`installed`、`status`、`logs`、`updates`、`update`、`setup-pnpm`、`uninstall`、`install`）挂到 `ctx.webServer` 上，`dsh.client` 下声明的浏览器半边据此渲染 Settings → Plugin Market 卡片。

目录来自人工筛选的 awesome-dsh-plugin 注册表——优先实时拉取，内存缓存一小时，离线时回落到打包的 `data/registry-snapshot.json` 快照。`install` 只接受同源 POST，并为出现在筛选注册表中的来源执行 shell 命令；已安装插件经热目录挂载，页面刷新后生效。`update` 与 `uninstall` 施加同样的筛选来源限制，`setup-pnpm` 在组件缺失时提供一键 pnpm 安装，`logs` 导出脱敏的纯文本安装日志（home 路径与凭据形状已打码）。

## 模型体验

无：市场只挂载面向浏览器的 HTTP 路由与 UI 卡片；没有 prompt、工具 schema 或模型可见的注册经过它。

#### KV Cache 影响

无；市场既不组装也不发送 provider 请求。

## 已知限制与暂缓事项

- **安装会执行 shell 命令**——安全性依赖同源 POST 检查加筛选注册表来源白名单；市场源上被攻破的浏览器会话可以把任何筛选过的插件装进运行中的 web profile。
- **市场卡片从不进入模型上下文**——插件元数据、安装进度与导出日志都留在浏览器；这里没有任何东西把已安装插件状态上报进会话。
