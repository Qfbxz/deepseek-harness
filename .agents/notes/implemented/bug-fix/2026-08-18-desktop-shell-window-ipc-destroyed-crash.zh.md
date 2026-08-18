# Agent Note：桌面壳的窗口 IPC 经模块级处理器分发并带销毁窗口守卫

Status: implemented

[English](2026-08-18-desktop-shell-window-ipc-destroyed-crash.md) | 中文

## 问题

`dsh-desktop-window` IPC 通道 —— `personal-plugins/dsh-desktop-chrome` QQ98 标题栏按钮的底座 —— 原先注册在每次 `createWindow()` 调用的 `wireWindowCommands(window)` 里。`ipcMain.on` 注册的是进程级监听器，于是每个重开的窗口都会再叠一个监听器，各自闭包捕获自己的 `BrowserWindow`。macOS 上最后一个窗口关闭后壳驻留（无窗口），点 Dock 图标的 `activate` 路径重开窗口 —— 因此第二次注册是常规流程而非边缘情况。重开后第一次点标题栏按钮会经由旧监听器分发，其捕获的窗口早已销毁；触碰已销毁的 `BrowserWindow` 抛出 `TypeError: Object has been destroyed`，在 Electron 主进程中致命，以 Uncaught Exception 对话框呈现并指向 `main.js:188`。

三个相邻缺陷共享同一生命周期盲区：附着探测接受任意 TCP 监听者（3000/5173 上的 Vite/Next 开发服务器导致白屏且真后端不可达）；并发 `activate` 让两个 `acquireUrl()` 竞争拉起两个 `dsh --profile web` 宿主（两轮探测都在任一子进程监听前完成，于是双双拉起，而 `child` 只保留最后一个引用）；宿主自行死亡后残留死的 `child` 引用。

## 决策

IPC 处理器在模块作用域恰好注册一次，目标经 `activeWindow()`（以 `isDestroyed()` 过滤的 `win`）解析，销毁窗口在任何分发路径（含 `second-instance` 与 `activate`）中都不可达。开窗收敛到以 `opening` 标志守卫的 `ensureWindow()`：并发激活并入进行中的尝试，而非再起一次获取-开窗。附着探测发送最小 `HEAD /` 请求并要求返回 `HTTP/` 状态行，且只探测 3080（dsh 默认端口）。macOS 上最后一个窗口关闭后应用与拉起的宿主驻留、`activate` 重开窗口；其他平台最后窗口关闭即退出应用并回收宿主。宿主退出清除 `child` 引用；就绪失败错误携带子进程 stderr 尾部。

## 备选方案

- **在 `webContents` 的 `closed` 解绑每窗口监听器。**可行，但每个开窗点都必须拥有配对逻辑，漏一次就静默复现崩溃。模块级单监听器加访问器直接消灭这一类缺陷而非管理其实例；单窗口壳没有按窗口分发的需求。
- **探测校验 dsh 专属路由。**过度拟合：要求 HTTP 状态行已排除非 HTTP 监听者（数据库、SSH 隧道）—— 白屏的实际来源 —— 同时对 Web 宿主的路由清单保持中立。
- B + `activate` 无法重新获取 URL 时退出应用。**拒绝：驻留语义下瞬时失败应让应用可从 Dock 重试而非退出；首启路径（`whenReady`）保留失败即退出。

## 影响

单监听器无法做按窗口的定制分发 —— 单窗口壳下无关紧要，且 preload 桥接契约不变。对 `HEAD` 不回状态行的 HTTP 服务器视为无宿主、壳自行拉起；dsh web 宿主对 `HEAD /` 回状态行，1.5 秒探测超时兜住任何保持沉默者的等待。macOS 驻留让拉起的宿主在无窗口期间继续运行 —— 这是 Dock 即点即开的代价 —— 显式 Cmd-Q 退出路径会杀掉它。

## 测试

`desktop-shell` 不在 `packages/` vitest 覆盖面内；验证方式为对装配主脚本跑 `node --check`、解包构建出的 `app.asar` 确认交付的处理器与源码一致，以及手动复现崩溃路径：关窗、经 Dock 重开、逐一点击标题栏按钮。修复前重开后首击弹出未捕获异常对话框；修复后按钮作用于存活窗口。
