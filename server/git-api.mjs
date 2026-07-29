import { execFile } from "node:child_process";
import { realpath, stat } from "node:fs/promises";
import http from "node:http";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const PORT = Number(process.env.GIT_DIFF_API_PORT || 3101);
const MAX_BODY_BYTES = 64 * 1024;
const MAX_DIFF_BYTES = 2 * 1024 * 1024;
const COMPACT_CONTEXT_LINES = 3;
const FULL_CONTEXT_LINES = 1_000_000;
const ALLOWED_ORIGINS = new Set([
  "http://localhost:9002",
  "http://127.0.0.1:9002",
]);

function json(request, response, status, value) {
  const origin = request.headers.origin;
  const headers = {
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "Vary": "Origin",
  };
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }
  response.writeHead(status, headers);
  response.end(JSON.stringify(value));
}

async function body(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new Error("请求内容过大");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    throw new Error("请求不是有效的 JSON");
  }
}

async function git(repoPath, args, options = {}) {
  const { stdout } = await execFileAsync("git", ["-C", repoPath, ...args], {
    encoding: "utf8",
    maxBuffer: options.maxBuffer ?? 8 * 1024 * 1024,
    timeout: options.timeout ?? 15_000,
  });
  return stdout;
}

async function repository(inputPath) {
  if (typeof inputPath !== "string" || !inputPath.trim()) {
    throw new Error("请输入本地 Git 仓库路径");
  }
  const resolved = await realpath(inputPath.trim());
  if (!(await stat(resolved)).isDirectory()) throw new Error("仓库路径必须是目录");
  const root = (await git(resolved, ["rev-parse", "--show-toplevel"])).trim();
  return realpath(root);
}

async function resolveCommit(repoPath, ref) {
  if (typeof ref !== "string" || !ref || ref.length > 512 || /[\u0000-\u001f]/.test(ref)) {
    throw new Error("分支名称无效");
  }
  try {
    return (await git(repoPath, ["rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`])).trim();
  } catch {
    throw new Error(`找不到分支：${ref}`);
  }
}

async function listBranches(repoPath) {
  const format = "%(refname)\t%(refname:short)\t%(HEAD)\t%(committerdate:iso8601)";
  const output = await git(repoPath, [
    "for-each-ref",
    `--format=${format}`,
    "--sort=-committerdate",
    "refs/heads",
    "refs/remotes",
  ]);
  return output
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [fullName, name, head, updatedAt] = line.split("\t");
      return {
        name,
        type: fullName.startsWith("refs/heads/") ? "local" : "remote",
        current: head === "*",
        updatedAt,
      };
    })
    .filter((branch) => !branch.name.endsWith("/HEAD"));
}

function statusKind(status) {
  if (status.startsWith("A")) return "added";
  if (status.startsWith("D")) return "deleted";
  if (status.startsWith("R")) return "renamed";
  if (status.startsWith("C")) return "copied";
  return "modified";
}

function parseNameStatus(output) {
  return output
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [status, firstPath, secondPath] = line.split("\t");
      return {
        path: secondPath || firstPath,
        oldPath: secondPath ? firstPath : undefined,
        status: statusKind(status),
      };
    });
}

function parseNumstat(output) {
  const stats = new Map();
  for (const line of output.trim().split("\n").filter(Boolean)) {
    const [added, deleted, ...pathParts] = line.split("\t");
    let path = pathParts.join("\t");
    if (path.includes(" => ")) {
      const match = path.match(/^(.*\{.* => )(.*)(\}.*)$/);
      path = match ? `${match[1].split("{")[0]}${match[2]}${match[3].split("}")[1] || ""}` : path.split(" => ").at(-1);
    }
    stats.set(path, {
      additions: added === "-" ? 0 : Number(added),
      deletions: deleted === "-" ? 0 : Number(deleted),
      binary: added === "-" || deleted === "-",
    });
  }
  return stats;
}

async function compare(repoPath, base, target) {
  const [baseSha, targetSha] = await Promise.all([
    resolveCommit(repoPath, base),
    resolveCommit(repoPath, target),
  ]);
  const range = `${baseSha}...${targetSha}`;
  const [nameStatus, numstat, commitsAhead, commitsBehind, mergeBase] = await Promise.all([
    git(repoPath, ["diff", "--no-ext-diff", "--find-renames", "--name-status", range]),
    git(repoPath, ["diff", "--no-ext-diff", "--find-renames", "--numstat", range]),
    git(repoPath, ["rev-list", "--count", `${baseSha}..${targetSha}`]),
    git(repoPath, ["rev-list", "--count", `${targetSha}..${baseSha}`]),
    git(repoPath, ["merge-base", baseSha, targetSha]),
  ]);
  const stats = parseNumstat(numstat);
  const files = parseNameStatus(nameStatus).map((file) => ({
    ...file,
    ...(stats.get(file.path) ?? { additions: 0, deletions: 0, binary: false }),
  }));
  const additions = files.reduce((sum, file) => sum + file.additions, 0);
  const deletions = files.reduce((sum, file) => sum + file.deletions, 0);
  return {
    repoPath,
    base,
    target,
    baseSha,
    targetSha,
    mergeBase: mergeBase.trim(),
    commitsAhead: Number(commitsAhead.trim()),
    commitsBehind: Number(commitsBehind.trim()),
    additions,
    deletions,
    files,
  };
}

async function fileDiff(repoPath, base, target, path, oldPath, contextLines = COMPACT_CONTEXT_LINES) {
  if (typeof path !== "string" || !path || path.includes("\u0000")) throw new Error("文件路径无效");
  const [baseSha, targetSha] = await Promise.all([
    resolveCommit(repoPath, base),
    resolveCommit(repoPath, target),
  ]);
  const paths = [oldPath, path].filter((value, index, values) =>
    typeof value === "string" && value && !value.includes("\u0000") && values.indexOf(value) === index
  );
  try {
    const diff = await git(
      repoPath,
      ["diff", "--no-ext-diff", "--find-renames", `--unified=${contextLines}`, `${baseSha}...${targetSha}`, "--", ...paths],
      { maxBuffer: MAX_DIFF_BYTES }
    );
    return { diff, truncated: false };
  } catch (error) {
    if (error?.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") {
      return { diff: "", truncated: true };
    }
    throw error;
  }
}

const server = http.createServer(async (request, response) => {
  const origin = request.headers.origin;
  if (origin && !ALLOWED_ORIGINS.has(origin)) {
    return json(request, response, 403, { error: "仅允许 GitDiff 本地页面访问" });
  }
  if (request.method === "OPTIONS") return json(request, response, 204, {});
  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
  try {
    if (request.method === "GET" && url.pathname === "/health") {
      return json(request, response, 200, { ok: true, service: "git-branch-diff-api" });
    }
    if (request.method === "POST" && url.pathname === "/api/repository") {
      const input = await body(request);
      const repoPath = await repository(input.path);
      const branches = await listBranches(repoPath);
      const current = branches.find((branch) => branch.current)?.name ?? "HEAD";
      return json(request, response, 200, { repoPath, branches, current });
    }
    if (request.method === "POST" && url.pathname === "/api/compare") {
      const input = await body(request);
      const repoPath = await repository(input.repoPath);
      return json(request, response, 200, await compare(repoPath, input.base, input.target));
    }
    if (request.method === "POST" && url.pathname === "/api/diff") {
      const input = await body(request);
      const repoPath = await repository(input.repoPath);
      return json(request, response, 200, await fileDiff(
        repoPath,
        input.base,
        input.target,
        input.path,
        input.oldPath,
        COMPACT_CONTEXT_LINES,
      ));
    }
    if (request.method === "POST" && url.pathname === "/api/full-diff") {
      const input = await body(request);
      const repoPath = await repository(input.repoPath);
      return json(request, response, 200, await fileDiff(
        repoPath,
        input.base,
        input.target,
        input.path,
        input.oldPath,
        FULL_CONTEXT_LINES,
      ));
    }
    return json(request, response, 404, { error: "接口不存在" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知错误";
    const safeMessage = message.includes("ENOENT") ? "路径不存在，或本机未安装 Git" : message;
    return json(request, response, 400, { error: safeMessage });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`只读 Git API 已启动：http://127.0.0.1:${PORT}`);
});
