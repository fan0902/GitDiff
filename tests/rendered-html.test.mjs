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
});

test("the local Git API contains no repository mutation commands", async () => {
  const source = await readFile(new URL("../server/git-api.mjs", import.meta.url), "utf8");
  assert.match(source, /execFileAsync\("git"/);
  assert.match(source, /"diff"/);
  assert.match(source, /"for-each-ref"/);
  assert.doesNotMatch(source, /\["(?:checkout|switch|add|commit|merge|rebase|push|reset|clean|restore)"/);
});

test("shipped sources contain no user-specific paths or browser coupling", async () => {
  const sources = await Promise.all([
    readFile(new URL("../app/DiffViewer.tsx", import.meta.url), "utf8"),
    readFile(new URL("../packaging/macos/GitDiff.applescript", import.meta.url), "utf8"),
    readFile(new URL("../README.md", import.meta.url), "utf8"),
  ]);

  for (const source of sources) {
    assert.doesNotMatch(source, /\/Users\//);
    assert.doesNotMatch(source, /tabbit/i);
  }
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
