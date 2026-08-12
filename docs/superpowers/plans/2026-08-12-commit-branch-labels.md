# Commit Branch Labels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在提交关系图的真实提交节点上展示直接指向它的本地与远端跟踪分支，并让泳道名称在横向滚动时保持可见。

**Architecture:** 服务端通过只读 `for-each-ref` 建立 SHA 到分支名的映射，并把稳定排序后的 `refs` 数组附加到可见图节点。客户端以紧凑徽标、原生悬浮提示和详情列表展示这些 refs；泳道名称移入滚动容器的 sticky 叠层，不改变图节点布局。

**Tech Stack:** Node.js Git API、React 19、TypeScript、CSS、Node.js test runner、ESLint、vinext/Vite

---

### Task 1: 图 API 返回节点分支 refs

**Files:**
- Modify: `server/git-graph.mjs`
- Modify: `tests/git-graph.test.mjs`

- [ ] **Step 1: 写入失败测试**

在 `tests/git-graph.test.mjs` 增加一个场景：在同一提交创建 `master`、`feature`、`main` 和 `origin/master`，并创建符号引用 `origin/HEAD`。断言 `buildCommitGraph(repo, "master", "feature")` 返回节点：

```js
assert.deepEqual(rootNode.refs, ["master", "feature", "main", "origin/master"]);
assert.equal(rootNode.refs.includes("origin/HEAD"), false);
```

同时在现有无关指定提交场景中断言：

```js
assert.deepEqual(graph.focus.node.refs, ["detached-history"]);
```

- [ ] **Step 2: 验证测试因缺少 refs 而失败**

```bash
node --disable-warning=ExperimentalWarning --experimental-strip-types --test tests/git-graph.test.mjs
```

预期：refs 断言失败，证明当前 API 尚未返回分支指针。

- [ ] **Step 3: 实现只读 refs 映射**

在 `server/git-graph.mjs` 增加：

```js
async function readBranchRefs(repoPath, base, target) {
  const format = "%(objectname)\t%(refname)\t%(refname:short)\t%(symref)";
  const output = await git(repoPath, [
    "for-each-ref",
    `--format=${format}`,
    "refs/heads",
    "refs/remotes",
  ]);
  const preferred = new Map([...new Set([base, target])].map((name, index) => [name, index]));
  const refs = output.trim().split("\n").filter(Boolean).map((line) => {
    const [sha, fullName, name, symref] = line.split("\t");
    return { sha, fullName, name, symref };
  }).filter((ref) => !ref.symref && !ref.name.endsWith("/HEAD"));

  refs.sort((left, right) => {
    const leftPreferred = preferred.get(left.name);
    const rightPreferred = preferred.get(right.name);
    if (leftPreferred !== undefined || rightPreferred !== undefined) {
      if (leftPreferred === undefined) return 1;
      if (rightPreferred === undefined) return -1;
      if (leftPreferred !== rightPreferred) return leftPreferred - rightPreferred;
    }
    const leftRemote = left.fullName.startsWith("refs/remotes/");
    const rightRemote = right.fullName.startsWith("refs/remotes/");
    return Number(leftRemote) - Number(rightRemote) || left.name.localeCompare(right.name);
  });

  const refsBySha = new Map();
  for (const ref of refs) {
    const names = refsBySha.get(ref.sha) ?? [];
    if (!names.includes(ref.name)) names.push(ref.name);
    refsBySha.set(ref.sha, names);
  }
  return refsBySha;
}
```

在 `buildCommitGraph` 中并行读取映射，并给普通节点、共同祖先、HEAD 和无关指定提交附加：

```js
refs: node.sha ? refsBySha.get(node.sha) ?? [] : []
```

- [ ] **Step 4: 验证图 API 测试通过**

运行 Step 2 的命令，预期全部通过。

- [ ] **Step 5: 提交后端改动**

```bash
git add server/git-graph.mjs tests/git-graph.test.mjs
git commit -m "feat: expose branch refs on graph commits"
```

### Task 2: 节点徽标、详情 refs 和固定泳道

**Files:**
- Modify: `app/CommitGraph.tsx`
- Modify: `app/globals.css`
- Modify: `tests/rendered-html.test.mjs`

- [ ] **Step 1: 写入失败的 UI 契约测试**

在 `tests/rendered-html.test.mjs` 增加测试，读取 `CommitGraph.tsx` 与 `globals.css` 并断言：

```js
assert.match(component, /refs: string\[\]/);
assert.match(component, /className="node-ref-badge"/);
assert.match(component, /node\.refs\.slice\(1\)\.length/);
assert.match(component, /指向此提交的分支/);
assert.match(component, /className="graph-lane-overlay"/);
assert.match(styles, /\.graph-lane-overlay[^}]*position:\s*sticky/);
```

- [ ] **Step 2: 验证 UI 测试因功能缺失而失败**

```bash
node --disable-warning=ExperimentalWarning --experimental-strip-types --test \
  --test-name-pattern="commit graph shows branch refs and sticky lane labels" \
  tests/rendered-html.test.mjs
```

预期：未匹配到徽标、详情和 sticky 叠层而失败。

- [ ] **Step 3: 实现节点分支徽标与详情**

给 `GraphNode` 增加：

```ts
refs: string[];
```

节点顶部在 `node.refs.length > 0` 时渲染：

```tsx
<span className="node-ref-badge" title={node.refs.join("、")} aria-label={`分支：${node.refs.join("、")}`}>
  <b>{node.refs[0]}</b>
  {node.refs.slice(1).length > 0 && <em>+{node.refs.slice(1).length}</em>}
</span>
```

详情面板在 refs 非空时渲染“指向此提交的分支”，逐项输出完整名称。

- [ ] **Step 4: 实现固定泳道叠层**

在 `.graph-scroll` 内、`.graph-canvas` 前增加：

```tsx
<div className="graph-lane-overlay" aria-label="提交泳道">
  <span className="graph-lane lane-base">基准 · {data.base.name}</span>
  {!data.disconnected && <span className="graph-lane lane-common">共同历史</span>}
  <span className="graph-lane lane-target">目标 · {data.target.name}</span>
</div>
```

CSS 使用 `position: sticky; left: 0; height: 0; z-index: 5` 固定叠层，并用绝对定位把三个紧凑标签对齐至对应泳道。删除画布内原来的纵向标签。

- [ ] **Step 5: 验证 UI 契约与相关测试通过**

```bash
node --disable-warning=ExperimentalWarning --experimental-strip-types --test \
  tests/git-graph.test.mjs tests/rendered-html.test.mjs
```

预期：相关测试全部通过。

- [ ] **Step 6: 提交前端改动**

```bash
git add app/CommitGraph.tsx app/globals.css tests/rendered-html.test.mjs
git commit -m "feat: show branch labels in the commit graph"
```

### Task 3: 完整验证与本机部署

**Files:**
- Deploy to: `~/Library/Application Support/GitDiff/site`

- [ ] **Step 1: 运行完整质量检查**

```bash
npm run lint
npm test
git diff --check origin/main...HEAD
```

预期：lint、构建和全部测试通过；diff check 无输出。

- [ ] **Step 2: 备份并部署本机 App**

备份当前运行源码（排除 `node_modules`），停止 9002/3101 服务，把当前 HEAD 的 Git 跟踪文件同步到运行目录，执行 `npm install --no-audit --no-fund` 后重新打开 GitDiff App。

- [ ] **Step 3: 验证真实仓库 refs 与服务**

调用 `POST /api/graph` 读取 tab-commerce 的 `master` 对比场景，确认返回节点包含 `master` 或 `origin/master` 的真实 refs；同时确认：

```bash
curl --fail http://127.0.0.1:3101/health
curl --fail http://127.0.0.1:9002/
```

安装目录中的核心文件哈希须与当前 HEAD 一致。
