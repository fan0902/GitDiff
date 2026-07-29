import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import test from "node:test";

const execFileAsync = promisify(execFile);
const projectDir = fileURLToPath(new URL("../", import.meta.url));

async function git(repoPath, ...args) {
  await execFileAsync("git", ["-C", repoPath, ...args]);
}

async function unusedPort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function waitForHealth(port) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      if (response.ok) return;
    } catch {
      // The child process may still be starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Git API did not become healthy");
}

async function post(port, pathname, payload) {
  const response = await fetch(`http://127.0.0.1:${port}${pathname}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await response.json();
  assert.equal(response.status, 200, body.error || `HTTP ${response.status}`);
  return body;
}

test("full diff includes unchanged source omitted by compact diff", async (context) => {
  const repoPath = await mkdtemp(path.join(tmpdir(), "gitdiff-full-source-"));
  const filePath = path.join(repoPath, "example.txt");
  const port = await unusedPort();
  const serverProcess = spawn(process.execPath, ["server/git-api.mjs"], {
    cwd: projectDir,
    env: { ...process.env, GIT_DIFF_API_PORT: String(port) },
    stdio: "ignore",
  });

  context.after(async () => {
    serverProcess.kill("SIGTERM");
    await rm(repoPath, { recursive: true, force: true });
  });

  await git(repoPath, "init", "-b", "main");
  await git(repoPath, "config", "user.name", "GitDiff Test");
  await git(repoPath, "config", "user.email", "gitdiff-test@example.invalid");

  const originalLines = Array.from({ length: 24 }, (_, index) => {
    if (index === 1) return "original-at-top";
    if (index === 11) return "UNCHANGED_MIDDLE_MARKER";
    if (index === 22) return "original-at-bottom";
    return `unchanged-line-${index + 1}`;
  });
  await writeFile(filePath, `${originalLines.join("\n")}\n`);
  await git(repoPath, "add", "example.txt");
  await git(repoPath, "commit", "-m", "initial source");
  await git(repoPath, "switch", "-c", "feature");

  const changedLines = [...originalLines];
  changedLines[1] = "changed-at-top";
  changedLines[22] = "changed-at-bottom";
  await writeFile(filePath, `${changedLines.join("\n")}\n`);
  await git(repoPath, "add", "example.txt");
  await git(repoPath, "commit", "-m", "change distant lines");

  await waitForHealth(port);
  const payload = {
    repoPath,
    base: "main",
    target: "feature",
    path: "example.txt",
  };
  const compact = await post(port, "/api/diff", payload);
  const full = await post(port, "/api/full-diff", payload);

  assert.equal(compact.truncated, false);
  assert.equal(full.truncated, false);
  assert.doesNotMatch(compact.diff, /UNCHANGED_MIDDLE_MARKER/);
  assert.match(full.diff, /UNCHANGED_MIDDLE_MARKER/);
  assert.match(full.diff, /changed-at-top/);
  assert.match(full.diff, /changed-at-bottom/);
});
