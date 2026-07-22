"use client";

import { CSSProperties, FormEvent, useEffect, useMemo, useRef, useState } from "react";

export type GraphScope = "common" | "base" | "target" | "unrelated";
export type GraphKind = "commit" | "head" | "merge-base" | "focus" | "merge" | "collapsed";

export type GraphNode = {
  id: string;
  sha?: string;
  shortSha: string;
  parents: string[];
  subject: string;
  author: string;
  authoredAt: string;
  scope: GraphScope;
  kind: GraphKind;
  annotation: string;
  collapsedCount?: number;
  nextSha?: string;
};

export type CommitGraphData = {
  repoPath?: string;
  base: { name: string; sha: string };
  target: { name: string; sha: string };
  mergeBase: string | null;
  ahead: number;
  behind: number;
  historyComplete: boolean;
  disconnected?: boolean;
  nodes: GraphNode[];
  focus?: { sha: string; relation: GraphScope; node?: GraphNode };
};

type Props = {
  data: CommitGraphData;
  focusInput: string;
  focusError: string;
  loading: boolean;
  onFocusInput: (value: string) => void;
  onLocate: () => void;
};

type PositionedNode = { node: GraphNode; x: number; y: number };

const X_STEP = 184;
const NODE_WIDTH = 148;
const NODE_HEIGHT = 64;
const START_X = 116;
const LANE_Y = { base: 62, common: 158, target: 254 } as const;

function Edge({ from, to, secondary = false }: { from: { x: number; y: number }; to: { x: number; y: number }; secondary?: boolean }) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  return (
    <span
      className={`graph-edge ${secondary ? "secondary" : ""}`}
      style={{ left: from.x, top: from.y, width: Math.hypot(dx, dy), transform: `rotate(${Math.atan2(dy, dx)}rad)` }}
    />
  );
}

function scopeLabel(scope: GraphScope) {
  return { common: "共同历史", base: "仅基准分支", target: "仅目标分支", unrelated: "当前分支对之外" }[scope];
}

function formatDate(value: string) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function positionNodes(data: CommitGraphData) {
  const common = data.nodes.filter((node) => node.scope === "common");
  const base = data.nodes.filter((node) => node.scope === "base");
  const target = data.nodes.filter((node) => node.scope === "target");
  const branchStart = data.disconnected ? 0 : common.length;
  const positioned: PositionedNode[] = [
    ...common.map((node, index) => ({ node, x: START_X + index * X_STEP, y: LANE_Y.common })),
    ...base.map((node, index) => ({ node, x: START_X + (branchStart + index) * X_STEP, y: LANE_Y.base })),
    ...target.map((node, index) => ({ node, x: START_X + (branchStart + index) * X_STEP, y: LANE_Y.target })),
  ];
  const columns = Math.max(common.length, branchStart + base.length, branchStart + target.length, 4);
  return { positioned, width: START_X + columns * X_STEP + 70 };
}

export function CommitGraph({ data, focusInput, focusError, loading, onFocusInput, onLocate }: Props) {
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [copied, setCopied] = useState(false);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const triggerNodeIdRef = useRef("");
  const { positioned, width } = useMemo(() => positionNodes(data), [data]);

  const positionsBySha = useMemo(() => {
    const result = new Map<string, PositionedNode>();
    for (const item of positioned) if (item.node.sha) result.set(item.node.sha, item);
    return result;
  }, [positioned]);

  const edges = useMemo(() => {
    const result: Array<{ key: string; from: { x: number; y: number }; to: { x: number; y: number }; secondary: boolean }> = [];
    for (const child of positioned) {
      child.node.parents.forEach((parentSha, index) => {
        const parent = positionsBySha.get(parentSha);
        if (!parent) return;
        result.push({
          key: `${parent.node.id}:${child.node.id}:${index}`,
          from: { x: parent.x + NODE_WIDTH, y: parent.y + NODE_HEIGHT / 2 },
          to: { x: child.x, y: child.y + NODE_HEIGHT / 2 },
          secondary: index > 0,
        });
      });
      if (child.node.kind === "collapsed" && child.node.nextSha) {
        const next = positionsBySha.get(child.node.nextSha);
        if (next) {
          result.push({
            key: `${child.node.id}:${next.node.id}:collapsed`,
            from: { x: child.x + NODE_WIDTH, y: child.y + NODE_HEIGHT / 2 },
            to: { x: next.x, y: next.y + NODE_HEIGHT / 2 },
            secondary: false,
          });
        }
      }
    }
    return result;
  }, [positioned, positionsBySha]);

  useEffect(() => {
    if (!selectedNode) return;
    closeButtonRef.current?.focus();
    function handleEscape(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") closeDetails();
    }
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [selectedNode]);

  function openDetails(node: GraphNode) {
    triggerNodeIdRef.current = node.id;
    setCopied(false);
    setSelectedNode(node);
  }

  function closeDetails() {
    const triggerNodeId = triggerNodeIdRef.current;
    setSelectedNode(null);
    window.requestAnimationFrame(() => {
      const trigger = document.querySelector<HTMLButtonElement>(`[data-node-id="${CSS.escape(triggerNodeId)}"]`);
      trigger?.focus();
    });
  }

  async function copySha() {
    if (!selectedNode?.sha) return;
    await navigator.clipboard.writeText(selectedNode.sha);
    setCopied(true);
  }

  function submitFocus(event: FormEvent) {
    event.preventDefault();
    onLocate();
  }

  const hasBaseOnly = data.nodes.some((node) => node.scope === "base");
  const hasTargetOnly = data.nodes.some((node) => node.scope === "target");
  const relationNote = data.disconnected
    ? "两个分支没有共同历史"
    : !hasBaseOnly && !hasTargetOnly
      ? "两个分支指向同一提交"
      : !hasTargetOnly
        ? "目标分支未产生独有提交"
        : !hasBaseOnly
          ? "基准分支未产生独有提交"
          : "两个分支均有独有提交";

  return (
    <section className="commit-graph-view" aria-label="提交关系">
      <header className="graph-heading">
        <div>
          <span>COMMIT RELATIONSHIP</span>
          <h1>提交关系</h1>
          <p>聚焦共同祖先、分叉位置和两侧独有提交，不展开整个仓库历史。</p>
        </div>
        <form className="graph-controls" onSubmit={submitFocus}>
          <label htmlFor="focus-commit">指定提交（可选）</label>
          <div>
            <input
              id="focus-commit"
              value={focusInput}
              onChange={(event) => onFocusInput(event.target.value)}
              placeholder="输入 commit SHA"
              spellCheck={false}
              aria-invalid={Boolean(focusError)}
              aria-describedby={focusError ? "focus-commit-error" : undefined}
            />
            <button type="submit" disabled={loading}>{loading ? "定位中…" : "定位提交"}</button>
          </div>
          {focusError && <small id="focus-commit-error" className="graph-input-error">{focusError}</small>}
        </form>
      </header>

      <div className="graph-summary" aria-label="关系摘要">
        <span><b>{data.ahead}</b> 目标领先</span>
        <span><b>{data.behind}</b> 基准领先</span>
        <span>共同祖先 <code>{data.mergeBase?.slice(0, 8) || "无"}</code></span>
        <span>{relationNote}</span>
        {!data.historyComplete && <span className="warning">本地历史可能不完整</span>}
      </div>

      {data.focus?.relation === "unrelated" && data.focus.node && (
        <aside className="unrelated-focus" aria-label="无关指定提交">
          <div><strong>与当前分支对无祖先关系</strong><span>该提交存在，但不是当前两个分支任一侧的祖先。</span></div>
          <button type="button" onClick={() => openDetails(data.focus!.node!)}>{data.focus.node.shortSha} · 查看详情</button>
        </aside>
      )}

      <div className="graph-scroll" tabIndex={0} aria-label="横向提交关系图，可左右滚动">
        <div className="graph-canvas" style={{ width, minWidth: width } as CSSProperties}>
          <span className="graph-lane lane-base">基准分支 · {data.base.name}</span>
          {!data.disconnected && <span className="graph-lane lane-common">共同历史</span>}
          <span className="graph-lane lane-target">目标分支 · {data.target.name}</span>
          {data.disconnected && <div className="graph-disconnected"><i /><span>历史断开</span><i /></div>}
          {edges.map((edge) => <Edge key={edge.key} from={edge.from} to={edge.to} secondary={edge.secondary} />)}
          {positioned.map(({ node, x, y }) => (
            <button
              type="button"
              key={node.id}
              data-node-id={node.id}
              className={`commit-node ${node.kind} scope-${node.scope}`}
              style={{ left: x, top: y }}
              aria-label={`${node.shortSha}，${node.subject}${node.annotation ? `，${node.annotation}` : ""}`}
              onClick={() => openDetails(node)}
            >
              <span className="node-line"><code>{node.shortSha}</code>{node.parents.length > 1 && <i>{node.parents.length}P</i>}</span>
              <strong>{node.subject}</strong>
              <small>{node.annotation || scopeLabel(node.scope)}</small>
            </button>
          ))}
        </div>
      </div>

      <footer className="graph-legend" aria-label="图例">
        <span><i className="legend-merge-base" />共同祖先</span>
        <span><i className="legend-focus" />指定提交</span>
        <span><i className="legend-merge" />Merge commit</span>
        <span>横向方向：旧 → 新</span>
      </footer>

      {selectedNode && (
        <aside className="commit-detail" role="dialog" aria-modal="false" aria-labelledby="commit-detail-title">
          <header>
            <div><span>COMMIT DETAIL</span><h2 id="commit-detail-title">提交详情</h2></div>
            <button ref={closeButtonRef} type="button" onClick={closeDetails} aria-label="关闭提交详情">×</button>
          </header>
          <section className="detail-identity">
            <code>{selectedNode.shortSha}</code>
            <strong>{selectedNode.subject}</strong>
            {selectedNode.annotation && <p>{selectedNode.annotation}</p>}
          </section>
          <dl>
            <div><dt>所属范围</dt><dd>{scopeLabel(selectedNode.scope)}</dd></div>
            <div><dt>作者</dt><dd>{selectedNode.author || "—"}</dd></div>
            <div><dt>提交时间</dt><dd>{formatDate(selectedNode.authoredAt)}</dd></div>
            <div><dt>相对分叉点</dt><dd>{selectedNode.scope === "common" ? "分叉点或更早" : selectedNode.scope === "unrelated" ? "不在当前分支路径" : `${scopeLabel(selectedNode.scope)}路径`}</dd></div>
          </dl>
          {selectedNode.sha && <div className="full-sha"><span>完整 SHA</span><code>{selectedNode.sha}</code></div>}
          <div className="parent-list">
            <span>父提交 · {selectedNode.parents.length}</span>
            {selectedNode.parents.length ? selectedNode.parents.map((parent) => <code key={parent}>{parent}</code>) : <small>根提交没有父提交</small>}
          </div>
          {selectedNode.sha && <button className="copy-sha" type="button" onClick={() => void copySha()}>{copied ? "已复制 SHA" : "复制 SHA"}</button>}
        </aside>
      )}
    </section>
  );
}
