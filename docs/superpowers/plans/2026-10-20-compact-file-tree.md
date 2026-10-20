# Compact File Tree Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat GitDiff review sidebar with the approved compact, collapsible directory tree without changing filters, read state, selection, or summary totals.

**Architecture:** Build a React-independent tree model from the already filtered `visibleFiles`, including descendant counts and compacted single-child directory chains. Render that model through a focused recursive React component while `DiffViewer` owns directory expansion and existing file-selection behavior. No server or Git API changes are required.

**Tech Stack:** React 19, TypeScript, Node.js test runner, ESLint, vinext/Vite

---

### Task 1: Build the deterministic file-tree model

**Files:**
- Create: `app/file-tree.ts`
- Create: `tests/file-tree.test.mjs`

- [ ] **Step 1: Write the failing tree-model tests**

Create `tests/file-tree.test.mjs`:

```js
import assert from "node:assert/strict";
import test from "node:test";
import { buildFileTree, collectDirectoryKeys } from "../app/file-tree.ts";

const files = [
  { path: "app/controllers/member/grant.py" },
  { path: "app/controllers/member/revoke.py" },
  { path: "app/database/repositories/member.py" },
  { path: "app/services/member/service.py" },
  { path: "app/main.py" },
  { path: "README.md" },
];

test("builds nested directories, descendant counts and top-level files", () => {
  const tree = buildFileTree(files);

  assert.deepEqual(tree.map((node) => node.type === "directory" ? node.label : node.name), ["app", "README.md"]);
  assert.equal(tree[0].type, "directory");
  assert.equal(tree[0].fileCount, 5);
  assert.deepEqual(
    tree[0].children.map((node) => node.type === "directory" ? node.label : node.name),
    ["controllers / member", "database / repositories", "services / member", "main.py"],
  );
});

test("keeps file identity and compacts only directory-only chains", () => {
  const tree = buildFileTree(files);
  const app = tree[0];
  assert.equal(app.type, "directory");
  const controllers = app.children[0];
  assert.equal(controllers.type, "directory");
  assert.equal(controllers.key, "app/controllers/member");
  assert.equal(controllers.fileCount, 2);
  assert.deepEqual(controllers.children.map((node) => node.type === "file" ? node.file.path : ""), [
    "app/controllers/member/grant.py",
    "app/controllers/member/revoke.py",
  ]);
});

test("collects stable directory keys in display order", () => {
  assert.deepEqual(collectDirectoryKeys(buildFileTree(files)), [
    "app",
    "app/controllers/member",
    "app/database/repositories",
    "app/services/member",
  ]);
});
```

- [ ] **Step 2: Run the test and verify the RED state**

Run:

```bash
node --disable-warning=ExperimentalWarning --experimental-strip-types --test tests/file-tree.test.mjs
```

Expected: FAIL because `app/file-tree.ts` does not exist.

- [ ] **Step 3: Implement the minimal tree model**

Create `app/file-tree.ts`:

```ts
export type FileTreeFile<T> = {
  type: "file";
  key: string;
  name: string;
  file: T;
};

export type FileTreeDirectory<T> = {
  type: "directory";
  key: string;
  label: string;
  path: string;
  fileCount: number;
  children: FileTreeNode<T>[];
};

export type FileTreeNode<T> = FileTreeDirectory<T> | FileTreeFile<T>;

type MutableDirectory<T> = {
  name: string;
  key: string;
  directories: Map<string, MutableDirectory<T>>;
  files: FileTreeFile<T>[];
};

function createDirectory<T>(name: string, key: string): MutableDirectory<T> {
  return { name, key, directories: new Map(), files: [] };
}

function materializeChildren<T>(directory: MutableDirectory<T>): FileTreeNode<T>[] {
  return [
    ...[...directory.directories.values()].map(materializeDirectory),
    ...directory.files,
  ];
}

function materializeDirectory<T>(directory: MutableDirectory<T>): FileTreeDirectory<T> {
  const labels = [directory.name];
  let current = directory;
  while (current.files.length === 0 && current.directories.size === 1) {
    current = current.directories.values().next().value as MutableDirectory<T>;
    labels.push(current.name);
  }
  const children = materializeChildren(current);
  const fileCount = children.reduce(
    (total, child) => total + (child.type === "directory" ? child.fileCount : 1),
    0,
  );
  return {
    type: "directory",
    key: current.key,
    label: labels.join(" / "),
    path: current.key,
    fileCount,
    children,
  };
}

export function buildFileTree<T extends { path: string }>(files: readonly T[]): FileTreeNode<T>[] {
  const root = createDirectory<T>("", "");
  for (const file of files) {
    const segments = file.path.split("/").filter(Boolean);
    if (segments.length === 0) continue;
    const name = segments.at(-1) as string;
    let current = root;
    for (const segment of segments.slice(0, -1)) {
      const key = current.key ? `${current.key}/${segment}` : segment;
      const next = current.directories.get(segment) || createDirectory<T>(segment, key);
      current.directories.set(segment, next);
      current = next;
    }
    current.files.push({ type: "file", key: file.path, name, file });
  }
  return materializeChildren(root);
}

export function collectDirectoryKeys<T>(nodes: readonly FileTreeNode<T>[]): string[] {
  return nodes.flatMap((node) => (
    node.type === "directory"
      ? [node.key, ...collectDirectoryKeys(node.children)]
      : []
  ));
}
```

- [ ] **Step 4: Run the focused tests and verify GREEN**

Run:

```bash
node --disable-warning=ExperimentalWarning --experimental-strip-types --test tests/file-tree.test.mjs
```

Expected: 3 tests PASS.

- [ ] **Step 5: Commit the tree model**

```bash
git add app/file-tree.ts tests/file-tree.test.mjs
git commit -m "feat: derive compact file tree"
```

### Task 2: Render the recursive tree and preserve review behavior

**Files:**
- Create: `app/FileTree.tsx`
- Modify: `app/DiffViewer.tsx:3-7,350-440,650-685`
- Modify: `app/globals.css:100-123`
- Modify: `tests/rendered-html.test.mjs`

- [ ] **Step 1: Write the failing component contract test**

Append to `tests/rendered-html.test.mjs`:

```js
test("the review sidebar renders a compact collapsible file tree", async () => {
  const [viewer, tree, styles] = await Promise.all([
    readFile(new URL("../app/DiffViewer.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/FileTree.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(viewer, /buildFileTree\(visibleFiles\)/);
  assert.match(viewer, /collectDirectoryKeys\(fileTree\)/);
  assert.match(viewer, /<FileTree/);
  assert.doesNotMatch(viewer, /groups\.map/);
  assert.match(tree, /role="tree"/);
  assert.match(tree, /aria-expanded/);
  assert.match(tree, /file-tree-directory/);
  assert.match(styles, /\.file-tree-children/);
  assert.match(styles, /\.file-tree-directory/);
});
```

- [ ] **Step 2: Run the contract test and verify the RED state**

Run:

```bash
node --disable-warning=ExperimentalWarning --experimental-strip-types --test \
  --test-name-pattern="the review sidebar renders a compact collapsible file tree" \
  tests/rendered-html.test.mjs
```

Expected: FAIL because `app/FileTree.tsx` does not exist and `DiffViewer` still renders `groups.map(...)`.

- [ ] **Step 3: Create the recursive directory renderer**

Create `app/FileTree.tsx`:

```tsx
import { ReactNode } from "react";
import { FileTreeNode } from "./file-tree";

type FileTreeProps<T extends { path: string }> = {
  nodes: readonly FileTreeNode<T>[];
  expandedKeys: ReadonlySet<string>;
  folderIcon: ReactNode;
  onToggle: (key: string) => void;
  renderFile: (file: T) => ReactNode;
};

function groupId(key: string) {
  return `file-tree-${encodeURIComponent(key).replaceAll("%", "-")}`;
}

function FileTreeNodes<T extends { path: string }>({
  nodes,
  expandedKeys,
  folderIcon,
  onToggle,
  renderFile,
}: FileTreeProps<T>) {
  return nodes.map((node) => {
    if (node.type === "file") return renderFile(node.file);
    const expanded = expandedKeys.has(node.key);
    const childId = groupId(node.key);
    return (
      <section className="file-tree-branch" key={node.key}>
        <button
          type="button"
          className="file-tree-directory"
          aria-expanded={expanded}
          aria-controls={childId}
          title={node.path}
          onClick={() => onToggle(node.key)}
        >
          <span className="file-tree-chevron" aria-hidden="true">{expanded ? "⌄" : "›"}</span>
          <span className="file-tree-folder" aria-hidden="true">{folderIcon}</span>
          <strong>{node.label}</strong>
          <span>{node.fileCount}</span>
        </button>
        {expanded && (
          <div className="file-tree-children" id={childId} role="group">
            <FileTreeNodes
              nodes={node.children}
              expandedKeys={expandedKeys}
              folderIcon={folderIcon}
              onToggle={onToggle}
              renderFile={renderFile}
            />
          </div>
        )}
      </section>
    );
  });
}

export function FileTree<T extends { path: string }>(props: FileTreeProps<T>) {
  return <div className="file-tree" role="tree" aria-label="变更文件目录树"><FileTreeNodes {...props} /></div>;
}
```

- [ ] **Step 4: Integrate the model and expansion state into `DiffViewer`**

Add imports:

```ts
import { FileTree } from "./FileTree";
import { buildFileTree, collectDirectoryKeys } from "./file-tree";
```

Add state beside `readFiles`:

```ts
const [collapsedDirectories, setCollapsedDirectories] = useState<Set<string>>(new Set());
```

Replace the `groups` memo with:

```ts
const fileTree = useMemo(() => buildFileTree(visibleFiles), [visibleFiles]);
const directoryKeys = useMemo(() => collectDirectoryKeys(fileTree), [fileTree]);
const expandedDirectories = useMemo(() => new Set(
  directoryKeys.filter((key) => !collapsedDirectories.has(key)),
), [collapsedDirectories, directoryKeys]);

function toggleDirectory(key: string) {
  setCollapsedDirectories((current) => {
    const next = new Set(current);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  });
}
```

Clear collapsed state when a repository or comparison is reloaded, and wrap each filter state change so a new filtered result starts expanded:

```ts
function resetTreeAndSet<T>(setter: (value: T) => void, value: T) {
  setCollapsedDirectories(new Set());
  setter(value);
}
```

Use `resetTreeAndSet` for `setPathFilter`, `setSearch`, and `setFilter` event handlers. Keep the existing comparison setup calls and add `setCollapsedDirectories(new Set())` beside `setReadFiles(new Set())`.

Replace the `groups.map(...)` sidebar block with:

```tsx
<div className="file-tree-wrap">
  <FileTree
    nodes={fileTree}
    expandedKeys={expandedDirectories}
    folderIcon={icons.folder}
    onToggle={toggleDirectory}
    renderFile={(file) => (
      <button
        type="button"
        role="treeitem"
        title={file.path}
        className={`file-item ${file.path === selectedPath ? "selected" : ""}`}
        key={file.path}
        onClick={() => void loadFileDiff(file)}
      >
        <span className={`file-type status-${file.status}`}>{extension(file.path)}</span>
        <strong className="file-tree-file-name">{fileName(file.path)}</strong>
        <span className="file-stats"><i>+{file.additions}</i>{file.deletions > 0 && <b>−{file.deletions}</b>}</span>
        {readFiles.has(file.path) && <span className="read-check">{icons.check}</span>}
      </button>
    )}
  />
  {comparison && visibleFiles.length === 0 && <div className="empty-sidebar">没有符合条件的文件</div>}
</div>
```

- [ ] **Step 5: Replace the flat-list CSS with compact tree styling**

Replace `.file-groups`, `.file-group h3`, `.file-group h3 span`, and the existing `.file-item` block with:

```css
.file-tree-wrap { padding: 0 9px 28px; }
.file-tree { min-width: 0; }
.file-tree-branch { min-width: 0; }
.file-tree-directory { width: 100%; min-height: 34px; padding: 0 7px; display: grid; grid-template-columns: 14px 18px minmax(0,1fr) auto; align-items: center; gap: 5px; border: 0; border-radius: 7px; background: transparent; color: var(--ink); text-align: left; cursor: pointer; }
.file-tree-directory:hover { background: rgba(255,253,249,.55); }
.file-tree-directory > strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11px; font-weight: 650; }
.file-tree-directory > span:last-child { color: var(--faint); font: 600 10px var(--font-geist-mono); }
.file-tree-chevron { color: var(--muted); font-size: 15px; line-height: 1; text-align: center; }
.file-tree-folder { display: grid; place-items: center; color: var(--accent); }
.file-tree-folder svg { width: 15px; height: 15px; }
.file-tree-children { margin-left: 12px; padding-left: 6px; border-left: 1px solid #d8cfbf; }
.file-item { position: relative; width: 100%; min-height: 40px; margin: 1px 0; padding: 4px 7px; display: grid; grid-template-columns: 30px minmax(0,1fr) auto 14px; align-items: center; gap: 7px; border: 1px solid transparent; border-radius: 8px; background: transparent; text-align: left; cursor: pointer; }
.file-item:hover { background: rgba(255,253,249,.55); }
.file-item.selected { background: var(--card); border-color: #ddd4c5; box-shadow: 0 4px 11px rgba(68,55,35,.08); }
.file-item .file-type { width: 28px; height: 28px; border-radius: 7px; font-size: 9px; }
.file-tree-file-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11px; font-weight: 620; }
.file-item .read-check { position: static; display: grid; place-items: center; }
.file-item .read-check svg { width: 13px; height: 13px; }
```

Keep the shared `.file-type`, `.file-stats`, status-color, and `.empty-sidebar` rules below this block.

- [ ] **Step 6: Run focused tests and lint**

Run:

```bash
node --disable-warning=ExperimentalWarning --experimental-strip-types --test \
  tests/file-tree.test.mjs tests/file-filter.test.mjs tests/rendered-html.test.mjs
npm run lint
```

Expected: all focused tests PASS and ESLint exits 0.

- [ ] **Step 7: Commit the recursive tree UI**

```bash
git add app/FileTree.tsx app/DiffViewer.tsx app/globals.css tests/rendered-html.test.mjs
git commit -m "feat: render compact review file tree"
```

### Task 3: Full verification and local GitDiff App deployment

**Files:**
- Deploy tracked source to: `/Users/fanlei06/Library/Application Support/GitDiff/site`
- Rebuild: `/Users/fanlei06/Applications/GitDiff.app`

- [ ] **Step 1: Run the complete quality gate**

```bash
npm run lint
npm test
git diff --check origin/main...HEAD
git status --short --branch
```

Expected: lint exits 0, production build succeeds, all tests pass, diff check is empty, and only the intended branch commits differ from `origin/main`.

- [ ] **Step 2: Back up and deploy the verified tracked source**

```bash
runtime_site='/Users/fanlei06/Library/Application Support/GitDiff/site'
support_root='/Users/fanlei06/Library/Application Support/GitDiff'
app_bundle='/Users/fanlei06/Applications/GitDiff.app'
mkdir -p "$support_root/backups"
backup_dir=$(mktemp -d "$support_root/backups/compact-file-tree.XXXXXX")
staging_dir=$(mktemp -d /tmp/gitdiff-compact-tree.XXXXXX)
rsync -a --delete --exclude node_modules/ "$runtime_site/" "$backup_dir/site/"
ditto "$app_bundle" "$backup_dir/GitDiff.app"
git archive HEAD | tar -x -C "$staging_dir"
if [ -f "$support_root/GitDiff.pid" ]; then
  launcher_pid=$(tr -cd '0-9' < "$support_root/GitDiff.pid")
  if [ -n "$launcher_pid" ] && kill -0 "$launcher_pid" 2>/dev/null; then kill -TERM "$launcher_pid"; fi
fi
rsync -a --delete --exclude node_modules/ "$staging_dir/" "$runtime_site/"
npm install --no-audit --no-fund --prefix "$runtime_site"
bash packaging/macos/build-app.sh "$app_bundle"
open "$app_bundle"
```

Expected: the previous runtime and App are recoverable from `backup_dir`; the rebuilt App is signed and opens after the local services are ready.

- [ ] **Step 3: Verify runtime files and services**

```bash
curl --fail http://127.0.0.1:3101/health
curl --fail --output /dev/null http://127.0.0.1:9002/
for source_file in app/DiffViewer.tsx app/FileTree.tsx app/file-tree.ts app/globals.css; do
  test "$(shasum -a 256 "$source_file" | awk '{print $1}')" = \
    "$(shasum -a 256 "$runtime_site/$source_file" | awk '{print $1}')"
done
```

Expected: both endpoints return success and every deployed source hash matches the branch `HEAD`.

- [ ] **Step 4: Browser-check the approved behavior**

Use the real App with a comparison containing nested directories and verify:

1. The sidebar starts expanded and shows directory hierarchy, compacted directory-only chains, descendant counts, compact file rows, and the selected file.
2. Directory toggles collapse and reopen only their own descendants.
3. Path filtering, search, and `仅新增` rebuild an expanded matching tree.
4. Marking a file read and choosing `未读` removes it from the tree but leaves the right summary unchanged.
5. Hovering a truncated directory or filename exposes its complete path.
6. At a narrow viewport the existing slide-in sidebar remains usable without horizontal scrolling.

- [ ] **Step 5: Record final branch state without pushing**

```bash
git status --short --branch
git log --oneline origin/main..HEAD
```

Expected: the worktree is clean and the branch contains the design, plan, model, and UI commits. Do not push without a new explicit user instruction.
