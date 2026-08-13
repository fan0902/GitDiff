# GitDiff localhost 与 macOS 签名可靠性修复设计

日期：2026-07-26

## 背景与根因

GitDiff.app 当前可以启动 AppleScript 进程和 `127.0.0.1:3101` 的只读 Git API，但页面服务没有监听 9002。独立运行页面服务得到 `getaddrinfo ENOTFOUND localhost`；Node、Python 和 ping 均无法解析 `localhost`。

系统 `/etc/hosts` 于 2026-07-25 17:32:38 被外部程序重写，文件中不再包含标准的 `127.0.0.1 localhost` 与 `::1 localhost`。GitDiff 页面服务和启动器仍依赖 `localhost:9002`，因此 Vite 初始化失败，启动器等待 30 秒后报错。

另有一项独立隐患：GitDiff.app 在 `osacompile` 后替换 `applet.icns`，但没有重新签名。`codesign --verify --deep --strict` 因密封资源变化而失败。当前已有 App 进程不受影响，但重新启动或经过 Gatekeeper 检查时可能失败。

## 方案比较

### 方案 A：只修复系统 hosts

恢复标准 localhost 映射可以立即解除当前故障，但 GitDiff 仍依赖容易被外部 hosts 管理工具再次破坏的别名，且 App 签名问题仍存在。

### 方案 B：只修改 GitDiff

将页面服务与启动器改为 `127.0.0.1` 可以让 GitDiff 独立恢复，但系统中其他依赖 localhost 的开发工具仍会失败。

### 方案 C：系统恢复与应用加固同时执行

这是已批准的方案。系统恢复标准语义，GitDiff 则不再依赖 localhost，并建立“替换图标后重新签名”的可重复打包流程。

## 系统恢复

修改 `/etc/hosts` 前创建带时间戳的 root 所有备份，保留文件现有权限和全部 12 KB 黑名单内容。仅在缺失时追加以下标准记录，不整理、不删除、不重排既有内容：

```text
127.0.0.1 localhost
::1 localhost
```

写入后刷新 macOS DNS 缓存，并用 Node、Python 和 ping 验证 `localhost` 可解析到回环地址。备份路径在交付结果中明确给出，以便恢复。

## GitDiff 运行时加固

- `scripts/dev.mjs` 启动 Vinext 时显式传入其实际支持的 `--hostname 127.0.0.1` 与 `--port 9002`，避免 Vinext 回退到 localhost；同时设置 `GIT_DIFF_LOCAL=1` 标记桌面运行模式。
- `vite.config.ts` 在 `GIT_DIFF_LOCAL=1` 时只加载 Vinext，不启动桌面工具不需要的 Sites/Cloudflare workerd 插件；普通 build 与托管路径保持原插件组合。
- `packaging/macos/GitDiff.applescript` 的页面 URL 与标签匹配前缀改为 `http://127.0.0.1:9002`；健康检查继续使用 `127.0.0.1:3101`。
- `packaging/macos/open-gitdiff.jxa` 的无参数默认值同步改为 `127.0.0.1:9002`。
- 本地 Git API 的 CORS 白名单保留 `localhost:9002` 兼容项，并确认包含 `127.0.0.1:9002`，避免已有手动启动方式受影响。

## 可重复签名流程

新增 `packaging/macos/build-app.sh`，按固定顺序执行：

1. 使用 `osacompile -s` 生成 stay-open App。
2. 将 `GitDiff.icns` 写入 App bundle 的 `applet.icns`。
3. 更新时间戳。
4. 使用 ad-hoc 身份执行 `codesign --force --deep --sign -`。
5. 执行 `codesign --verify --deep --strict`，验证失败则构建失败。

脚本默认输出 `build/macos/GitDiff.app`，也接受一个显式输出路径。README 与本机安装均调用该脚本，不再手工复制图标后遗漏签名。

## 测试与验收

实现遵循测试先行：

- 源码回归测试先证明运行时仍包含 `localhost:9002` 且打包后没有签名步骤。
- 本地模式集成测试在随机回环端口真实启动 Vinext，确保即使系统无法解析 localhost，页面仍能在限定时间内返回 HTTP 200。
- 修改后测试断言 Vite host、AppleScript URL、JXA 默认值均为 `127.0.0.1`，并校验打包脚本中图标复制发生在签名之前。
- 运行完整 `npm test`、lint、build、AppleScript/JXA 编译。
- 使用新打包脚本生成 App，并通过严格 codesign 校验。
- 同步到用户 Application Support 目录，重启 GitDiff.app，确认 `127.0.0.1:9002` 与 `127.0.0.1:3101` 都返回 HTTP 200。
- 确认默认浏览器只在服务健康后打开页面。

## 发布边界

- 本次不删除现有 hosts 内容，不修改用户选择的任何 Git 仓库。
- 不创建 PR、Release 或 Sites 部署。
- 修复提交先保留在本地 GitDiff 开发分支；任何 GitHub push 仍需用户单独确认。
