import { execFile } from "node:child_process";
import { realpath, stat } from "node:fs/promises";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function git(repoPath, args, options = {}) {
  const { stdout } = await execFileAsync("git", ["-C", repoPath, ...args], {
    encoding: "utf8",
    maxBuffer: options.maxBuffer ?? 8 * 1024 * 1024,
    timeout: options.timeout ?? 15_000,
  });
  return stdout;
}

export async function repository(inputPath) {
  if (typeof inputPath !== "string" || !inputPath.trim()) {
    throw new Error("请输入本地 Git 仓库路径");
  }
  const resolved = await realpath(inputPath.trim());
  if (!(await stat(resolved)).isDirectory()) throw new Error("仓库路径必须是目录");
  const root = (await git(resolved, ["rev-parse", "--show-toplevel"])).trim();
  return realpath(root);
}

export async function resolveCommit(repoPath, ref, label = "分支") {
  if (typeof ref !== "string" || !ref || ref.length > 512 || /[\u0000-\u001f]/.test(ref)) {
    throw new Error(`${label}名称无效`);
  }
  try {
    return (await git(repoPath, ["rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`])).trim();
  } catch {
    throw new Error(`找不到${label}：${ref}`);
  }
}

export async function isShallowRepository(repoPath) {
  return (await git(repoPath, ["rev-parse", "--is-shallow-repository"])).trim() === "true";
}
