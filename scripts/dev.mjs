import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const projectDir = fileURLToPath(new URL("../", import.meta.url));
const webEnv = {
  ...process.env,
  WRANGLER_LOG_PATH: ".wrangler/wrangler.log",
};

const processes = [
  spawn(process.execPath, ["server/git-api.mjs"], { cwd: projectDir, stdio: "inherit" }),
  spawn(process.execPath, ["node_modules/vinext/dist/cli.js", "dev", "--port", "9002"], {
    cwd: projectDir,
    env: webEnv,
    stdio: "inherit",
  }),
];

let stopping = false;

function stop(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of processes) {
    if (!child.killed) child.kill("SIGTERM");
  }
  setTimeout(() => process.exit(exitCode), 300).unref();
}

for (const child of processes) {
  child.on("exit", (code, signal) => {
    if (!stopping && code !== 0) {
      console.error(`开发进程异常退出: ${signal ?? code}`);
      stop(code ?? 1);
    }
  });
}

process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());
