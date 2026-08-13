type BranchOrderItem = {
  name: string;
  updatedAt: string;
};

export function orderDefaultBranches<T extends BranchOrderItem>(branches: readonly T[]): T[] {
  const pinnedName = branches.some((branch) => branch.name === "dev")
    ? "dev"
    : branches.some((branch) => branch.name === "origin/dev")
      ? "origin/dev"
      : "";

  return branches
    .map((branch, index) => {
      const parsedTime = Date.parse(branch.updatedAt);
      return { branch, index, time: Number.isNaN(parsedTime) ? Number.NEGATIVE_INFINITY : parsedTime };
    })
    .sort((left, right) => {
      if (left.branch.name === pinnedName && right.branch.name !== pinnedName) return -1;
      if (right.branch.name === pinnedName && left.branch.name !== pinnedName) return 1;
      return right.time - left.time || left.index - right.index;
    })
    .map(({ branch }) => branch);
}
