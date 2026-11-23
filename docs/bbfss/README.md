# bbfss/t3code 定制维护说明

本仓库是基于 [`pingdotgg/t3code`](https://github.com/pingdotgg/t3code) 的个人长期定制 Fork，定位为独立的分支发行项目（不向上游提 PR）。

## 分支约定

| 分支 | 作用 | 规则 |
| --- | --- | --- |
| `main` | 官方 `pingdotgg/t3code:main` 的纯净镜像 | **严禁直接提交任何 bbfss 改动**，只做 fast-forward 同步 |
| `bbfss` | bbfss 长期定制主分支 | 承载所有已合入的 bbfss 定制 |
| `feat/bbfss-*` | 单个功能的开发分支 | 从 `bbfss` 切出，完成后在 `bbfss/t3code` **内部**向 `bbfss` 创建 PR |

## 低冲突隔离架构

上游迭代速度极快，因此所有 bbfss 新增代码均隔离在独立目录中，只在上游源码保留极薄挂载点：

- **独立代码目录**：`apps/web/src/bbfss/`
  - `settings.ts`：独立客户端配置存储（`localStorage` 键 `t3code.bbfss.settings.v1`），零侵入 `packages/contracts/src/settings.ts` 与服务端协议。
  - `quickReplyStore.ts`：已完成会话队列状态与上下文提取逻辑。
  - `notificationBridge.ts`：给 `ThreadNotificationCoordinator.tsx` 用的最小桥接层。
  - `QuickReplyHost.tsx`：右上角会话完成快捷续聊浮窗（带前文预览、历史展开、直接发送、5 秒无交互自动关闭与 1/N 队列切换）。
  - `BbfssSettingsPanel.tsx`：设置 → **bbfss 改动** 页面。
- **上游极薄挂载点**：
  1. `apps/web/src/components/ThreadNotificationCoordinator.tsx`（拦截前台完成通知 + 生命周期同步）
  2. `apps/web/src/routes/__root.tsx`（挂载 `<BbfssQuickReplyHost />`）
  3. `apps/web/src/routes/_chat.settings.bbfss.tsx` + `routeTree.gen.ts`（注册 `/settings/bbfss` 路由）
  4. `apps/web/src/components/settings/{settingsSearch.ts,SettingsSidebarNav.tsx,SettingsScopeSentence.tsx}`（注册侧栏项、搜索项与设备级作用域）

## 同步上游最新更新

```bash
# 本地拉取 pingdotgg/t3code:main 并合入 bbfss 分支
node scripts/bbfss-sync.mjs

# 同步并推送 origin/main 与 origin/bbfss
node scripts/bbfss-sync.mjs --push

# 如需把当前全部 bbfss 改动导出为独立补丁包（bbfss-patches/）
node scripts/bbfss-sync.mjs --export-patch
```

如果合并时仅 `apps/web/src/routeTree.gen.ts` 冲突，采用上游版本后运行一次前端路由生成即可自动恢复。
