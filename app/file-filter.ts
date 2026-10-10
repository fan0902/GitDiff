export type ReviewFilterMode = "all" | "unread" | "added";

export type FilterableFile = {
  path: string;
  status: string;
  additions: number;
  deletions: number;
};

type ReviewFilterOptions = {
  pathFilter: string;
  search: string;
  mode: ReviewFilterMode;
  readFiles: ReadonlySet<string>;
};

export function deriveReviewFiles<T extends FilterableFile>(
  files: readonly T[],
  options: ReviewFilterOptions,
) {
  const pathPrefix = options.pathFilter.trim().replace(/^\.\//, "").toLowerCase();
  const query = options.search.trim().toLowerCase();
  const summaryFiles = files.filter((file) => {
    const normalizedPath = file.path.toLowerCase();
    if (pathPrefix && !normalizedPath.startsWith(pathPrefix)) return false;
    if (query && !normalizedPath.includes(query)) return false;
    if (options.mode === "added" && file.status !== "added") return false;
    return true;
  });
  const visibleFiles = options.mode === "unread"
    ? summaryFiles.filter((file) => !options.readFiles.has(file.path))
    : summaryFiles;
  return { summaryFiles, visibleFiles };
}

export function summarizeFiles(files: readonly FilterableFile[]) {
  const additions = files.reduce((sum, file) => sum + file.additions, 0);
  const deletions = files.reduce((sum, file) => sum + file.deletions, 0);
  const totalLines = additions + deletions;
  return {
    fileCount: files.length,
    additions,
    deletions,
    additionPercent: totalLines ? additions / totalLines * 100 : 50,
  };
}
