# Agent Note：省略的绑定参数记录即空对象

Status: implemented

[English](2026-08-19-binding-omitted-args-empty-object.md) | 中文

## 问题

run_code 程序的每次工具调用经绑定包装器跨越 worker 边界，先做无损 JSON 快照再投递。省略全部可选参数的调用——`tools.job_list()`、`tools.get_goal()`——传入的记录是 `undefined`，而 `undefined` 的快照仍是 `undefined`。包装器将其读作「不可表示」并在请求到达宿主前即以 `binding arguments must be lossless JSON` 拒绝：全可选 schema 上的零参调用无法表达，且报错文本指向 JSON 损耗而非省略本身。

## 决策

绑定包装器先归一参数记录：`args === undefined ? {} : args`。空对象是「未提供任何参数」的无损 JSON 形态，可快照、可过线、以 `{}` 到达宿主函数——与全可选 schema（无必填键的 `Record<string, JsonValue>`）一一对应。归一后，快照的 `undefined` 重新只意味着一件事：JSON 无法表示的值（函数、循环、Symbol、`-0`、非有限数），仍以同一消息拒绝。

## 备选方案

- **在每个零参调用点修**（`tools.job_list({})`）。把包装器工件推给每个调用全可选工具的程序；schema 明明说什么都不必填，模型没有理由知道该记录在语法上必传。
- **让快照把 undefined 编码为 null。** 在线上混淆「缺席」与 JSON 值 `null`；区分 `args.x === undefined` 与 `args.x === null` 的宿主函数会看到错误的那个。

## 影响

全可选 schema 上的零参调用自此在 run_code 程序中可用；含必填字段的 schema 不受影响（缺失仍以精确的 missing-property 消息在宿主侧失败）。包装器级契约「快照 `undefined` 即不可表示」恢复单一含义。

## 测试

`packages/code-runtime` 套件（117 测试）：新 bootstrap 用例钉住省略记录解析成功且投递解码后的空对象，既有损耗值用例仍拒绝。