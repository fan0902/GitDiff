import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { buildCommitGraph } from "../server/git-graph.mjs";

const execFileAsync = promisify(execFile);

async function run(repo, ...args) {
  const { stdout } = await execFileAsync("git", ["-C", repo, ...args], { encoding: "utf8" });
  return stdout.trim();
}

async function commit(repo, subject, file = "history.txt") {
  await writeFile(join(repo, file), `${subject}\n${Date.now()}\n`);
  await run(repo, "add", file);
  await run(repo, "commit", "-m", subject);
  return run(repo, "rev-parse", "HEAD");
}

async function fixture(t) {
  const repo = await mkdtemp(join(tmpdir(), "gitdiff-graph-"));
  t.after(() => rm(repo, { recursive: true, force: true }));
  await run(repo, "init", "-b", "main");
  await run(repo, "config", "user.name", "GitDiff Test");
  await run(repo, "config", "user.email", "gitdiff@example.test");
  const root = await commit(repo, "root");
  return { repo, root };
}

test("builds common, base and target lanes around the merge base", async (t) => {
  const { repo, root } = await fixture(t);
  await run(repo, "branch", "feature");
  const baseHead = await commit(repo, "base only", "base.txt");
  await run(repo, "switch", "feature");
  const targetHead = await commit(repo, "target only", "target.txt");

  const graph = await buildCommitGraph(repo, "main", "feature");
  assert.equal(graph.mergeBase, root);
  assert.equal(graph.ahead, 1);
  assert.equal(graph.behind, 1);
  assert.equal(graph.historyComplete, true);
  assert.equal(graph.nodes.find((node) => node.sha === baseHead)?.scope, "base");
  assert.equal(graph.nodes.find((node) => node.sha === targetHead)?.scope, "target");
  assert.equal(graph.nodes.find((node) => node.sha === root)?.kind, "merge-base");
});

test("collapses unique history beyond twelve commits", async (t) => {
  const { repo } = await fixture(t);
  await run(repo, "switch", "-c", "feature");
  for (let index = 1; index <= 15; index += 1) await commit(repo, `feature ${index}`);

  const graph = await buildCommitGraph(repo, "main", "feature");
  const collapsed = graph.nodes.find((node) => node.kind === "collapsed");
  assert.equal(collapsed.collapsedCount, 3);
  assert.equal(collapsed.scope, "target");
  assert.ok(collapsed.id.startsWith("collapsed:target:"));
});

test("classifies a focus commit without discarding the current graph", async (t) => {
  const { repo, root } = await fixture(t);
  await run(repo, "branch", "feature");
  const baseOnly = await commit(repo, "base focus", "base.txt");
  await run(repo, "switch", "feature");
  const targetOnly = await commit(repo, "target focus", "target.txt");
  await run(repo, "switch", "--orphan", "detached-history");
  const unrelated = await commit(repo, "unrelated focus", "other.txt");

  for (const [sha, relation] of [
    [root, "common"],
    [baseOnly, "base"],
    [targetOnly, "target"],
    [unrelated, "unrelated"],
  ]) {
    const graph = await buildCommitGraph(repo, "main", "feature", sha);
    assert.equal(graph.focus.relation, relation);
    if (relation === "unrelated") {
      assert.equal(graph.focus.node.scope, "unrelated");
      assert.equal(graph.nodes.some((node) => node.sha === sha), false);
    } else {
      assert.equal(graph.nodes.find((node) => node.sha === sha)?.kind, "focus");
    }
  }
});

test("reports an invalid focus SHA separately", async (t) => {
  const { repo } = await fixture(t);
  await assert.rejects(
    buildCommitGraph(repo, "main", "main", "not-a-real-sha"),
    /找不到提交：not-a-real-sha/,
  );
});

test("uses a single common lane when both refs resolve to the same head", async (t) => {
  const { repo } = await fixture(t);
  const graph = await buildCommitGraph(repo, "main", "main");
  assert.equal(graph.ahead, 0);
  assert.equal(graph.behind, 0);
  assert.equal(graph.disconnected, false);
  assert.ok(graph.nodes.every((node) => node.scope === "common"));
});

test("returns two short trees when histories are disconnected", async (t) => {
  const { repo } = await fixture(t);
  await run(repo, "switch", "--orphan", "other");
  await commit(repo, "other root", "other.txt");
  const graph = await buildCommitGraph(repo, "main", "other");
  assert.equal(graph.mergeBase, null);
  assert.equal(graph.disconnected, true);
  assert.ok(graph.nodes.some((node) => node.scope === "base"));
  assert.ok(graph.nodes.some((node) => node.scope === "target"));
});

test("keeps all visible parents for a merge commit", async (t) => {
  const { repo } = await fixture(t);
  await run(repo, "switch", "-c", "topic");
  await commit(repo, "topic work", "topic.txt");
  await run(repo, "switch", "main");
  await commit(repo, "main work", "main.txt");
  await run(repo, "merge", "--no-ff", "topic", "-m", "merge topic");
  const mergeSha = await run(repo, "rev-parse", "HEAD");
  const graph = await buildCommitGraph(repo, "main", "topic");
  const mergeNode = graph.nodes.find((node) => node.sha === mergeSha);
  assert.equal(mergeNode.parents.length, 2);
  assert.match(mergeNode.annotation, /2 个父提交/);
});

test("marks a shallow clone as incomplete", async (t) => {
  const { repo } = await fixture(t);
  await commit(repo, "second");
  const clone = await mkdtemp(join(tmpdir(), "gitdiff-shallow-"));
  t.after(() => rm(clone, { recursive: true, force: true }));
  await execFileAsync("git", ["clone", "--depth=1", `file://${repo}`, clone]);
  const graph = await buildCommitGraph(clone, "main", "main");
  assert.equal(graph.historyComplete, false);
});
