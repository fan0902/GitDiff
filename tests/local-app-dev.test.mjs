import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import net from "node:net";
import { fileURLToPath } from "node:url";
import test from "node:test";

const projectDir = fileURLToPath(new URL("../", import.meta.url));

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const port = address.port;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

test("local app mode starts without resolving localhost", { timeout: 15_000 }, async (context) => {
  const port = await freePort();
  const child = spawn(process.execPath, [
    "node_modules/vinext/dist/cli.js",
    "dev",
    "--hostname",
    "127.0.0.1",
    "--port",
    String(port),
  ], {
    cwd: projectDir,
    env: {
      ...process.env,
      GIT_DIFF_LOCAL: "1",
      WRANGLER_LOG_PATH: ".wrangler/wrangler.log",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });
  context.after(() => {
    if (!child.killed) child.kill("SIGTERM");
  });

  let response;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      response = await fetch(`http://127.0.0.1:${port}/`);
      if (response.ok) break;
    } catch {
      // The server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  assert.equal(response?.status, 200, `local page did not start:\n${output}`);
});
