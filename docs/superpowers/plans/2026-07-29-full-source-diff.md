# GitDiff Full-Source Comparison Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make GitDiff show the complete pre-change and post-change file side by side by default, while retaining the compact three-line-context diff as an optional review mode.

**Architecture:** Extend the existing read-only Git API with a full-context variant of the file diff endpoint, using the same `base...target` comparison and path validation as the compact endpoint. The React client loads compact and full diffs together, parses both through the existing row-alignment pipeline, and renders a two-column source surface with explicit base/target headers. The existing 2 MB response guard remains the boundary for large files.

**Tech Stack:** Node.js HTTP server, Git CLI read operations, React 19, TypeScript, CSS, Node test runner, vinext build.

---

## File structure

- Modify `server/git-api.mjs`: parameterize diff context and expose `POST /api/full-diff` without adding repository mutations.
- Create `tests/git-api-full-diff.test.mjs`: exercise compact and full endpoints against a temporary Git repository.
- Modify `app/DiffViewer.tsx`: own both diff payloads, default to full comparison, and render the two modes.
- Modify `app/globals.css`: style sticky base/target headers and the continuous full-source surface.
- Modify `tests/rendered-html.test.mjs`: protect the new user-visible mode labels and read-only API route.

### Task 1: Add the read-only full-context diff endpoint

**Files:**
- Create: `tests/git-api-full-diff.test.mjs`
- Modify: `server/git-api.mjs:8-10,177-199,224-228`

- [ ] **Step 1: Write an integration test that proves compact diff omits distant context and full diff includes it**

Create `tests/git-api-full-diff.test.mjs` with a temporary Git repository containing a 24-line file. Commit the initial file on `main`, create `feature`, change line 2 and line 23, then start `server/git-api.mjs` on an unused local port. The test body must request both endpoints and assert the middle marker exists only in the full response:

```js
const compact = await post("/api/diff", payload);
const full = await post("/api/full-diff", payload);

assert.equal(compact.truncated, false);
assert.equal(full.truncated, false);
assert.doesNotMatch(compact.diff, /UNCHANGED_MIDDLE_MARKER/);
assert.match(full.diff, /UNCHANGED_MIDDLE_MARKER/);
assert.match(full.diff, /changed-at-top/);
assert.match(full.diff, /changed-at-bottom/);
```

The fixture must use `git init -b main`, local test-only author configuration, `git checkout -b feature`, and `spawn(process.execPath, ["server/git-api.mjs"])`. Register teardown that terminates the child process and removes the temporary directory.

- [ ] **Step 2: Run the focused test and verify the new route is missing**

Run:

```bash
node --test tests/git-api-full-diff.test.mjs
```

Expected: FAIL because `/api/full-diff` returns HTTP 404 with `接口不存在`.

- [ ] **Step 3: Parameterize the existing file-diff reader and add the route**

Add a full-context constant and accept context lines in `fileDiff`:

```js
const COMPACT_CONTEXT_LINES = 3;
const FULL_CONTEXT_LINES = 1_000_000;

async function fileDiff(repoPath, base, target, path, oldPath, contextLines = COMPACT_CONTEXT_LINES) {
  // keep current validation and ref resolution
  const diff = await git(
    repoPath,
    [
      "diff",
      "--no-ext-diff",
      "--find-renames",
      `--unified=${contextLines}`,
      `${baseSha}...${targetSha}`,
      "--",
      ...paths,
    ],
    { maxBuffer: MAX_DIFF_BYTES },
  );
  return { diff, truncated: false };
}
```

Keep `/api/diff` explicit about compact context and add the new read-only route:

```js
if (request.method === "POST" && url.pathname === "/api/diff") {
  const input = await body(request);
  const repoPath = await repository(input.repoPath);
  return json(request, response, 200, await fileDiff(
    repoPath, input.base, input.target, input.path, input.oldPath, COMPACT_CONTEXT_LINES,
  ));
}
if (request.method === "POST" && url.pathname === "/api/full-diff") {
  const input = await body(request);
  const repoPath = await repository(input.repoPath);
  return json(request, response, 200, await fileDiff(
    repoPath, input.base, input.target, input.path, input.oldPath, FULL_CONTEXT_LINES,
  ));
}
```

- [ ] **Step 4: Run the focused test and the mutation-safety test**

Run:

```bash
node --test tests/git-api-full-diff.test.mjs tests/rendered-html.test.mjs
```

Expected: all tests PASS, including the existing assertion that the Git API contains no checkout, switch, add, commit, merge, rebase, push, reset, clean, or restore command.

- [ ] **Step 5: Commit the API slice**

```bash
git add server/git-api.mjs tests/git-api-full-diff.test.mjs
git commit -m "feat: expose full-context file diff"
```

### Task 2: Make full source comparison the default review mode

**Files:**
- Modify: `app/DiffViewer.tsx:330-352,384-454,575-606,635-656`
- Modify: `tests/rendered-html.test.mjs`

- [ ] **Step 1: Add a failing source-contract test for the two review modes**

Extend `tests/rendered-html.test.mjs` to read `app/DiffViewer.tsx` and assert the two approved labels are present and the old primary labels are absent:

```js
test("the diff viewer exposes full-source and compact review modes", async () => {
  const source = await readFile(new URL("../app/DiffViewer.tsx", import.meta.url), "utf8");
  assert.match(source, />完整对照</);
  assert.match(source, />仅看改动</);
  assert.match(source, /基准源码/);
  assert.match(source, /目标源码/);
  assert.doesNotMatch(source, />统一视图</);
  assert.doesNotMatch(source, />左右对比</);
  assert.doesNotMatch(source, /\/Users\//);
});
```

- [ ] **Step 2: Run the contract test and verify it fails on the old labels**

Run:

```bash
node --test tests/rendered-html.test.mjs
```

Expected: FAIL because `完整对照`, `仅看改动`, `基准源码`, and `目标源码` are not present.

- [ ] **Step 3: Replace the single diff state with full and compact payloads**

Introduce the exact mode and response shapes:

```ts
type ReviewMode = "full" | "compact";
type DiffPayload = { diff: string; truncated: boolean };

const EMPTY_DIFF: DiffPayload = { diff: "", truncated: false };
```

Remove the user-specific default repository while preserving the last-opened-repository convenience. Import `useEffect`, set `DEFAULT_REPO` to an empty string, and restore only the browser-local value:

```ts
const DEFAULT_REPO = "";

useEffect(() => {
  const lastRepository = localStorage.getItem("branch-review:last-repo");
  if (lastRepository) setRepoInput(lastRepository);
}, []);
```

Inside `DiffViewer`, replace `diff`, `diffTruncated`, and the old `mode` with:

```ts
const [mode, setMode] = useState<ReviewMode>("full");
const [fullDiff, setFullDiff] = useState<DiffPayload>(EMPTY_DIFF);
const [compactDiff, setCompactDiff] = useState<DiffPayload>(EMPTY_DIFF);

const activeDiff = mode === "full" ? fullDiff : compactDiff;
const rows = useMemo(() => parseDiff(activeDiff.diff), [activeDiff.diff]);
const splitRows = useMemo(() => {
  const parsed = toSplitRows(rows);
  return mode === "full" ? parsed.filter((row) => row.kind === "code") : parsed;
}, [mode, rows]);
```

Reset both payloads when loading a repository, comparing branches, and selecting a file. In `loadFileDiff`, request both endpoints with one shared payload:

```ts
const payload = {
  repoPath: path,
  base: baseRef,
  target: targetRef,
  path: file.path,
  oldPath: file.oldPath,
};
const [full, compact] = await Promise.all([
  post<DiffPayload>("/api/full-diff", payload),
  post<DiffPayload>("/api/diff", payload),
]);
setFullDiff(full);
setCompactDiff(compact);
```

- [ ] **Step 4: Render the approved two-mode toolbar and explicit source headers**

Replace the old unified/split controls with:

```tsx
<button className={mode === "full" ? "active" : ""} onClick={() => setMode("full")}>完整对照</button>
<button className={mode === "compact" ? "active" : ""} onClick={() => setMode("compact")}>仅看改动</button>
```

Change the toolbar note to `默认展示完整源码 · 左右同步阅读`. Above the split rows, render:

```tsx
<div className="source-columns-header" aria-hidden="true">
  <div><span>基准源码</span><code>{comparison?.base}</code></div>
  <div><span>目标源码</span><code>{comparison?.target}</code></div>
</div>
```

Render both modes through `SplitLine`. Full mode filters out Git metadata and hunk headers; compact mode retains hunk separators. Update the empty and truncated states to read from `activeDiff`. When only the full payload is truncated, show a `仅看改动` button that calls `setMode("compact")`.

- [ ] **Step 5: Run the contract test and TypeScript build**

Run:

```bash
node --test tests/rendered-html.test.mjs
npm run build
```

Expected: contract tests PASS and vinext build exits with status 0.

- [ ] **Step 6: Commit the client behavior slice**

```bash
git add app/DiffViewer.tsx tests/rendered-html.test.mjs
git commit -m "feat: default to full-source comparison"
```

### Task 3: Finish the full-source reading surface and regression verification

**Files:**
- Modify: `app/globals.css:318-351,400-452`
- Modify: `README.md`

- [ ] **Step 1: Add the two-column header and continuous source styles**

Add styles that use the same `min-width: 900px` as the split rows and keep the branch labels visible at the top of the source surface:

```css
.source-compare { overflow-x: auto; }
.source-columns-header {
  min-width: 900px;
  display: grid;
  grid-template-columns: 1fr 1fr;
  position: sticky;
  top: 0;
  z-index: 4;
  background: #f8f4ec;
  border-bottom: 1px solid var(--line);
}
.source-columns-header > div {
  min-width: 0;
  padding: 10px 14px;
  display: flex;
  align-items: center;
  gap: 9px;
  border-right: 1px solid var(--line);
}
.source-columns-header span {
  color: var(--muted);
  font-size: 10px;
  font-weight: 750;
  letter-spacing: .08em;
}
.source-columns-header code {
  overflow: hidden;
  color: var(--ink);
  font-size: 11px;
  font-weight: 650;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.full-source-diff .split-cell.context { background: var(--card); }
.full-source-diff .split-cell.empty { background: #f1ede5; }
```

Ensure the source header and code rows share one horizontal scrolling container so headers stay aligned with columns. Keep long lines unwrapped and preserve the current line-number gutters.

- [ ] **Step 2: Update the local-tool README**

In the feature summary, state that file review defaults to complete base/target source and that the compact mode retains three lines of context. Do not add any absolute local path, browser-specific integration, or unrelated product name.

- [ ] **Step 3: Run formatting checks, all tests, and the production build**

Run:

```bash
npm run lint
npm test
git diff --check
```

Expected: ESLint exits with status 0; `npm test` builds successfully and all Node tests pass; `git diff --check` reports no whitespace errors.

- [ ] **Step 4: Verify the shipped files contain no prohibited local coupling**

Run:

```bash
rg -n "/Users/|tabbit|Tabbit|Chrome|Google Chrome" app server tests README.md package.json
```

Expected: no committed runtime coupling to a user-specific absolute path, unrelated product name, or named browser. `DEFAULT_REPO` must already be empty and the last repository must be restored only from browser-local storage as implemented in Task 2.

- [ ] **Step 5: Commit the visual and documentation slice**

```bash
git add app/globals.css README.md
git commit -m "style: clarify full-source branch review"
```

- [ ] **Step 6: Confirm final repository state**

Run:

```bash
git status --short --branch
git log -4 --oneline --decorate
```

Expected: the implementation commits are present; no unrelated file is staged; any pre-existing untracked files remain untouched unless explicitly included by this plan.
