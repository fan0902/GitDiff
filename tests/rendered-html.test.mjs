import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the Branch Review shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>Branch Review · 本地 Git 差异阅读器<\/title>/i);
  assert.match(html, /Branch Review/);
  assert.match(html, /本地只读分支审阅/);
  assert.match(html, /像读文档一样/);
  assert.match(html, /输入本地 Git 仓库绝对路径/);
  assert.match(html, /文件差异/);
  assert.match(html, /提交关系/);
});

test("the commit graph view exposes commit location controls", async () => {
  const source = await readFile(new URL("../app/CommitGraph.tsx", import.meta.url), "utf8");
  assert.match(source, /定位提交/);
  assert.match(source, /与当前分支对无祖先关系/);
  assert.match(source, /role="dialog"/);
});

test("branch actions refresh the active view directly", async () => {
  const source = await readFile(new URL("../app/DiffViewer.tsx", import.meta.url), "utf8");
  assert.match(source, /function refreshActiveView\(\)/);
  assert.match(source, /activeView === "graph"[\s\S]*loadGraph\(""/);
  assert.match(source, /onClick=\{refreshActiveView\}/);
});

test("repository selection has no machine-specific default", async () => {
  const source = await readFile(new URL("../app/DiffViewer.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /const DEFAULT_REPO/);
  assert.match(source, /useState\(\(\) =>[\s\S]*typeof window[\s\S]*localStorage\.getItem\("branch-review:last-repo"\)/);
  assert.doesNotMatch(source, /\/Users\//);
});

test("macOS browser helper targets the runtime default browser", async () => {
  const source = await readFile(new URL("../packaging/macos/open-gitdiff.jxa", import.meta.url), "utf8");
  assert.match(source, /URLForApplicationToOpenURL/);
  assert.match(source, /Application\(applicationURL\.path\.js\)/);
  assert.match(source, /startsWith\(pageOrigin\)/);
  assert.match(source, /openURL/);
});

test("macOS launcher derives paths and delegates browser handling", async () => {
  const source = await readFile(new URL("../packaging/macos/GitDiff.applescript", import.meta.url), "utf8");
  assert.match(source, /path to application support from user domain/);
  assert.match(source, /open-gitdiff\.jxa/);
  assert.match(source, /opt\/homebrew\/bin\/node/);
  assert.doesNotMatch(source, /\/Users\//);
});

test("local runtime uses the numeric loopback address", async () => {
  const [devScript, launcher, browserHelper] = await Promise.all([
    readFile(new URL("../scripts/dev.mjs", import.meta.url), "utf8"),
    readFile(new URL("../packaging/macos/GitDiff.applescript", import.meta.url), "utf8"),
    readFile(new URL("../packaging/macos/open-gitdiff.jxa", import.meta.url), "utf8"),
  ]);
  assert.match(devScript, /"--hostname", "127\.0\.0\.1"/);
  assert.match(launcher, /http:\/\/127\.0\.0\.1:9002/g);
  assert.match(browserHelper, /http:\/\/127\.0\.0\.1:9002/g);
  assert.doesNotMatch(`${launcher}\n${browserHelper}`, /http:\/\/localhost:9002/);
});

test("macOS packaging signs after installing the icon", async () => {
  const [source, packageSource] = await Promise.all([
    readFile(new URL("../packaging/macos/build-app.sh", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);
  const steps = ["osacompile", "applet.icns", "codesign --force --deep --sign -", "codesign --verify --deep --strict"];
  const positions = steps.map((step) => source.indexOf(step));
  assert.ok(positions.every((position) => position >= 0));
  assert.deepEqual([...positions].sort((left, right) => left - right), positions);
  assert.match(packageSource, /"build:macos": "bash packaging\/macos\/build-app\.sh"/);
});

test("the local Git service contains no repository mutation commands", async () => {
  const sources = await Promise.all([
    readFile(new URL("../server/git-api.mjs", import.meta.url), "utf8"),
    readFile(new URL("../server/git-graph.mjs", import.meta.url), "utf8"),
    readFile(new URL("../server/git-runtime.mjs", import.meta.url), "utf8"),
  ]);
  const source = sources.join("\n");
  assert.match(source, /execFileAsync\("git"/);
  assert.match(source, /"rev-parse"/);
  assert.doesNotMatch(source, /\["(?:checkout|switch|add|commit|merge|rebase|push|reset|clean|restore)"/);
});

test("the local API exposes a readonly graph route", async () => {
  const source = await readFile(new URL("../server/git-api.mjs", import.meta.url), "utf8");
  assert.match(source, /url\.pathname === "\/api\/graph"/);
  assert.match(source, /buildCommitGraph\(repoPath, input\.base, input\.target, input\.focusCommit\)/);
});

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

test("the diff viewer exposes scoped change-block navigation", async () => {
  const source = await readFile(new URL("../app/DiffViewer.tsx", import.meta.url), "utf8");
  assert.match(source, /aria-label="代码变更导航"/);
  assert.match(source, /上一处/);
  assert.match(source, /下一处/);
  assert.match(source, /data-change-index/);
  assert.match(source, /sourceCompareRef\.current\?\.querySelector/);
  assert.doesNotMatch(source, /document\.querySelector/);
});
