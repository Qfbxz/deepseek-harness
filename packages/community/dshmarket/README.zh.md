# dsh-market

[English](README.md) | 中文

[![npm](https://img.shields.io/npm/v/dshmarket)](https://www.npmjs.com/package/dshmarket)
[![stars](https://img.shields.io/github/stars/dsh-market/dsh-market?style=flat)](https://github.com/dsh-market/dsh-market)

装在 DeepSeek Harness 里的插件市场。打开设置 → **插件市场** → 逛一逛，点一下，装好。

![dsh-market](assets/demo-zh.png)

## 安装

```sh
dsh plugin --profile web add dshmarket
```

重启 `dsh web`，打开 **设置 → 插件市场**。

## 你会得到

- **逛与搜**——完整社区目录（230+ 插件，每天在涨），分类筛选、star 数、最热/最新排序，中英描述跟随界面语言
- **一键安装**——确认来源，实时进度；多数插件刷新页面即可用，无需重启
- **更新**——逐插件检测（npm 版本或锁定 commit 对比 HEAD），一键更新；市场自己也走同一通道升级
- **卸载**——两步确认防误触；本次会话装的插件即点即卸
- **零术语**——缺组件（pnpm）时市场自己发现、一键自动装好，全程不见命令行
- **导出日志**——一键生成脱敏纯文本日志方便反馈（home 路径与密钥形状已打码；任何数据都不会被上传）

## 速度

只要插件发布了 npm 包（registry 会校验其 repository 指回同一仓库,防冒名）,安装即走 npm tarball 而非整仓 GitHub 下载——通常秒级;仅 GitHub 分发的插件取决于你到 GitHub 的网络。

## 安全

- 只允许安装 [awesome-dsh-plugin](https://awesome-dsh-plugin.com) 精选列表内的来源,其它一律拒绝
- 构建脚本默认禁止执行（pnpm ≥10）,放行与否由你按包显式决定
- 终端/命令行类插件装进网页版前会被明确提醒
- 安装接口只接受同源 POST;市场不会向任何地方上报数据
- 收录 ≠ 背书:插件是第三方代码,请只安装你信任的来源

## 数据源

实时来自 [awesome-dsh-plugin.com/plugins.json](https://awesome-dsh-plugin.com/plugins.json)——精选条目、npm 映射、star 数由 CI 每日刷新——内置快照做离线兜底。

## 许可

MIT · [dshmarket.com](https://dshmarket.com)
