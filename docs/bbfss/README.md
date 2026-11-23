# bbfss/t3code 定制维护说明

本仓库是基于 [`pingdotgg/t3code`](https://github.com/pingdotgg/t3code) 的个人长期定制 Fork，定位为独立的分支发行项目（不向上游提 PR）。

## 分支约定

| 分支 | 作用 | 规则 |
| --- | --- | --- |
| `bbfss` | **仓库默认分支**（长期定制主分支） | 承载所有 bbfss 定制，并自动跟进上游发布 |
| `main` | 官方 `pingdotgg/t3code:main` 的纯净镜像 | **严禁直接提交任何 bbfss 改动**，只做 fast-forward 同步 |
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

## 自动跟随官方更新 + 保留 bbfss 改动（全自动流水线）

仓库配备了两条零侵入上游的独立 GitHub Actions 工作流：

1. **[`.github/workflows/bbfss-sync-upstream.yml`](../../.github/workflows/bbfss-sync-upstream.yml)（自动同步官方更新）**：
   - 每 2 小时自动检查 `pingdotgg/t3code` 最新已发布的官方 Release（默认跟随 `nightly` 通道，也可在 Actions 面板手动触发选择 `source=main` 立即同步最新主干或 `track=stable` 同步正式版）。
   - 自动将 `bbfss/t3code:main` 快进同步到上游最新 `main`，并将官方新版本合并进 `bbfss` 分支（若仅 `routeTree.gen.ts` 冲突则自动重新生成路由树自愈；若极少数情况下极薄挂载点发生冲突，则自动创建 `bbfss:sync-conflict` Issue 提醒且绝不丢失或覆盖已有改动）。
   - 一旦合并出新提交，直接通过 `workflow_call` 串联触发打包发布工作流，无需配置任何额外 PAT / Secret。
2. **[`.github/workflows/bbfss-release.yml`](../../.github/workflows/bbfss-release.yml)（多平台自动打包与更新源发布）**：
   - 直接复用上游 [`release-desktop.yml`](../../.github/workflows/release-desktop.yml)（**不修改任何上游 workflow 文件**），在免费标准 GitHub Runner（`ubuntu-24.04`、`macos-26`、`windows-2025`）上构建并发布到 `bbfss/t3code` Releases：
     - Windows x64：NSIS 安装包（`.exe`，含内置 WSL runtime）+ CLI 压缩包（`.zip`）+ `windows-2025` 原生二进制校验
     - macOS arm64（Apple Silicon）：`.dmg` + `.zip` + CLI 压缩包（`.tar.gz`）+ DMG 启动检查
     - Linux x64：`.AppImage` + `.deb` + CLI 压缩包（`.tar.gz`）+ AppImage 启动检查
   - 应用内自动更新源（`app-update.yml` 与 `update-feed/nightly.json`）指向 `bbfss/t3code`：桌面端收到更新提示并一键重启后，即同时获得**官方最新更新 + 完整保留的 bbfss 改动**。
   - 其他触发方式：向 `bbfss` 推送/合并提交、在发往 `bbfss` 的内部 PR 打标签 `bbfss:build`、推送 `bbfss-v*` 标签、或在 Actions 页面手动点击 `Run workflow`。
- **未签名构建首次启动说明**：
  - macOS（ad-hoc 签名）：将应用拖入 `/Applications` 后执行一次 `xattr -cr "/Applications/T3 Code (Nightly).app"`（Stable 为 `T3 Code (Beta).app`）
  - Windows：若 SmartScreen 弹出提示，点击「更多信息」→「仍要运行」

