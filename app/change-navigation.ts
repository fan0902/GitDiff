type NavigableRow = {
  kind: string;
  left?: { kind: string };
  right?: { kind: string };
};

export type ChangeMarkedRow<T> = T & {
  changeIndex?: number;
  changeStart?: boolean;
  changeEnd?: boolean;
};

function isChanged(row: NavigableRow) {
  return row.kind === "code" && (row.left?.kind === "deleted" || row.right?.kind === "added");
}

export function markChangeBlocks<T extends NavigableRow>(rows: readonly T[]) {
  let count = 0;
  let previousWasChanged = false;
  const marked: ChangeMarkedRow<T>[] = rows.map((row) => {
    const changed = isChanged(row);
    if (!changed) {
      previousWasChanged = false;
      return { ...row };
    }
    if (!previousWasChanged) count += 1;
    previousWasChanged = true;
    return { ...row, changeIndex: count - 1 };
  });

  for (let index = 0; index < marked.length; index += 1) {
    const row = marked[index];
    if (row.changeIndex === undefined) continue;
    row.changeStart = marked[index - 1]?.changeIndex !== row.changeIndex;
    row.changeEnd = marked[index + 1]?.changeIndex !== row.changeIndex;
  }

  return { rows: marked, count };
}

export function wrapChangeIndex(current: number, direction: -1 | 1, count: number) {
  if (count <= 0) return 0;
  return (current + direction + count) % count;
}
