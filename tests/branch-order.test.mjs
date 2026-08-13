import assert from "node:assert/strict";
import test from "node:test";
import { orderDefaultBranches } from "../app/branch-order.ts";

const names = (branches) => branches.map((branch) => branch.name);

test("pins local dev and orders every remaining branch by newest commit", () => {
  const branches = [
    { name: "origin/dev", updatedAt: "2026-07-29T13:00:00Z" },
    { name: "feature/newest", updatedAt: "2026-07-29T15:00:00Z" },
    { name: "dev", updatedAt: "2026-07-01T00:00:00Z" },
    { name: "feature/older", updatedAt: "2026-07-20T00:00:00Z" },
  ];

  assert.deepEqual(names(orderDefaultBranches(branches)), ["dev", "feature/newest", "origin/dev", "feature/older"]);
  assert.deepEqual(names(branches), ["origin/dev", "feature/newest", "dev", "feature/older"]);
});

test("falls back to origin dev when local dev is absent", () => {
  const branches = [
    { name: "feature/newest", updatedAt: "2026-07-29T15:00:00Z" },
    { name: "origin/dev", updatedAt: "2026-07-01T00:00:00Z" },
  ];

  assert.deepEqual(names(orderDefaultBranches(branches)), ["origin/dev", "feature/newest"]);
});

test("orders without dev and keeps stable fallbacks", () => {
  const branches = [
    { name: "same-a", updatedAt: "2026-07-20T00:00:00Z" },
    { name: "invalid-a", updatedAt: "unknown" },
    { name: "newest", updatedAt: "2026-07-29T00:00:00Z" },
    { name: "same-b", updatedAt: "2026-07-20T00:00:00Z" },
    { name: "invalid-b", updatedAt: "" },
  ];

  assert.deepEqual(names(orderDefaultBranches(branches)), ["newest", "same-a", "same-b", "invalid-a", "invalid-b"]);
});
