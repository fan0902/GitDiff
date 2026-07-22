import { git, isShallowRepository, resolveCommit } from "./git-runtime.mjs";

const UNIQUE_LIMIT = 12;
const COMMON_LIMIT = 4;
const FIELD = "\u001f";

async function readCommit(repoPath, sha, scope) {
  const format = ["%H", "%P", "%s", "%an", "%aI"].join("%x1f");
  const output = (await git(repoPath, ["show", "--no-patch", `--format=${format}`, sha])).trim();
  const [resolvedSha, parents, subject, author, authoredAt] = output.split(FIELD);
  return {
    id: resolvedSha,
    sha: resolvedSha,
    shortSha: resolvedSha.slice(0, 8),
    parents: parents ? parents.split(" ") : [],
    subject,
    author,
    authoredAt,
    scope,
    kind: "commit",
    annotation: "",
  };
}

async function revList(repoPath, args) {
  const output = await git(repoPath, ["rev-list", ...args]);
  return output.trim().split("\n").filter(Boolean);
}

async function readRange(repoPath, args, scope) {
  const shas = await revList(repoPath, args);
  return Promise.all(shas.map((sha) => readCommit(repoPath, sha, scope)));
}

function collapse(nodes, scope) {
  if (nodes.length <= UNIQUE_LIMIT) return nodes;
  const hidden = nodes.slice(0, nodes.length - UNIQUE_LIMIT);
  const visible = nodes.slice(-UNIQUE_LIMIT);
  return [{
    id: `collapsed:${scope}:${hidden[0].sha}:${hidden.at(-1).sha}`,
    shortSha: "…",
    parents: hidden[0].parents,
    scope,
    kind: "collapsed",
    subject: `省略 ${hidden.length} 个提交`,
    author: "",
    authoredAt: "",
    annotation: `省略 ${hidden.length} 个提交`,
    collapsedCount: hidden.length,
    nextSha: visible[0].sha,
  }, ...visible];
}

function focusAnnotation(scope) {
  if (scope === "common") return "指定提交 · 位于共同历史";
  if (scope === "base") return "指定提交 · 仅位于基准分支";
  if (scope === "target") return "指定提交 · 仅位于目标分支";
  return "与当前分支对无祖先关系";
}

function withMergeNote(node, annotation) {
  return node.parents.length > 1
    ? `${annotation} · Merge commit · 包含 ${node.parents.length} 个父提交`
    : annotation;
}

function decorate(node, { baseSha, targetSha, mergeBase, focusSha }) {
  if (node.kind === "collapsed") return node;
  if (node.sha === focusSha) {
    return { ...node, kind: "focus", annotation: withMergeNote(node, focusAnnotation(node.scope)) };
  }
  if (node.sha === baseSha && node.sha === targetSha) {
    return { ...node, kind: "head", annotation: withMergeNote(node, "基准与目标分支 HEAD") };
  }
  if (node.sha === baseSha) {
    return { ...node, kind: "head", annotation: withMergeNote(node, "基准分支 HEAD") };
  }
  if (node.sha === targetSha) {
    return { ...node, kind: "head", annotation: withMergeNote(node, "目标分支 HEAD") };
  }
  if (node.sha === mergeBase) {
    return {
      ...node,
      kind: "merge-base",
      annotation: withMergeNote(node, "共同祖先 · 两个分支最后共有的提交"),
    };
  }
  if (node.parents.length > 1) {
    return { ...node, kind: "merge", annotation: `Merge commit · 包含 ${node.parents.length} 个父提交` };
  }
  return node;
}

async function mergeBaseFor(repoPath, baseSha, targetSha) {
  try {
    return (await git(repoPath, ["merge-base", baseSha, targetSha])).trim() || null;
  } catch (error) {
    if (error?.code === 1) return null;
    throw error;
  }
}

async function isAncestor(repoPath, ancestor, descendant) {
  try {
    await git(repoPath, ["merge-base", "--is-ancestor", ancestor, descendant]);
    return true;
  } catch (error) {
    if (error?.code === 1) return false;
    throw error;
  }
}

async function relationForFocus(repoPath, focusSha, baseSha, targetSha) {
  const [inBase, inTarget] = await Promise.all([
    isAncestor(repoPath, focusSha, baseSha),
    isAncestor(repoPath, focusSha, targetSha),
  ]);
  if (inBase && inTarget) return "common";
  if (inBase) return "base";
  if (inTarget) return "target";
  return "unrelated";
}

async function extendToFocus(repoPath, nodes, scope, focusSha, headSha) {
  if (!focusSha || nodes.some((node) => node.sha === focusSha)) return nodes;
  const pathShas = await revList(repoPath, ["--reverse", "--ancestry-path", `${focusSha}..${headSha}`]);
  const extended = await Promise.all([focusSha, ...pathShas].map((sha) => readCommit(repoPath, sha, scope)));
  const existing = new Set(extended.map((node) => node.sha));
  return [...extended, ...nodes.filter((node) => !existing.has(node.sha))];
}

export async function buildCommitGraph(repoPath, base, target, focusCommit) {
  const [baseSha, targetSha] = await Promise.all([
    resolveCommit(repoPath, base),
    resolveCommit(repoPath, target),
  ]);
  const [mergeBase, focusSha] = await Promise.all([
    mergeBaseFor(repoPath, baseSha, targetSha),
    focusCommit ? resolveCommit(repoPath, focusCommit, "提交") : undefined,
  ]);
  const focusRelation = focusSha
    ? await relationForFocus(repoPath, focusSha, baseSha, targetSha)
    : undefined;
  const [aheadText, behindText, shallow] = await Promise.all([
    git(repoPath, ["rev-list", "--count", `${baseSha}..${targetSha}`]),
    git(repoPath, ["rev-list", "--count", `${targetSha}..${baseSha}`]),
    isShallowRepository(repoPath),
  ]);

  let commonNodes = [];
  let baseNodes;
  let targetNodes;
  if (mergeBase) {
    [commonNodes, baseNodes, targetNodes] = await Promise.all([
      readRange(repoPath, ["--reverse", "--first-parent", `--max-count=${COMMON_LIMIT}`, mergeBase], "common"),
      readRange(repoPath, ["--reverse", "--topo-order", `${mergeBase}..${baseSha}`], "base"),
      readRange(repoPath, ["--reverse", "--topo-order", `${mergeBase}..${targetSha}`], "target"),
    ]);
  } else {
    [baseNodes, targetNodes] = await Promise.all([
      readRange(repoPath, ["--reverse", `--max-count=${UNIQUE_LIMIT}`, baseSha], "base"),
      readRange(repoPath, ["--reverse", `--max-count=${UNIQUE_LIMIT}`, targetSha], "target"),
    ]);
  }

  if (focusSha && focusRelation === "common" && mergeBase) {
    commonNodes = await extendToFocus(repoPath, commonNodes, "common", focusSha, mergeBase);
  }
  if (focusSha && focusRelation === "base") {
    baseNodes = await extendToFocus(repoPath, baseNodes, "base", focusSha, baseSha);
  }
  if (focusSha && focusRelation === "target") {
    targetNodes = await extendToFocus(repoPath, targetNodes, "target", focusSha, targetSha);
  }

  const focusNode = focusSha && focusRelation === "unrelated"
    ? {
        ...(await readCommit(repoPath, focusSha, "unrelated")),
        kind: "focus",
        annotation: focusAnnotation("unrelated"),
      }
    : undefined;
  const visibleBase = focusRelation === "base" ? baseNodes : collapse(baseNodes, "base");
  const visibleTarget = focusRelation === "target" ? targetNodes : collapse(targetNodes, "target");
  const nodes = [...commonNodes, ...visibleBase, ...visibleTarget]
    .map((node) => decorate(node, { baseSha, targetSha, mergeBase, focusSha }));
  return {
    base: { name: base, sha: baseSha },
    target: { name: target, sha: targetSha },
    mergeBase,
    ahead: Number(aheadText.trim()),
    behind: Number(behindText.trim()),
    historyComplete: !shallow,
    disconnected: !mergeBase,
    nodes,
    ...(focusSha ? {
      focus: {
        sha: focusSha,
        relation: focusRelation,
        ...(focusNode ? { node: focusNode } : {}),
      },
    } : {}),
  };
}
