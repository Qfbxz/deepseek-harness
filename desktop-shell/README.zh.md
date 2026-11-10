# dsh-desktop-shell

[English](README.md) | 中文

面向官方 DeepSeek Harness Web Host 的极简 Electron 外壳——作为 fork 版 `@deepseek-ai/dsh-desktop`（`apps/desktop/`，673 MB，内嵌运行时 + 社区插件）的"干净"替代而构建。

## 它做什么

- 拉起 `dsh --profile web`（PATH 查找），解析规范的就绪行 `dsh web: http://127.0.0.1:<port>` 得到回环 URL。
- 当 3080 端口（dsh 默认端口）已有 dsh web 在运行时直接附着，而不是再拉起一份。
- 把该 URL 装入沙箱化的 BrowserWindow，配一条经校验的 IPC 通道支撑 `window.dshDesktop.windowCommand("minimize"|"maximize"|"close")`——与 `../personal-plugins/` 里的 `desktop-chrome`（QQ98 复古标题栏）消费的是同一种桥接形态。
- 退出时杀掉拉起的宿主（非 macOS）。在 macOS 上关闭窗口后应用与宿主保持驻留，Dock 图标可重新打开窗口。

总计约 150 行 JavaScript。无内嵌运行时，不打包社区插件——官方 profile 通过 `dshmarket` 管理它们。

## 要求

- PATH 上有 `@deepseek-ai/dsh`（官方 npm CLI；`npm i -g @deepseek-ai/dsh@latest`）。
- Node ≥ 22.19（与 harness 的 engines 区间一致）。

## 运行

```sh
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ npm install
npm start
```

`ELECTRON_MIRROR` 用于避开本网络下 GitHub 二进制下载卡死。首次安装经镜像下载 Electron（约 150 MB）。打包时，下载好的 Electron zip 已通过 package.json 的 `build.electronDownload` 提供；`npm run dist:mac:cn` 还会镜像 electron-builder 的辅助二进制（对 GitHub 超时的那个 `got` 请求）。

## 打包（mac-arm64，ad-hoc）

```sh
npm run package:mac
```

产出 `dist/mac-arm64/DeepSeek Harness Shell.app`。ad-hoc 签名（`identity: null`），无公证——仅限本地使用。

### macOS Gatekeeper 说明（首次启动）

本应用为 ad-hoc 签名（无 Developer ID、无公证）。在较新的 macOS 上，Electron 31.x 或更早的 framework 若其原始 GitHub 公证票据已被 Apple 撤销，会被 XProtect 标记为"malware"并从 `/Applications` 自动删除——`spctl` 报告 "notarization indicates this code has been revoked"。本构建固定使用 **Electron 43.4.0**，其 GitHub 签名的 framework 票据仍然新鲜，因此 `spctl` 只报告常规的 "rejected" 判定（Gatekeeper 对 ad-hoc 未知名开发者的标准拒绝）。`npm run package:mac` 自动执行构建后的 `codesign --force --deep --sign -` 之后，bundle 即可采用标准的首次启动绕过流程。

恢复并解锁：

```sh
cp -R dist/mac-arm64/DeepSeek\ Harness\ Shell.app /Applications/
```

然后在 Finder 中：**右键（Control-点击）该应用 → 打开 → 在对话框中确认"打开"**。这条用户确认路径会登记例外；后续启动即可正常打开。另一种方式：系统设置 → 隐私与安全性 → 滚动到底部 → "仍要打开"。

永久修复需要 Apple Developer ID 证书与公证（`afterSign` + `notarytool`）；此处未配置。

如果日后把 Electron 固定回旧版本线而 XProtect 再次标记该构建，回退方案是直接从源码运行——`npm start` 直接启动 `node_modules/electron/dist/` 里的 Electron 二进制，绕过 `/Applications` 的 Gatekeeper/XProtect 扫描。

## 插件兼容性

- **`personal-plugins/dsh-desktop-chrome`**——最小/最大/关闭按钮使用 `window.dshDesktop.windowCommand`。无需改动即可工作；插件的 `if (bridge !== undefined)` 守卫使它在桥缺失时（例如普通浏览器标签页中）退化为装饰按钮。
- **`personal-plugins/dsh-bocha-status`**——宿主路由 `/dsh-local/bocha-balance` 由 dsh web 进程自身提供，无需外壳帮助即可工作。
