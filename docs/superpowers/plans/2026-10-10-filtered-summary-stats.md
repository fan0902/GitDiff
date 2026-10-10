# Filtered Summary Statistics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让文件审阅页右侧文件数与增删行统计实时反映路径、搜索和“仅新增”过滤，同时不受已读/未读状态影响。

**Architecture:** 新增一个无 React 依赖的纯函数模块，先从完整文件列表派生统计范围，再基于阅读状态派生左侧可见范围，并独立聚合统计值。`DiffViewer` 只组合当前 UI 状态和渲染派生结果，不修改后端接口或比较响应。

**Tech Stack:** React 19、TypeScript、Node.js test runner、ESLint、vinext/Vite

---

### Task 1: 建立两层文件过滤与统计模型

**Files:**
- Create: `app/file-filter.ts`
- Create: `tests/file-filter.test.mjs`

- [ ] **Step 1: 写入失败的纯函数测试**

创建 `tests/file-filter.test.mjs`：

```js
import assert from "node:assert/strict";
import test from "node:test";
import { deriveReviewFiles, summarizeFiles } from "../app/file-filter.ts";

const files = [
  { path: "app/api/new.ts", status: "added", additions: 10, deletions: 0 },
  { path: "app/ui/card.tsx", status: "modified", additions: 4, deletions: 3 },
  { path: "server/job.ts", status: "modified", additions: 2, deletions: 8 },
];

test("applies path, search and added filters to the summary range", () => {
  const result = deriveReviewFiles(files, {
    pathFilter: "./APP/",
    search: "new",
    mode: "added",
    readFiles: new Set(["app/api/new.ts"]),
  });

  assert.deepEqual(result.summaryFiles.map((file) => file.path), ["app/api/new.ts"]);
  assert.deepEqual(result.visibleFiles.map((file) => file.path), ["app/api/new.ts"]);
});

test("keeps the summary range stable when unread filtering hides read files", () => {
  const result = deriveReviewFiles(files, {
    pathFilter: "app/",
    search: "",
    mode: "unread",
    readFiles: new Set(["app/api/new.ts"]),
  });

  assert.deepEqual(result.summaryFiles.map((file) => file.path), ["app/api/new.ts", "app/ui/card.tsx"]);
  assert.deepEqual(result.visibleFiles.map((file) => file.path), ["app/ui/card.tsx"]);
});

test("summarizes only the supplied files and returns neutral zero totals", () => {
  assert.deepEqual(summarizeFiles(files.slice(0, 2)), {
    fileCount: 2,
    additions: 14,
    deletions: 3,
    additionPercent: 14 / 17 * 100,
  });
  assert.deepEqual(summarizeFiles([]), {
    fileCount: 0,
    additions: 0,
    deletions: 0,
    additionPercent: 50,
  });
});
```

- [ ] **Step 2: 验证测试因模块不存在而失败**

运行：

```bash
node --disable-warning=ExperimentalWarning --experimental-strip-types --test tests/file-filter.test.mjs
```

预期：FAIL，错误指出无法找到 `app/file-filter.ts`。

- [ ] **Step 3: 实现最小纯函数模块**

创建 `app/file-filter.ts`：

```ts
export type ReviewFilterMode = "all" | "unread" | "added";

export type FilterableFile = {
  path: string;
  status: string;
  additions: number;
  deletions: number;
};

type ReviewFilterOptions = {
  pathFilter: string;
  search: string;
  mode: ReviewFilterMode;
  readFiles: ReadonlySet<string>;
};

export function deriveReviewFiles<T extends FilterableFile>(
  files: readonly T[],
  options: ReviewFilterOptions,
) {
  const pathPrefix = options.pathFilter.trim().replace(/^\.\//, "").toLowerCase();
  const query = options.search.trim().toLowerCase();
  const summaryFiles = files.filter((file) => {
    const normalizedPath = file.path.toLowerCase();
    if (pathPrefix && !normalizedPath.startsWith(pathPrefix)) return false;
    if (query && !normalizedPath.includes(query)) return false;
    if (options.mode === "added" && file.status !== "added") return false;
    return true;
  });
  const visibleFiles = options.mode === "unread"
    ? summaryFiles.filter((file) => !options.readFiles.has(file.path))
    : summaryFiles;
  return { summaryFiles, visibleFiles };
}

export function summarizeFiles(files: readonly FilterableFile[]) {
  const additions = files.reduce((sum, file) => sum + file.additions, 0);
  const deletions = files.reduce((sum, file) => sum + file.deletions, 0);
  const totalLines = additions + deletions;
  return {
    fileCount: files.length,
    additions,
    deletions,
    additionPercent: totalLines ? additions / totalLines * 100 : 50,
  };
}
```

- [ ] **Step 4: 验证纯函数测试通过**

运行：

```bash
node --disable-warning=ExperimentalWarning --experimental-strip-types --test tests/file-filter.test.mjs
```

预期：3 项测试全部 PASS。

- [ ] **Step 5: 提交纯函数与测试**

```bash
git add app/file-filter.ts tests/file-filter.test.mjs
git commit -m "feat: derive filtered review statistics"
```

### Task 2: 将过滤统计接入文件审阅页

**Files:**
- Modify: `app/DiffViewer.tsx:1-5, 404-432, 651, 702-709`
- Modify: `tests/rendered-html.test.mjs`

- [ ] **Step 1: 写入失败的组件契约测试**

在 `tests/rendered-html.test.mjs` 增加：

```js
test("the review summary uses the filtered statistics range", async () => {
  const source = await readFile(new URL("../app/DiffViewer.tsx", import.meta.url), "utf8");

  assert.match(source, /deriveReviewFiles/);
  assert.match(source, /summarizeFiles\(summaryFiles\)/);
  assert.match(source, /summary\.fileCount/);
  assert.match(source, /summary\.additions/);
  assert.match(source, /summary\.deletions/);
  assert.match(source, /visibleFiles\.length/);
  assert.doesNotMatch(source, /comparison\?\.additions/);
  assert.doesNotMatch(source, /comparison\?\.deletions/);
});
```

- [ ] **Step 2: 验证组件测试因尚未接入而失败**

运行：

```bash
node --disable-warning=ExperimentalWarning --experimental-strip-types --test \
  --test-name-pattern="the review summary uses the filtered statistics range" \
  tests/rendered-html.test.mjs
```

预期：FAIL，缺少 `deriveReviewFiles` 和 `summary` 渲染。

- [ ] **Step 3: 接入两层过滤和摘要聚合**

在 `app/DiffViewer.tsx` 添加导入：

```ts
import { deriveReviewFiles, summarizeFiles } from "./file-filter";
```

用以下派生状态替换现有 `filteredFiles` 计算：

```ts
const { summaryFiles, visibleFiles } = useMemo(() => deriveReviewFiles(
  comparison?.files ?? [],
  { pathFilter, search, mode: filter, readFiles },
), [comparison, filter, pathFilter, readFiles, search]);

const summary = useMemo(() => summarizeFiles(summaryFiles), [summaryFiles]);
const hasSummaryFilter = Boolean(pathFilter.trim() || search.trim() || filter === "added");
```

将文件分组与空状态改为使用 `visibleFiles`。左侧计数使用：

```tsx
<strong>
  {comparison && visibleFiles.length !== comparison.files.length
    ? `${visibleFiles.length} / ${comparison.files.length}`
    : comparison?.files.length || 0} 个文件
</strong>
```

右侧摘要改为：

```tsx
<p>{hasSummaryFilter ? "当前筛选包含" : "这次比较包含"} <strong>{summary.fileCount}</strong> 个文件</p>
```

统计卡片分别渲染 `summary.fileCount`、`summary.additions`、`summary.deletions`，比例条宽度渲染 `${summary.additionPercent}%`。
空结果由 `summarizeFiles([])` 提供中性零值，页面显示 `0 文件`、`+0`、`−0`，比例条宽度为 `50%`。

- [ ] **Step 4: 验证组件契约和纯函数测试通过**

运行：

```bash
node --disable-warning=ExperimentalWarning --experimental-strip-types --test \
  tests/file-filter.test.mjs tests/rendered-html.test.mjs
```

预期：所有相关测试 PASS。

- [ ] **Step 5: 提交组件接入**

```bash
git add app/DiffViewer.tsx tests/rendered-html.test.mjs
git commit -m "feat: sync review summary with file filters"
```

### Task 3: 完整验证与本机部署

本任务运行 lint、生产构建和完整测试，并把验证通过的版本部署到本机 GitDiff App。

**Files:**
- Deploy to: `/Users/fanlei06/Library/Application Support/GitDiff/site`

- [ ] **Step 1: 运行完整质量检查**

```bash
npm run lint
npm test
git diff --check origin/main...HEAD
```

预期：lint 无错误、构建成功、全部测试通过，diff check 无输出。

- [ ] **Step 2: 部署并重启本机 GitDiff**

先备份当前运行源码（排除 `node_modules`），停止当前 9002/3101 服务，从当前 `HEAD` 归档 Git 跟踪文件同步到运行目录：

```bash
gitdiff_runtime_site='/Users/fanlei06/Library/Application Support/GitDiff/site'
gitdiff_support='/Users/fanlei06/Library/Application Support/GitDiff'
gitdiff_backup="$gitdiff_support/backups/2026-10-10-filter-summary-stats"
gitdiff_staging="$(mktemp -d /tmp/gitdiff-filter-summary.XXXXXX)"
mkdir -p "$gitdiff_backup"
rsync -a --delete --exclude node_modules/ "$gitdiff_runtime_site/" "$gitdiff_backup/"
git archive HEAD | tar -x -C "$gitdiff_staging"
if [ -f "$gitdiff_support/GitDiff.pid" ]; then
  gitdiff_pid=$(tr -cd '0-9' < "$gitdiff_support/GitDiff.pid")
  if [ -n "$gitdiff_pid" ] && kill -0 "$gitdiff_pid" 2>/dev/null; then
    kill -TERM "$gitdiff_pid"
  fi
fi
rsync -a --delete --exclude node_modules/ "$gitdiff_staging/" "$gitdiff_runtime_site/"
npm install --no-audit --no-fund --prefix "$gitdiff_runtime_site"
bash packaging/macos/build-app.sh '/Users/fanlei06/Applications/GitDiff.app'
open '/Users/fanlei06/Applications/GitDiff.app'
```

不得把 worktree 路径或其他机器绝对路径写入版本库。

- [ ] **Step 3: 验证运行态与实际过滤结果**

确认：

```bash
curl --fail http://127.0.0.1:3101/health
curl --fail http://127.0.0.1:9002/
```

并验证部署目录中的 `app/DiffViewer.tsx`、`app/file-filter.ts` 与当前 `HEAD` 哈希一致。使用一个包含 `app/` 与其他目录变更的真实比较，确认路径、搜索和“仅新增”改变右侧三项统计，而“未读”不改变统计。

- [ ] **Step 4: 检查最终分支状态**

```bash
git status --short --branch
git log --oneline origin/main..HEAD
```

预期：工作树干净，分支只包含设计、计划和功能提交；不自动 push。
