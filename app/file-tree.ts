export type FileTreeFile<T> = {
  type: "file";
  key: string;
  name: string;
  file: T;
};

export type FileTreeDirectory<T> = {
  type: "directory";
  key: string;
  label: string;
  path: string;
  fileCount: number;
  children: FileTreeNode<T>[];
};

export type FileTreeNode<T> = FileTreeDirectory<T> | FileTreeFile<T>;

type MutableDirectory<T> = {
  name: string;
  key: string;
  directories: Map<string, MutableDirectory<T>>;
  files: FileTreeFile<T>[];
};

function createDirectory<T>(name: string, key: string): MutableDirectory<T> {
  return { name, key, directories: new Map(), files: [] };
}

function materializeChildren<T>(directory: MutableDirectory<T>): FileTreeNode<T>[] {
  return [
    ...[...directory.directories.values()].map(materializeDirectory),
    ...directory.files,
  ];
}

function materializeDirectory<T>(directory: MutableDirectory<T>): FileTreeDirectory<T> {
  const labels = [directory.name];
  let current = directory;
  while (current.files.length === 0 && current.directories.size === 1) {
    current = current.directories.values().next().value as MutableDirectory<T>;
    labels.push(current.name);
  }
  const children = materializeChildren(current);
  const fileCount = children.reduce(
    (total, child) => total + (child.type === "directory" ? child.fileCount : 1),
    0,
  );
  return {
    type: "directory",
    key: current.key,
    label: labels.join(" / "),
    path: current.key,
    fileCount,
    children,
  };
}

export function buildFileTree<T extends { path: string }>(files: readonly T[]): FileTreeNode<T>[] {
  const root = createDirectory<T>("", "");
  for (const file of files) {
    const segments = file.path.split("/").filter(Boolean);
    if (segments.length === 0) continue;
    const name = segments.at(-1) as string;
    let current = root;
    for (const segment of segments.slice(0, -1)) {
      const key = current.key ? `${current.key}/${segment}` : segment;
      const next = current.directories.get(segment) || createDirectory<T>(segment, key);
      current.directories.set(segment, next);
      current = next;
    }
    current.files.push({ type: "file", key: file.path, name, file });
  }
  return materializeChildren(root);
}

export function collectDirectoryKeys<T>(nodes: readonly FileTreeNode<T>[]): string[] {
  return nodes.flatMap((node) => (
    node.type === "directory"
      ? [node.key, ...collectDirectoryKeys(node.children)]
      : []
  ));
}
