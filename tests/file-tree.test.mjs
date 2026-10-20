import assert from "node:assert/strict";
import test from "node:test";
import { buildFileTree, collectDirectoryKeys } from "../app/file-tree.ts";

const files = [
  { path: "app/controllers/member/grant.py" },
  { path: "app/controllers/member/revoke.py" },
  { path: "app/database/repositories/member.py" },
  { path: "app/services/member/service.py" },
  { path: "app/main.py" },
  { path: "README.md" },
];

test("builds nested directories, descendant counts and top-level files", () => {
  const tree = buildFileTree(files);

  assert.deepEqual(tree.map((node) => node.type === "directory" ? node.label : node.name), ["app", "README.md"]);
  assert.equal(tree[0].type, "directory");
  assert.equal(tree[0].fileCount, 5);
  assert.deepEqual(
    tree[0].children.map((node) => node.type === "directory" ? node.label : node.name),
    ["controllers / member", "database / repositories", "services / member", "main.py"],
  );
});

test("keeps file identity and compacts only directory-only chains", () => {
  const tree = buildFileTree(files);
  const app = tree[0];
  assert.equal(app.type, "directory");
  const controllers = app.children[0];
  assert.equal(controllers.type, "directory");
  assert.equal(controllers.key, "app/controllers/member");
  assert.equal(controllers.fileCount, 2);
  assert.deepEqual(controllers.children.map((node) => node.type === "file" ? node.file.path : ""), [
    "app/controllers/member/grant.py",
    "app/controllers/member/revoke.py",
  ]);
});

test("collects stable directory keys in display order", () => {
  assert.deepEqual(collectDirectoryKeys(buildFileTree(files)), [
    "app",
    "app/controllers/member",
    "app/database/repositories",
    "app/services/member",
  ]);
});
