# Branch Review

一个只在本机运行的 Git 分支差异阅读器。输入任意本地 Git 仓库路径后，可以选择本地或远端跟踪分支，在同一画布中对照阅读改动前后的完整源码。

## 启动

需要 Node.js `>=22.13.0` 和 Git。

```bash
npm install
npm run dev
```

打开 [http://localhost:9002](http://localhost:9002)。`npm run dev` 会同时启动：

- 页面服务：`http://localhost:9002`
- 本地只读 Git API：`http://127.0.0.1:3101`

## macOS 一键启动

本机已安装 `~/Applications/GitDiff.app`，运行文件位于 `~/Library/Application Support/GitDiff/site`。可以从 Finder、Spotlight 或程序坞直接打开 **GitDiff**：

- 打开应用：等待 Git API 和页面服务均启动成功后，再自动打开页面
- 再次打开：复用已有服务；若浏览器中已有 GitDiff 标签，则激活并刷新，不再创建重复标签
- 退出应用：停止页面服务和 Git API
- 运行日志：`~/Library/Application Support/GitDiff/GitDiff.log`

Git API 仅监听 `127.0.0.1`，并只允许来自 `localhost:9002` 的页面跨域读取。

## 功能

- 选择任意本地 Git 仓库
- 自动读取本地分支和远端跟踪分支
- 目标分支支持名称片段和非连续字符模糊搜索
- 按共同祖先执行三点比较，等价于 `git diff base...target`
- 展示提交数、文件数、增加行和删除行
- 按路径前缀过滤变更文件；存在 `app/` 时默认展示该目录
- 按目录浏览、搜索和筛选变更文件
- 默认展示基准分支与目标分支的完整源码，并保持左右行对齐
- 可切换到仅保留 3 行上下文的紧凑差异模式
- 审阅进度仅保存在当前页面状态，不写入仓库
- 单文件差异按需加载，超过 2 MB 时停止渲染

## 只读边界

本地 API 只会执行 `rev-parse`、`for-each-ref`、`merge-base`、`rev-list` 和 `diff` 等读取命令。它不会执行 `checkout`、`switch`、`add`、`commit`、`merge`、`push`，也不会写入所选仓库。

## 校验

```bash
npm run lint
npm run build
```
