"use client";

import { FormEvent, ReactNode, useEffect, useMemo, useState } from "react";

const API_URL = process.env.NEXT_PUBLIC_GIT_DIFF_API_URL || "http://127.0.0.1:3101";
const DEFAULT_REPO = "";

type Branch = {
  name: string;
  type: "local" | "remote";
  current: boolean;
  updatedAt: string;
};

type ChangedFile = {
  path: string;
  oldPath?: string;
  status: "added" | "deleted" | "modified" | "renamed" | "copied";
  additions: number;
  deletions: number;
  binary: boolean;
};

type Comparison = {
  repoPath: string;
  base: string;
  target: string;
  baseSha: string;
  targetSha: string;
  mergeBase: string;
  commitsAhead: number;
  commitsBehind: number;
  additions: number;
  deletions: number;
  files: ChangedFile[];
};

type DiffRow = {
  kind: "context" | "added" | "deleted" | "hunk" | "meta";
  oldNumber?: number;
  newNumber?: number;
  content: string;
};

type SplitRow = {
  kind: "code" | "hunk" | "meta";
  left?: DiffRow;
  right?: DiffRow;
  content?: string;
};

async function post<T>(path: string, payload: object): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch {
    throw new Error("无法连接本地 Git 服务，请确认 npm run dev 正在运行");
  }
  const value = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(value.error || "读取 Git 数据失败");
  return value;
}

function Icon({ children, size = 18 }: { children: ReactNode; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      {children}
    </svg>
  );
}

const icons = {
  branch: (
    <Icon>
      <circle cx="6" cy="5" r="2" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="18" cy="6" r="2" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="6" cy="19" r="2" stroke="currentColor" strokeWidth="1.8" />
      <path d="M6 7v10M8 12h3a7 7 0 0 0 7-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </Icon>
  ),
  folder: (
    <Icon>
      <path d="M3 7.5h7l2-2h9v13H3v-11Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    </Icon>
  ),
  search: (
    <Icon size={16}>
      <circle cx="11" cy="11" r="6" stroke="currentColor" strokeWidth="1.8" />
      <path d="m16 16 4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </Icon>
  ),
  refresh: (
    <Icon size={16}>
      <path d="M19 8a7 7 0 1 0 .6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M19 3v5h-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </Icon>
  ),
  swap: (
    <Icon size={16}>
      <path d="M7 7h12m0 0-3-3m3 3-3 3M17 17H5m0 0 3-3m-3 3 3 3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </Icon>
  ),
  chevron: (
    <Icon size={16}>
      <path d="m8 10 4 4 4-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </Icon>
  ),
  check: (
    <Icon size={16}>
      <path d="m5 12 4 4L19 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </Icon>
  ),
  menu: (
    <Icon size={20}>
      <path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </Icon>
  ),
};

function chooseDefaultBranches(branches: Branch[], current: string) {
  const names = new Set(branches.map((branch) => branch.name));
  const base = ["origin/master", "origin/main", "master", "main"].find((name) => names.has(name)) || branches[0]?.name || "HEAD";
  const currentIsMainline = ["master", "main", base].includes(current);
  const target = !currentIsMainline
    ? current
    : branches.find((branch) => branch.type === "local" && !["master", "main", base].includes(branch.name))?.name
      || branches.find((branch) => branch.name !== base)?.name
      || base;
  return { base, target };
}

function parseDiff(diff: string): DiffRow[] {
  const rows: DiffRow[] = [];
  let oldNumber = 0;
  let newNumber = 0;
  for (const line of diff.split("\n")) {
    const match = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/);
    if (match) {
      oldNumber = Number(match[1]);
      newNumber = Number(match[2]);
      rows.push({ kind: "hunk", content: line });
    } else if (line.startsWith("diff --git") || line.startsWith("index ") || line.startsWith("--- ") || line.startsWith("+++ ") || /^(new|deleted|old|new|similarity|rename) /.test(line)) {
      rows.push({ kind: "meta", content: line });
    } else if (line.startsWith("+") && !line.startsWith("+++")) {
      rows.push({ kind: "added", newNumber: newNumber++, content: line.slice(1) });
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      rows.push({ kind: "deleted", oldNumber: oldNumber++, content: line.slice(1) });
    } else if (line.startsWith(" ")) {
      rows.push({ kind: "context", oldNumber: oldNumber++, newNumber: newNumber++, content: line.slice(1) });
    } else if (line) {
      rows.push({ kind: "meta", content: line });
    }
  }
  return rows;
}

function toSplitRows(rows: DiffRow[]): SplitRow[] {
  const result: SplitRow[] = [];
  let index = 0;
  while (index < rows.length) {
    const row = rows[index];
    if (row.kind === "hunk" || row.kind === "meta") {
      result.push({ kind: row.kind, content: row.content });
      index += 1;
      continue;
    }
    if (row.kind === "context") {
      result.push({ kind: "code", left: row, right: row });
      index += 1;
      continue;
    }
    const changed: DiffRow[] = [];
    while (index < rows.length && (rows[index].kind === "added" || rows[index].kind === "deleted")) {
      changed.push(rows[index++]);
    }
    const deleted = changed.filter((item) => item.kind === "deleted");
    const added = changed.filter((item) => item.kind === "added");
    for (let offset = 0; offset < Math.max(deleted.length, added.length); offset += 1) {
      result.push({ kind: "code", left: deleted[offset], right: added[offset] });
    }
  }
  return result;
}

function fileName(path: string) {
  return path.split("/").at(-1) || path;
}

function directory(path: string) {
  const parts = path.split("/");
  return parts.length > 1 ? parts.slice(0, -1).join("/") : "仓库根目录";
}

function extension(path: string) {
  const ext = path.split(".").at(-1)?.toUpperCase() || "FILE";
  const aliases: Record<string, string> = { TSX: "TS", JSX: "JS", MARKDOWN: "MD", YML: "YAML" };
  return (aliases[ext] || ext).slice(0, 4);
}

function language(path: string) {
  const ext = path.split(".").at(-1)?.toLowerCase();
  const names: Record<string, string> = {
    py: "Python", ts: "TypeScript", tsx: "TypeScript React", js: "JavaScript", jsx: "JavaScript React",
    json: "JSON", md: "Markdown", css: "CSS", scss: "SCSS", html: "HTML", go: "Go", rs: "Rust",
    java: "Java", kt: "Kotlin", sql: "SQL", yaml: "YAML", yml: "YAML", sh: "Shell", vue: "Vue",
  };
  return names[ext || ""] || "文本";
}

function statusLabel(status: ChangedFile["status"]) {
  return { added: "新增", deleted: "删除", modified: "修改", renamed: "重命名", copied: "复制" }[status];
}

function fuzzyBranchScore(name: string, query: string) {
  const value = name.toLowerCase();
  const needle = query.trim().toLowerCase();
  if (!needle) return 0;
  if (value.startsWith(needle)) return 1;
  const directIndex = value.indexOf(needle);
  if (directIndex >= 0) return 10 + directIndex;
  let valueIndex = 0;
  let gapScore = 0;
  for (const character of needle) {
    const foundAt = value.indexOf(character, valueIndex);
    if (foundAt < 0) return null;
    gapScore += foundAt - valueIndex;
    valueIndex = foundAt + 1;
  }
  return 100 + gapScore;
}

function BranchSelect({ label, value, branches, onChange }: { label: string; value: string; branches: Branch[]; onChange: (value: string) => void }) {
  return (
    <label className="branch-field">
      <span>{label}</span>
      <div className="select-wrap">
        <select value={value} onChange={(event) => onChange(event.target.value)}>
          {branches.map((branch) => (
            <option key={`${branch.type}-${branch.name}`} value={branch.name}>
              {branch.name}{branch.type === "remote" ? " · 远端" : ""}
            </option>
          ))}
        </select>
        {icons.chevron}
      </div>
    </label>
  );
}

function SearchableBranchSelect({ label, value, branches, onChange }: { label: string; value: string; branches: Branch[]; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const matches = useMemo(() => branches
    .map((branch, index) => ({ branch, index, score: fuzzyBranchScore(branch.name, query) }))
    .filter((entry): entry is { branch: Branch; index: number; score: number } => entry.score !== null)
    .sort((left, right) => {
      if (!query && left.branch.name === value) return -1;
      if (!query && right.branch.name === value) return 1;
      return left.score - right.score || left.index - right.index;
    })
    .slice(0, 80)
    .map((entry) => entry.branch), [branches, query, value]);

  function close() {
    setOpen(false);
    setQuery("");
  }

  function selectBranch(branch: Branch) {
    onChange(branch.name);
    close();
  }

  return (
    <div className="branch-field">
      <span>{label}</span>
      <div className={`branch-search-wrap ${open ? "open" : ""}`}>
        <span className="combobox-search-icon">{icons.search}</span>
        <input
          role="combobox"
          aria-label={label}
          aria-expanded={open}
          aria-controls="target-branch-options"
          aria-autocomplete="list"
          value={open ? query : value}
          placeholder="搜索目标分支"
          onFocus={() => { setOpen(true); setQuery(""); }}
          onChange={(event) => { setOpen(true); setQuery(event.target.value); }}
          onBlur={() => window.setTimeout(close, 120)}
          onKeyDown={(event) => {
            if (event.key === "Escape") close();
            if (event.key === "Enter" && open && matches[0]) {
              event.preventDefault();
              selectBranch(matches[0]);
            }
          }}
        />
        <span className="combobox-chevron">{icons.chevron}</span>
        {open && (
          <div className="branch-search-dropdown" id="target-branch-options" role="listbox">
            <div className="branch-search-caption">{query ? `匹配 ${matches.length} 个分支` : "输入名称进行模糊搜索"}</div>
            {matches.map((branch) => (
              <button
                type="button"
                role="option"
                aria-selected={branch.name === value}
                className={branch.name === value ? "selected" : ""}
                key={`${branch.type}-${branch.name}`}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => selectBranch(branch)}
              >
                <span>{branch.name}</span>
                {branch.type === "remote" && <small>远端</small>}
                {branch.name === value && <i>{icons.check}</i>}
              </button>
            ))}
            {matches.length === 0 && <div className="branch-search-empty">没有匹配的分支</div>}
          </div>
        )}
      </div>
    </div>
  );
}

export function DiffViewer() {
  const [repoInput, setRepoInput] = useState(DEFAULT_REPO);
  const [repoPath, setRepoPath] = useState("");
  const [branches, setBranches] = useState<Branch[]>([]);
  const [base, setBase] = useState("");
  const [target, setTarget] = useState("");
  const [comparison, setComparison] = useState<Comparison | null>(null);
  const [selectedPath, setSelectedPath] = useState("");
  const [diff, setDiff] = useState("");
  const [diffTruncated, setDiffTruncated] = useState(false);
  const [search, setSearch] = useState("");
  const [pathFilter, setPathFilter] = useState("app/");
  const [filter, setFilter] = useState<"all" | "unread" | "added">("all");
  const [readFiles, setReadFiles] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<"unified" | "split">("unified");
  const [loadingRepo, setLoadingRepo] = useState(false);
  const [loadingCompare, setLoadingCompare] = useState(false);
  const [loadingDiff, setLoadingDiff] = useState(false);
  const [error, setError] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    const lastRepository = localStorage.getItem("branch-review:last-repo");
    if (!lastRepository) return;
    const frame = window.requestAnimationFrame(() => setRepoInput(lastRepository));
    return () => window.cancelAnimationFrame(frame);
  }, []);

  const selectedFile = comparison?.files.find((file) => file.path === selectedPath);
  const rows = useMemo(() => parseDiff(diff), [diff]);
  const splitRows = useMemo(() => toSplitRows(rows), [rows]);

  const filteredFiles = useMemo(() => {
    if (!comparison) return [];
    const query = search.trim().toLowerCase();
    const pathPrefix = pathFilter.trim().replace(/^\.\//, "").toLowerCase();
    return comparison.files.filter((file) => {
      if (pathPrefix && !file.path.toLowerCase().startsWith(pathPrefix)) return false;
      if (query && !file.path.toLowerCase().includes(query)) return false;
      if (filter === "unread" && readFiles.has(file.path)) return false;
      if (filter === "added" && file.status !== "added") return false;
      return true;
    });
  }, [comparison, filter, pathFilter, readFiles, search]);

  const pathSuggestions = useMemo(() => {
    if (!comparison) return [];
    return [...new Set(comparison.files
      .filter((file) => file.path.includes("/"))
      .map((file) => `${file.path.split("/")[0]}/`))]
      .sort();
  }, [comparison]);

  const groups = useMemo(() => {
    const map = new Map<string, ChangedFile[]>();
    for (const file of filteredFiles) {
      const group = file.path.includes("/") ? file.path.split("/")[0] : "根目录";
      map.set(group, [...(map.get(group) || []), file]);
    }
    return [...map.entries()];
  }, [filteredFiles]);

  async function loadRepository(event?: FormEvent) {
    event?.preventDefault();
    setLoadingRepo(true);
    setError("");
    try {
      const data = await post<{ repoPath: string; branches: Branch[]; current: string }>("/api/repository", { path: repoInput });
      if (!data.branches.length) throw new Error("该仓库没有可比较的分支");
      const defaults = chooseDefaultBranches(data.branches, data.current);
      setRepoPath(data.repoPath);
      setRepoInput(data.repoPath);
      setBranches(data.branches);
      setBase(defaults.base);
      setTarget(defaults.target);
      setComparison(null);
      setSelectedPath("");
      setDiff("");
      setReadFiles(new Set());
      localStorage.setItem("branch-review:last-repo", data.repoPath);
      await runComparison(data.repoPath, defaults.base, defaults.target);
    } catch (value) {
      setError(value instanceof Error ? value.message : "加载仓库失败");
    } finally {
      setLoadingRepo(false);
    }
  }

  async function runComparison(path = repoPath, baseRef = base, targetRef = target) {
    if (!path || !baseRef || !targetRef) return;
    setLoadingCompare(true);
    setError("");
    try {
      const data = await post<Comparison>("/api/compare", { repoPath: path, base: baseRef, target: targetRef });
      const defaultPath = data.files.some((file) => file.path.startsWith("app/")) ? "app/" : "";
      const firstVisibleFile = data.files.find((file) => !defaultPath || file.path.startsWith(defaultPath));
      setComparison(data);
      setReadFiles(new Set());
      setPathFilter(defaultPath);
      setSearch("");
      setFilter("all");
      setSelectedPath(firstVisibleFile?.path || "");
      setDiff("");
      if (firstVisibleFile) await loadFileDiff(firstVisibleFile, path, baseRef, targetRef);
    } catch (value) {
      setError(value instanceof Error ? value.message : "比较分支失败");
    } finally {
      setLoadingCompare(false);
    }
  }

  async function loadFileDiff(file: ChangedFile, path = repoPath, baseRef = base, targetRef = target) {
    setSelectedPath(file.path);
    setSidebarOpen(false);
    setLoadingDiff(true);
    setDiff("");
    setDiffTruncated(false);
    try {
      const data = await post<{ diff: string; truncated: boolean }>("/api/diff", {
        repoPath: path,
        base: baseRef,
        target: targetRef,
        path: file.path,
        oldPath: file.oldPath,
      });
      setDiff(data.diff);
      setDiffTruncated(data.truncated);
    } catch (value) {
      setError(value instanceof Error ? value.message : "读取文件差异失败");
    } finally {
      setLoadingDiff(false);
    }
  }

  function swapBranches() {
    const nextBase = target;
    const nextTarget = base;
    setBase(nextBase);
    setTarget(nextTarget);
    void runComparison(repoPath, nextBase, nextTarget);
  }

  function toggleRead() {
    if (!selectedFile) return;
    setReadFiles((current) => {
      const next = new Set(current);
      if (next.has(selectedFile.path)) next.delete(selectedFile.path);
      else next.add(selectedFile.path);
      return next;
    });
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <button className="mobile-menu" onClick={() => setSidebarOpen(true)} aria-label="打开文件目录">{icons.menu}</button>
          <span className="brand-mark">BR</span>
          <div>
            <strong>Branch Review</strong>
            <span>本地只读分支审阅</span>
          </div>
        </div>
        <form className="repo-form" onSubmit={loadRepository}>
          <span className="repo-icon">{icons.folder}</span>
          <input value={repoInput} onChange={(event) => setRepoInput(event.target.value)} aria-label="本地 Git 仓库路径" placeholder="输入本地 Git 仓库绝对路径" />
          <button type="submit" disabled={loadingRepo}>{loadingRepo ? "读取中…" : "加载仓库"}</button>
        </form>
        <div className="readonly-badge"><span /> 只读模式</div>
      </header>

      <section className="comparebar">
        <div className="compare-title">
          <span className="branch-icon">{icons.branch}</span>
          <div><strong>{repoPath ? repoPath.split("/").at(-1) : "选择一个仓库"}</strong><span>{repoPath || "仓库内容始终保持不变"}</span></div>
        </div>
        <div className="branch-picker">
          <BranchSelect label="基准分支" value={base} branches={branches} onChange={setBase} />
          <button className="swap-button" onClick={swapBranches} disabled={!repoPath} aria-label="交换分支">{icons.swap}</button>
          <SearchableBranchSelect label="目标分支" value={target} branches={branches} onChange={setTarget} />
          <button className="compare-button" onClick={() => void runComparison()} disabled={!repoPath || loadingCompare}>
            {loadingCompare ? "比较中…" : <>{icons.refresh} 比较差异</>}
          </button>
        </div>
      </section>

      {error && <div className="error-banner"><strong>读取失败</strong><span>{error}</span><button onClick={() => setError("")}>×</button></div>}

      <div className="workspace">
        {sidebarOpen && <button className="sidebar-scrim" onClick={() => setSidebarOpen(false)} aria-label="关闭文件目录" />}
        <aside className={`file-sidebar ${sidebarOpen ? "open" : ""}`}>
          <div className="sidebar-heading">
            <div><span>审阅目录</span><strong>{comparison && filteredFiles.length !== comparison.files.length ? `${filteredFiles.length} / ${comparison.files.length}` : comparison?.files.length || 0} 个文件</strong></div>
            <span className="read-progress">已读 {readFiles.size}</span>
          </div>
          <label className="path-filter-box">
            <span>{icons.folder}</span>
            <input list="changed-path-prefixes" value={pathFilter} onChange={(event) => setPathFilter(event.target.value)} placeholder="路径前缀，例如 app/services/" aria-label="按文件路径过滤" />
            {pathFilter && <button type="button" onClick={() => setPathFilter("")} aria-label="清除路径过滤">×</button>}
            <datalist id="changed-path-prefixes">
              {pathSuggestions.map((path) => <option value={path} key={path} />)}
            </datalist>
          </label>
          <div className="search-box">{icons.search}<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索文件" /></div>
          <div className="sidebar-filters">
            <button className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}>全部</button>
            <button className={filter === "unread" ? "active" : ""} onClick={() => setFilter("unread")}>未读</button>
            <button className={filter === "added" ? "active" : ""} onClick={() => setFilter("added")}>仅新增</button>
          </div>
          <div className="file-groups">
            {groups.map(([group, files]) => (
              <section className="file-group" key={group}>
                <h3>{group}<span>{files.length}</span></h3>
                {files.map((file) => (
                  <button className={`file-item ${file.path === selectedPath ? "selected" : ""}`} key={file.path} onClick={() => void loadFileDiff(file)}>
                    <span className={`file-type status-${file.status}`}>{extension(file.path)}</span>
                    <span className="file-copy"><strong>{fileName(file.path)}</strong><small>{directory(file.path)}</small></span>
                    <span className="file-stats"><i>+{file.additions}</i>{file.deletions > 0 && <b>−{file.deletions}</b>}</span>
                    {readFiles.has(file.path) && <span className="read-check">{icons.check}</span>}
                  </button>
                ))}
              </section>
            ))}
            {comparison && filteredFiles.length === 0 && <div className="empty-sidebar">没有符合条件的文件</div>}
          </div>
        </aside>

        <article className="review-document">
          {!comparison && !loadingCompare ? (
            <section className="welcome-card">
              <span className="welcome-mark">{icons.branch}</span>
              <p>LOCAL GIT REVIEW</p>
              <h1>像读文档一样<br />阅读分支改动</h1>
              <span>输入任意本地 Git 仓库路径，选择两个分支。工具只读取提交和差异，不会 checkout，也不会修改任何文件。</span>
              <button onClick={() => void loadRepository()}>{icons.folder} 加载当前路径</button>
            </section>
          ) : (
            <>
              <section className="document-intro">
                <p>以文件为章节，逐段阅读这次改动。工作区内容不会被修改。</p>
                <div className="range-title"><code>{comparison?.base}</code><span>→</span><code>{comparison?.target}</code></div>
              </section>

              <section className="summary-card">
                <div className="summary-lead">
                  <p>这次比较包含 <strong>{comparison?.files.length || 0}</strong> 个文件</p>
                  <span>目标分支领先 {comparison?.commitsAhead || 0} 个提交 · 基于共同祖先比较</span>
                </div>
                <div className="summary-stat"><span>文件</span><strong>{comparison?.files.length || 0}</strong></div>
                <div className="summary-stat added"><span>新增行</span><strong>+{comparison?.additions || 0}</strong></div>
                <div className="summary-stat deleted"><span>删除行</span><strong>−{comparison?.deletions || 0}</strong><div className="change-bar"><i style={{ width: `${comparison && comparison.additions + comparison.deletions ? (comparison.additions / (comparison.additions + comparison.deletions)) * 100 : 50}%` }} /></div></div>
              </section>

              <nav className="document-toolbar">
                <div>
                  <button className={mode === "unified" ? "active" : ""} onClick={() => setMode("unified")}>统一视图</button>
                  <button className={mode === "split" ? "active" : ""} onClick={() => setMode("split")}>左右对比</button>
                </div>
                <span>保留 3 行上下文 · 大文件按需读取</span>
              </nav>

              {selectedFile ? (
                <section className="chapter">
                  <div className="chapter-label"><span>正在阅读</span><i /></div>
                  <div className="diff-card">
                    <header className="diff-header">
                      <div className="diff-title"><span className={`file-type status-${selectedFile.status}`}>{extension(selectedFile.path)}</span><div><strong>{fileName(selectedFile.path)}</strong><span>{directory(selectedFile.path)}</span></div></div>
                      <div className="diff-actions"><span className="status-pill">{statusLabel(selectedFile.status)}</span><i>+{selectedFile.additions}</i>{selectedFile.deletions > 0 && <b>−{selectedFile.deletions}</b>}<button className={readFiles.has(selectedFile.path) ? "read" : ""} onClick={toggleRead}>{readFiles.has(selectedFile.path) ? <>{icons.check} 已读</> : "标为已读"}</button></div>
                    </header>
                    <div className="diff-meta"><span>{language(selectedFile.path)}</span><code>{selectedFile.path}</code>{selectedFile.oldPath && <span>从 {selectedFile.oldPath} 重命名</span>}</div>
                    {loadingDiff ? <div className="diff-loading"><span /><span /><span /><span /></div> : diffTruncated ? (
                      <div className="diff-message"><strong>文件差异过大</strong><span>为保持页面流畅，超过 2 MB 的单文件差异不在页面中加载。</span></div>
                    ) : selectedFile.binary ? (
                      <div className="diff-message"><strong>二进制文件</strong><span>Git 检测到内容变化，但无法按行显示。</span></div>
                    ) : !diff ? (
                      <div className="diff-message"><strong>没有可显示的文本差异</strong><span>文件可能只有模式或元数据发生变化。</span></div>
                    ) : mode === "unified" ? (
                      <div className="unified-diff" role="table" aria-label={`${selectedFile.path} 统一差异`}>
                        {rows.map((row, index) => <DiffLine key={index} row={row} />)}
                      </div>
                    ) : (
                      <div className="split-diff" role="table" aria-label={`${selectedFile.path} 左右差异`}>
                        {splitRows.map((row, index) => <SplitLine key={index} row={row} />)}
                      </div>
                    )}
                  </div>
                </section>
              ) : (
                <div className="diff-message standalone"><strong>两个分支没有文件差异</strong><span>它们在共同祖先之后的内容保持一致。</span></div>
              )}
            </>
          )}
        </article>
      </div>
    </main>
  );
}

function DiffLine({ row }: { row: DiffRow }) {
  if (row.kind === "hunk" || row.kind === "meta") {
    return <div className={`diff-line ${row.kind}`}><code>{row.content}</code></div>;
  }
  const marker = row.kind === "added" ? "+" : row.kind === "deleted" ? "−" : "";
  return (
    <div className={`diff-line ${row.kind}`}>
      <span className="line-number">{row.oldNumber ?? ""}</span>
      <span className="line-number">{row.newNumber ?? ""}</span>
      <span className="line-marker">{marker}</span>
      <code>{row.content || " "}</code>
    </div>
  );
}

function SplitLine({ row }: { row: SplitRow }) {
  if (row.kind === "hunk" || row.kind === "meta") {
    return <div className={`split-meta ${row.kind}`}><code>{row.content}</code></div>;
  }
  return (
    <div className="split-line">
      <SplitCell row={row.left} side="left" />
      <SplitCell row={row.right} side="right" />
    </div>
  );
}

function SplitCell({ row, side }: { row?: DiffRow; side: "left" | "right" }) {
  const lineNumber = side === "left" ? row?.oldNumber : row?.newNumber;
  return (
    <div className={`split-cell ${row?.kind || "empty"}`}>
      <span className="line-number">{lineNumber ?? ""}</span>
      <span className="line-marker">{row?.kind === "added" ? "+" : row?.kind === "deleted" ? "−" : ""}</span>
      <code>{row?.content || " "}</code>
    </div>
  );
}
