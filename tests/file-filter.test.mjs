import assert from "node:assert/strict";
import test from "node:test";
import { deriveReviewFiles, summarizeFiles } from "../app/file-filter.ts";

const files = [
  { path: "app/api/new.ts", status: "added", additions: 10, deletions: 0 },
  { path: "app/ui/card.tsx", status: "modified", additions: 4, deletions: 3 },
  { path: "server/job.ts", status: "modified", additions: 2, deletions: 8 },
];

test("applies path, search and added filters to the summary range", () => {
  const result = deriveReviewFiles(files, {
    pathFilter: "./APP/",
    search: "new",
    mode: "added",
    readFiles: new Set(["app/api/new.ts"]),
  });

  assert.deepEqual(result.summaryFiles.map((file) => file.path), ["app/api/new.ts"]);
  assert.deepEqual(result.visibleFiles.map((file) => file.path), ["app/api/new.ts"]);
});

test("keeps the summary range stable when unread filtering hides read files", () => {
  const result = deriveReviewFiles(files, {
    pathFilter: "app/",
    search: "",
    mode: "unread",
    readFiles: new Set(["app/api/new.ts"]),
  });

  assert.deepEqual(result.summaryFiles.map((file) => file.path), ["app/api/new.ts", "app/ui/card.tsx"]);
  assert.deepEqual(result.visibleFiles.map((file) => file.path), ["app/ui/card.tsx"]);
});

test("summarizes only the supplied files and returns neutral zero totals", () => {
  assert.deepEqual(summarizeFiles(files.slice(0, 2)), {
    fileCount: 2,
    additions: 14,
    deletions: 3,
    additionPercent: 14 / 17 * 100,
  });
  assert.deepEqual(summarizeFiles([]), {
    fileCount: 0,
    additions: 0,
    deletions: 0,
    additionPercent: 50,
  });
});
