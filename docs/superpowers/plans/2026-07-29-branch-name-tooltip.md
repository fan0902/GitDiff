# Branch Name Tooltip Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在目标分支搜索列表中悬停任一选项时显示完整分支名，同时保持现有单行省略布局。

**Architecture:** 复用浏览器原生 `title` 提示，不引入新的组件、状态或样式。回归测试读取实际 React 源码，确保每个搜索结果按钮把完整 `branch.name` 绑定到 `title`。

**Tech Stack:** React 19、TypeScript、Node.js test runner、ESLint、vinext/Vite

---

### Task 1: 分支选项悬浮提示

**Files:**
- Modify: `tests/rendered-html.test.mjs`
- Modify: `app/DiffViewer.tsx`

- [ ] **Step 1: 写入失败测试**

在 `tests/rendered-html.test.mjs` 增加：

```js
test("searchable branch options expose the full name on hover", async () => {
  const source = await readFile(new URL("../app/DiffViewer.tsx", import.meta.url), "utf8");

  assert.match(source, /title=\{branch\.name\}/);
});
```

- [ ] **Step 2: 验证测试因功能缺失而失败**

运行：

```bash
node --disable-warning=ExperimentalWarning --experimental-strip-types --test \
  --test-name-pattern="searchable branch options expose the full name on hover" \
  tests/rendered-html.test.mjs
```

预期：新测试以未匹配到 `title={branch.name}` 失败。

- [ ] **Step 3: 添加最小实现**

在 `SearchableBranchSelect` 的结果按钮上增加：

```tsx
title={branch.name}
```

不改变现有 CSS、省略规则、远端标签和选中标记。

- [ ] **Step 4: 验证定向测试通过**

运行与 Step 2 相同的命令。

预期：定向测试通过。

- [ ] **Step 5: 提交功能改动**

```bash
git add app/DiffViewer.tsx tests/rendered-html.test.mjs
git commit -m "fix: show full branch names on hover"
```

### Task 2: 完整验证与本机部署

**Files:**
- Deploy from worktree to: `~/Library/Application Support/GitDiff/site`

- [ ] **Step 1: 运行完整质量检查**

```bash
npm run lint
npm test
git diff --check origin/main...HEAD
```

预期：lint 退出码为 0；构建成功；全部测试通过；diff check 无输出。

- [ ] **Step 2: 备份当前安装源码并同步已验证提交**

将当前运行目录备份到 `~/Library/Application Support/GitDiff/backups/`，排除可重装的 `node_modules`；停止 GitDiff 服务后，把当前 worktree 的 Git 跟踪文件同步到运行目录并执行 `npm install --no-audit --no-fund`。

- [ ] **Step 3: 启动并验证实际 App**

```bash
open ~/Applications/GitDiff.app
curl --fail http://127.0.0.1:3101/health
curl --fail http://127.0.0.1:9002/
```

预期：两个接口均成功；安装目录中的 `DiffViewer.tsx` 包含 `title={branch.name}`，页面服务继续监听 9002。

