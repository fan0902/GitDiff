# GitDiff Change Block Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a compact, sticky previous/next control that moves through contiguous code-change blocks in both full-source and compact diff modes.

**Architecture:** Keep Git and diff APIs unchanged. Derive stable change-block metadata from the existing aligned split rows in a small pure TypeScript module, then let `DiffViewer` own only the current index, scoped DOM lookup, and scrolling behavior. Render navigation in the target-source sticky header and express the current block with additive CSS borders so existing red/green backgrounds remain intact.

**Tech Stack:** React 19, TypeScript, CSS, Node test runner, vinext build

---

## File structure

- Create `app/change-navigation.ts`: pure block grouping and cyclic-index helpers; no React or DOM dependency.
- Create `tests/change-navigation.test.mjs`: behavior tests for grouping, block boundaries, pure deletion, and cyclic navigation.
- Modify `app/DiffViewer.tsx`: derive annotated rows, manage the current block, scroll within the source container, render controls and anchors.
- Modify `app/globals.css`: compact header controls and non-destructive current-block emphasis.
- Modify `tests/rendered-html.test.mjs`: assert the shipped viewer exposes the navigation contract and avoids global DOM queries.
- Modify `package.json`: include all `tests/*.test.mjs` files in the test command.

### Task 1: Pure change-block model

**Files:**
- Create: `app/change-navigation.ts`
- Create: `tests/change-navigation.test.mjs`
- Modify: `package.json`

- [ ] **Step 1: Write failing grouping and wraparound tests**

Create `tests/change-navigation.test.mjs` with fixtures that use the same structural fields as `SplitRow`:

```js
import assert from "node:assert/strict";
import test from "node:test";
import { markChangeBlocks, wrapChangeIndex } from "../app/change-navigation.ts";

const context = (number) => ({
  kind: "code",
  left: { kind: "context", oldNumber: number, content: `line ${number}` },
  right: { kind: "context", newNumber: number, content: `line ${number}` },
});

test("groups adjacent changed rows and splits them at context or metadata", () => {
  const result = markChangeBlocks([
    context(1),
    { kind: "code", left: { kind: "deleted", content: "old" }, right: { kind: "added", content: "new" } },
    { kind: "code", right: { kind: "added", content: "more" } },
    context(4),
    { kind: "hunk", content: "@@ -8 +8 @@" },
    { kind: "code", left: { kind: "deleted", content: "gone" } },
  ]);

  assert.equal(result.count, 2);
  assert.deepEqual(result.rows.map((row) => row.changeIndex), [undefined, 0, 0, undefined, undefined, 1]);
  assert.equal(result.rows[1].changeStart, true);
  assert.equal(result.rows[2].changeEnd, true);
  assert.equal(result.rows[5].changeStart, true);
  assert.equal(result.rows[5].changeEnd, true);
});

test("treats a pure deletion as a navigable block", () => {
  const result = markChangeBlocks([{ kind: "code", left: { kind: "deleted", content: "gone" } }]);
  assert.equal(result.count, 1);
  assert.equal(result.rows[0].changeIndex, 0);
});

test("wraps previous and next navigation", () => {
  assert.equal(wrapChangeIndex(0, 1, 3), 1);
  assert.equal(wrapChangeIndex(2, 1, 3), 0);
  assert.equal(wrapChangeIndex(0, -1, 3), 2);
  assert.equal(wrapChangeIndex(0, 1, 1), 0);
});
```

Change the test script to run every `.test.mjs` file:

```json
"test": "npm run build && node --disable-warning=ExperimentalWarning --experimental-strip-types --test tests/*.test.mjs"
```

- [ ] **Step 2: Run tests and verify the new test fails**

Run: `node --disable-warning=ExperimentalWarning --experimental-strip-types --test tests/change-navigation.test.mjs`

Expected: FAIL because `app/change-navigation.ts` does not exist.

- [ ] **Step 3: Implement the pure helpers**

Create `app/change-navigation.ts` with structural types and immutable annotation:

```ts
type NavigableRow = {
  kind: string;
  left?: { kind: string };
  right?: { kind: string };
};

export type ChangeMarkedRow<T> = T & {
  changeIndex?: number;
  changeStart?: boolean;
  changeEnd?: boolean;
};

function isChanged(row: NavigableRow) {
  return row.kind === "code" && (row.left?.kind === "deleted" || row.right?.kind === "added");
}

export function markChangeBlocks<T extends NavigableRow>(rows: readonly T[]) {
  let count = 0;
  let previousWasChanged = false;
  const marked: ChangeMarkedRow<T>[] = rows.map((row) => {
    const changed = isChanged(row);
    if (!changed) {
      previousWasChanged = false;
      return { ...row };
    }
    if (!previousWasChanged) count += 1;
    previousWasChanged = true;
    return { ...row, changeIndex: count - 1 };
  });

  for (let index = 0; index < marked.length; index += 1) {
    const row = marked[index];
    if (row.changeIndex === undefined) continue;
    row.changeStart = marked[index - 1]?.changeIndex !== row.changeIndex;
    row.changeEnd = marked[index + 1]?.changeIndex !== row.changeIndex;
  }

  return { rows: marked, count };
}

export function wrapChangeIndex(current: number, direction: -1 | 1, count: number) {
  if (count <= 0) return 0;
  return (current + direction + count) % count;
}
```

- [ ] **Step 4: Run the focused tests and verify they pass**

Run: `node --disable-warning=ExperimentalWarning --experimental-strip-types --test tests/change-navigation.test.mjs`

Expected: 3 tests pass, 0 fail.

- [ ] **Step 5: Commit the pure model**

```bash
git add app/change-navigation.ts tests/change-navigation.test.mjs package.json
git commit -m "feat: model navigable change blocks"
```

### Task 2: Viewer navigation and scoped scrolling

**Files:**
- Modify: `app/DiffViewer.tsx`
- Modify: `tests/rendered-html.test.mjs`

- [ ] **Step 1: Add a failing shipped-source contract test**

Extend `tests/rendered-html.test.mjs`:

```js
test("the diff viewer exposes scoped change-block navigation", async () => {
  const source = await readFile(new URL("../app/DiffViewer.tsx", import.meta.url), "utf8");
  assert.match(source, /aria-label="代码变更导航"/);
  assert.match(source, /上一处/);
  assert.match(source, /下一处/);
  assert.match(source, /data-change-index/);
  assert.match(source, /sourceCompareRef\.current\?\.querySelector/);
  assert.doesNotMatch(source, /document\.querySelector/);
});
```

- [ ] **Step 2: Run the contract test and verify it fails**

Run: `npm run build && node --test tests/rendered-html.test.mjs`

Expected: the new navigation test fails because the controls and scoped anchor lookup do not exist.

- [ ] **Step 3: Derive blocks and reset navigation state**

In `app/DiffViewer.tsx`:

- Import `useRef`, `markChangeBlocks`, and `wrapChangeIndex`.
- Add `currentChangeIndex` state initialized to `0` and `sourceCompareRef` initialized to `null`.
- Derive `{ rows: navigableRows, count: changeCount }` from `splitRows` with `useMemo`.
- Reset the index immediately when loading a file and comparison.
- Add an effect keyed by selected path, mode, active diff text, and count. It sets index `0`, waits one animation frame for anchors to render, then scrolls to block `0`. It cancels the frame on cleanup.

Use this scoped scroll calculation:

```ts
function scrollToChange(index: number) {
  const container = sourceCompareRef.current;
  const anchor = container?.querySelector<HTMLElement>(`[data-change-index="${index}"]`);
  if (!container || !anchor) return;
  const header = container.querySelector<HTMLElement>(".source-columns-header");
  const top = container.scrollTop
    + anchor.getBoundingClientRect().top
    - container.getBoundingClientRect().top
    - (header?.offsetHeight || 0)
    - 12;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  container.scrollTo({ top: Math.max(0, top), behavior: reducedMotion ? "auto" : "smooth" });
}
```

Add `navigateChanges(direction)` using `wrapChangeIndex`, then update state and scroll to the resulting index. Manual container scrolling must not update the state.

- [ ] **Step 4: Render sticky controls and block anchors**

- Attach `ref={sourceCompareRef}` to `.source-compare`.
- Keep the base-source header unchanged.
- Wrap the target label/ref in `.source-column-title` and add a `<nav aria-label="代码变更导航">` only when `changeCount > 0`.
- Render `变更 {currentChangeIndex + 1} / {changeCount}`, `上一处`, and `下一处`.
- Compute each button's full `aria-label` with its wrapped destination.
- Render `navigableRows`, passing `currentChangeIndex` to `SplitLine`.
- On the first row in each block, add `data-change-index={row.changeIndex}`. This includes rows with a deleted left cell and empty right cell.
- Add `current-change`, `change-start`, and `change-end` classes without changing the existing cell kind classes.

- [ ] **Step 5: Run build and contract tests**

Run: `npm run build && node --test tests/rendered-html.test.mjs`

Expected: build succeeds and all rendered/source contract tests pass.

- [ ] **Step 6: Commit viewer behavior**

```bash
git add app/DiffViewer.tsx tests/rendered-html.test.mjs
git commit -m "feat: navigate between code change blocks"
```

### Task 3: Clear, restrained visual treatment

**Files:**
- Modify: `app/globals.css`

- [ ] **Step 1: Add navigation layout styles**

Add `.source-column-title` and `.change-navigation` rules that keep the target branch label ellipsized while pinning a small text control group to the right. Buttons use the existing card, line, muted, and accent colors; hover and focus-visible states remain obvious. At narrow widths, hide the branch ref before hiding navigation.

- [ ] **Step 2: Add additive current-block emphasis**

Use inset side rules on every `.split-line.current-change` and subtle top/bottom rules on `.change-start` / `.change-end`. Do not set `background`, so `.added`, `.deleted`, `.context`, and `.empty` retain their existing colors.

Representative CSS:

```css
.split-line.current-change .split-cell:first-child { box-shadow: inset 3px 0 rgba(164,89,65,.42); }
.split-line.current-change .split-cell:last-child { box-shadow: inset -3px 0 rgba(164,89,65,.42); }
.split-line.current-change.change-start .split-cell { border-top: 1px solid rgba(164,89,65,.3); }
.split-line.current-change.change-end .split-cell { border-bottom: 1px solid rgba(164,89,65,.3); }
```

- [ ] **Step 3: Run lint and the complete test suite**

Run: `npm run lint`

Expected: exits 0.

Run: `npm test`

Expected: build succeeds; 7 tests pass, 0 fail.

- [ ] **Step 4: Commit styling**

```bash
git add app/globals.css
git commit -m "style: clarify active code change block"
```

### Task 4: Integration and local application delivery

**Files:**
- No source changes expected.

- [ ] **Step 1: Verify scope and repository hygiene**

Run:

```bash
git diff --check main...HEAD
git diff --stat main...HEAD
git status --short
rg -n "/Users/|tabbit|Tabbit" app tests packaging README.md package.json
```

Expected: no whitespace errors; only planned files differ; worktree is clean; no user-specific paths or prohibited browser/product coupling were introduced.

- [ ] **Step 2: Review final commits and merge into local main**

Run `git log --oneline main..HEAD`, then merge the completed feature branch into `main` from the primary checkout with a fast-forward when possible. Do not push.

- [ ] **Step 3: Verify main after integration**

Run `npm test` and `npm run lint` in the primary checkout.

Expected: build, all tests, and lint pass.

- [ ] **Step 4: Sync only tracked source into the installed GitDiff site**

Create a clean temporary archive from `main`, extract it into the existing GitDiff runtime site directory without copying `.git`, local absolute paths, worktrees, or unrelated untracked files. Preserve runtime-only files unless the existing deployment script documents a narrower replacement procedure.

- [ ] **Step 5: Restart and verify GitDiff**

Restart the local GitDiff application, wait for both services to be healthy, then verify:

```text
http://127.0.0.1:9002
http://127.0.0.1:3101/health
```

Open a repository comparison with multiple change blocks and confirm first-block positioning, cyclic previous/next navigation, pure-deletion anchoring, both display modes, and retained red/green backgrounds.

- [ ] **Step 6: Report delivery without pushing**

Report the local commit IDs, test/lint results, installed app health, and explicitly state that no remote push was performed.
