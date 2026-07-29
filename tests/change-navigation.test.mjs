import assert from "node:assert/strict";
import test from "node:test";

import { markChangeBlocks, wrapChangeIndex } from "../app/change-navigation.ts";

const context = (number) => ({
  kind: "code",
  left: { kind: "context", oldNumber: number, content: `line ${number}` },
  right: { kind: "context", newNumber: number, content: `line ${number}` },
});

test("groups adjacent changed rows and splits them at context or metadata", () => {
  const result = markChangeBlocks([
    context(1),
    { kind: "code", left: { kind: "deleted", content: "old" }, right: { kind: "added", content: "new" } },
    { kind: "code", right: { kind: "added", content: "more" } },
    context(4),
    { kind: "hunk", content: "@@ -8 +8 @@" },
    { kind: "code", left: { kind: "deleted", content: "gone" } },
  ]);

  assert.equal(result.count, 2);
  assert.deepEqual(result.rows.map((row) => row.changeIndex), [undefined, 0, 0, undefined, undefined, 1]);
  assert.equal(result.rows[1].changeStart, true);
  assert.equal(result.rows[2].changeEnd, true);
  assert.equal(result.rows[5].changeStart, true);
  assert.equal(result.rows[5].changeEnd, true);
});

test("treats a pure deletion as a navigable block", () => {
  const result = markChangeBlocks([{ kind: "code", left: { kind: "deleted", content: "gone" } }]);

  assert.equal(result.count, 1);
  assert.equal(result.rows[0].changeIndex, 0);
});

test("wraps previous and next navigation", () => {
  assert.equal(wrapChangeIndex(0, 1, 3), 1);
  assert.equal(wrapChangeIndex(2, 1, 3), 0);
  assert.equal(wrapChangeIndex(0, -1, 3), 2);
  assert.equal(wrapChangeIndex(0, 1, 1), 0);
});
