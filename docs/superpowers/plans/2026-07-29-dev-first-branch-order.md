# Dev-First Branch Order Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让目标分支下拉列表在默认状态下置顶开发分支，并将其余分支按最后提交时间从近到远排列。

**Architecture:** 新增一个不修改输入数组的纯排序函数，负责 dev 置顶、时间降序和稳定兜底。`SearchableBranchSelect` 只在搜索词为空时调用它；有搜索词时继续使用已有模糊匹配流程。

**Tech Stack:** React 19、TypeScript、Node.js test runner、ESLint、vinext/Vite

---

### Task 1: 默认分支排序函数

**Files:**
- Create: `app/branch-order.ts`
- Create: `tests/branch-order.test.mjs`

- [ ] **Step 1: 写入失败测试**

创建 `tests/branch-order.test.mjs`：

```js
import assert from "node:assert/strict";
import test from "node:test";
import { orderDefaultBranches } from "../app/branch-order.ts";

const names = (branches) => branches.map((branch) => branch.name);

test("pins local dev and orders every remaining branch by newest commit", () => {
  const branches = [
    { name: "origin/dev", updatedAt: "2026-07-29T13:00:00Z" },
    { name: "feature/newest", updatedAt: "2026-07-29T15:00:00Z" },
    { name: "dev", updatedAt: "2026-07-01T00:00:00Z" },
    { name: "feature/older", updatedAt: "2026-07-20T00:00:00Z" },
  ];

  assert.deepEqual(names(orderDefaultBranches(branches)), ["dev", "feature/newest", "origin/dev", "feature/older"]);
  assert.deepEqual(names(branches), ["origin/dev", "feature/newest", "dev", "feature/older"]);
});

test("falls back to origin dev when local dev is absent", () => {
  const branches = [
    { name: "feature/newest", updatedAt: "2026-07-29T15:00:00Z" },
    { name: "origin/dev", updatedAt: "2026-07-01T00:00:00Z" },
  ];

  assert.deepEqual(names(orderDefaultBranches(branches)), ["origin/dev", "feature/newest"]);
});

test("orders without dev and keeps stable fallbacks", () => {
  const branches = [
    { name: "same-a", updatedAt: "2026-07-20T00:00:00Z" },
    { name: "invalid-a", updatedAt: "unknown" },
    { name: "newest", updatedAt: "2026-07-29T00:00:00Z" },
    { name: "same-b", updatedAt: "2026-07-20T00:00:00Z" },
    { name: "invalid-b", updatedAt: "" },
  ];

  assert.deepEqual(names(orderDefaultBranches(branches)), ["newest", "same-a", "same-b", "invalid-a", "invalid-b"]);
});
```

- [ ] **Step 2: 验证测试因模块缺失而失败**

```bash
node --disable-warning=ExperimentalWarning --experimental-strip-types --test tests/branch-order.test.mjs
```

预期：失败并提示找不到 `app/branch-order.ts`。

- [ ] **Step 3: 添加最小排序实现**

创建 `app/branch-order.ts`：

```ts
type BranchOrderItem = {
  name: string;
  updatedAt: string;
};

export function orderDefaultBranches<T extends BranchOrderItem>(branches: readonly T[]): T[] {
  const pinnedName = branches.some((branch) => branch.name === "dev")
    ? "dev"
    : branches.some((branch) => branch.name === "origin/dev")
      ? "origin/dev"
      : "";

  return branches
    .map((branch, index) => {
      const parsedTime = Date.parse(branch.updatedAt);
      return { branch, index, time: Number.isNaN(parsedTime) ? Number.NEGATIVE_INFINITY : parsedTime };
    })
    .sort((left, right) => {
      if (left.branch.name === pinnedName && right.branch.name !== pinnedName) return -1;
      if (right.branch.name === pinnedName && left.branch.name !== pinnedName) return 1;
      return right.time - left.time || left.index - right.index;
    })
    .map(({ branch }) => branch);
}
```

- [ ] **Step 4: 验证排序测试通过**

运行 Step 2 的命令，预期 3/3 通过。

- [ ] **Step 5: 提交排序函数**

```bash
git add app/branch-order.ts tests/branch-order.test.mjs
git commit -m "feat: order default branch choices by activity"
```

### Task 2: 接入目标分支下拉列表

**Files:**
- Modify: `app/DiffViewer.tsx`
- Modify: `tests/rendered-html.test.mjs`

- [ ] **Step 1: 写入失败的接入测试**

在 `tests/rendered-html.test.mjs` 增加：

```js
test("the default branch menu uses activity ordering without changing fuzzy search", async () => {
  const source = await readFile(new URL("../app/DiffViewer.tsx", import.meta.url), "utf8");

  assert.match(source, /if \(!query\.trim\(\)\) return orderDefaultBranches\(branches\)\.slice\(0, 80\)/);
  assert.match(source, /fuzzyBranchScore\(branch\.name, query\)/);
  assert.doesNotMatch(source, /left\.branch\.name === value/);
});
```

- [ ] **Step 2: 验证接入测试失败**

```bash
node --disable-warning=ExperimentalWarning --experimental-strip-types --test \
  --test-name-pattern="the default branch menu uses activity ordering without changing fuzzy search" \
  tests/rendered-html.test.mjs
```

预期：未匹配到 `orderDefaultBranches` 调用而失败。

- [ ] **Step 3: 接入默认排序**

在 `app/DiffViewer.tsx` 引入：

```tsx
import { orderDefaultBranches } from "./branch-order";
```

将 `matches` 计算改为：

```tsx
const matches = useMemo(() => {
  if (!query.trim()) return orderDefaultBranches(branches).slice(0, 80);
  return branches
    .map((branch, index) => ({ branch, index, score: fuzzyBranchScore(branch.name, query) }))
    .filter((entry): entry is { branch: Branch; index: number; score: number } => entry.score !== null)
    .sort((left, right) => left.score - right.score || left.index - right.index)
    .slice(0, 80)
    .map((entry) => entry.branch);
}, [branches, query]);
```

- [ ] **Step 4: 验证定向测试和排序测试通过**

```bash
node --disable-warning=ExperimentalWarning --experimental-strip-types --test \
  tests/branch-order.test.mjs tests/rendered-html.test.mjs
```

预期：相关测试全部通过。

- [ ] **Step 5: 提交下拉列表接入**

```bash
git add app/DiffViewer.tsx tests/rendered-html.test.mjs
git commit -m "feat: prioritize dev in the branch menu"
```

### Task 3: 验证、部署和推送主分支

**Files:**
- Deploy to: `~/Library/Application Support/GitDiff/site`

- [ ] **Step 1: 运行完整验证**

```bash
npm run lint
npm test
git diff --check origin/main...HEAD
```

预期：lint、构建和全部测试通过；diff check 无输出。

- [ ] **Step 2: 备份并部署本机 App**

备份当前运行源码（排除 `node_modules`），停止 9002/3101 服务，把当前 HEAD 的 Git 跟踪文件同步到运行目录，执行 `npm install --no-audit --no-fund` 后重新打开 GitDiff App。

- [ ] **Step 3: 验证实际服务**

```bash
curl --fail http://127.0.0.1:3101/health
curl --fail http://127.0.0.1:9002/
```

预期：两个接口成功，安装目录源码与当前 HEAD 哈希一致。

- [ ] **Step 4: fast-forward 推送远端 main**

```bash
git fetch origin main
git merge-base --is-ancestor origin/main HEAD
git push origin HEAD:main
```

预期：远端 `main` 更新到当前 HEAD，不使用 force push，不创建 PR。
