# Scheduler 同步日志

用于记录 `source/dsh-automation` 能力同步到 `packages/dsh-tauri-panel-scheduler` 的进度，避免后续重复对比或遗漏实现。

## 同步基线

- 参考项目：[`MichengAI/dsh-automation`](https://github.com/MichengAI/dsh-automation)
- 本次对比版本：`v0.1.32`
- 本次对比提交：`f1bc91a`
- Panel 当前版本：`0.6.7`
- 记录更新时间：2026-09-07

## 已同步

### P0

- [x] 移除 scheduler executor 固定 `UNATTENDED_TOOL_ALLOWLIST`。
- [x] 不再禁止 `bash` / `pwsh` 的 `run_in_background`。
- [x] 无人值守执行只应用 Host permission preset，并调用 `setApprovalPolicy('never')`。
- [x] 保留执行超时、取消与取消收敛逻辑。
- [x] 支持 `once`、`hourly`、`daily`、`interval`、`workdays`、`weekly`、`monthly`、`custom`。
- [x] `interval` / `custom` 支持固定 `anchor`，下一次执行按 anchor + N × step 计算。
- [x] 恢复逻辑将进程中断的 `running` 记录标记为 `interrupted`；`queued` 不作为已开始执行处理。

### P1

- [x] 执行状态增加 `interrupted`，同步中英文显示。
- [x] 任务卡片菜单增加显式 `Edit`。
- [x] 任务计划描述支持单次、每小时、每月、自定义周期。
- [x] 每月计划支持日期 `1–31` 与时间。
- [x] 自定义计划支持间隔天数 `1–366` 与时间。
- [x] 一次性计划使用 `datetime-local`，并在计划行内填充剩余宽度。
- [x] 恢复原有工具栏布局，不增加时间筛选 Select。

### P2/P3

- [x] 页面从隐藏状态恢复可见时刷新。
- [x] 页面重新获得焦点时刷新。
- [x] 保留已有删除确认、workspace 校验、卡片点击编辑、超时取消与并发上限。

## 明确未同步

以下能力依赖桌面端当前没有提供的 Archive Manager 或 session-folder 能力，本轮不实施：

- Web 专用 session folders。
- whole-group archive。
- host sync bridge。
- Archive Manager UI。

## 验证记录

最近一次本地验证：

```text
pnpm run test -- --run       # 17 test files, 106 tests passed
pnpm --filter dsh-tauri-panel-scheduler typecheck
pnpm --filter dsh-tauri-panel-scheduler build
pnpm exec eslint packages/dsh-tauri-panel-scheduler/src --fix
```

Lint 当前只有既有 warning，无新增 error。

PR #412 的 Frontend、macOS、Ubuntu、Windows CI 均已通过。

## 后续同步流程

1. 获取参考仓库最新 tag 与提交：记录版本号和 commit SHA。
2. 对照参考项目的 `CHANGELOG.md`，按 P0 → P1 → P2/P3 分类新增能力。
3. 先更新本文件的“同步基线”和“待同步”项，再修改 host/client 实现。
4. 同步协议时同时检查：
   - `src/shared/constants.ts`
   - `src/host/types/index.ts`
   - `src/client/types/scheduler.ts`
   - `src/host/service/schedule.ts`
   - `src/host/service/executor.ts`
   - `src/client/components/task-create-dialog.tsx`
   - `src/client/locales/index.ts`
5. 完成后运行 lint、typecheck、test、build，并在本文件补充验证结果。
6. 将已完成项从“待同步”移动到“已同步”，保留未实施项及原因。

## 待同步项

当前没有已确认、且适用于桌面端 scheduler panel 的未同步 P0–P3 项。下一次参考仓库更新时，从新的 changelog 重新评估。
