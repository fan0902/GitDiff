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

仓库包含可编译为 macOS 应用的启动器。先将源码安装到用户目录：

```bash
mkdir -p "$HOME/Library/Application Support/GitDiff/site"
rsync -a --exclude node_modules --exclude .git ./ "$HOME/Library/Application Support/GitDiff/site/"
cd "$HOME/Library/Application Support/GitDiff/site"
npm install
```

然后编译应用并安装图标：

```bash
mkdir -p build/macos "$HOME/Applications"
npm run build:macos
ditto build/macos/GitDiff.app "$HOME/Applications/GitDiff.app"
```

现在可以从 Finder、Spotlight 或程序坞打开 **GitDiff**：

- 打开应用：等待 Git API 和页面服务均启动成功后，再自动打开页面
- 再次打开：复用已有服务；若浏览器中已有 GitDiff 标签，则激活并刷新，不再创建重复标签
- 退出应用：停止页面服务和 Git API
- 运行日志：`~/Library/Application Support/GitDiff/GitDiff.log`

启动器会在运行时读取用户的 Application Support 目录，并通过 macOS 默认浏览器打开页面。若默认浏览器已存在 GitDiff 标签且支持标签自动化，启动器会直接激活并刷新该标签。

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
- 在目标源码标题栏连续跳转上一处或下一处变更，并循环浏览一个文件内的所有变更块
- 在“提交关系”视图中查看共同祖先、分叉点、两侧独有提交和 merge 父边
- 输入可选 commit SHA，定位它属于共同历史、基准侧、目标侧或当前分支对之外
- 每侧默认展示 12 个独有提交，超出部分折叠；浅克隆和断开历史会明确提示
- 审阅进度仅保存在当前页面状态，不写入仓库
- 单文件差异按需加载，超过 2 MB 时停止渲染

## 只读边界

本地 API 只会执行 `rev-parse`、`for-each-ref`、`merge-base`、`merge-base --is-ancestor`、`rev-list`、`show` 和 `diff` 等读取命令。它不会执行 `fetch`、`checkout`、`switch`、`add`、`commit`、`merge`、`push`，也不会写入所选仓库。

## 校验

```bash
npm run lint
npm run build
```
