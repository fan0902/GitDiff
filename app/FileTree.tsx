import { ReactNode } from "react";
import { FileTreeNode } from "./file-tree";

type FileTreeProps<T extends { path: string }> = {
  nodes: readonly FileTreeNode<T>[];
  expandedKeys: ReadonlySet<string>;
  folderIcon: ReactNode;
  onToggle: (key: string) => void;
  renderFile: (file: T) => ReactNode;
};

function groupId(key: string) {
  return `file-tree-${encodeURIComponent(key).replaceAll("%", "-")}`;
}

function FileTreeNodes<T extends { path: string }>({
  nodes,
  expandedKeys,
  folderIcon,
  onToggle,
  renderFile,
}: FileTreeProps<T>) {
  return nodes.map((node) => {
    if (node.type === "file") return renderFile(node.file);
    const expanded = expandedKeys.has(node.key);
    const childId = groupId(node.key);
    return (
      <section className="file-tree-branch" key={node.key}>
        <button
          type="button"
          className="file-tree-directory"
          aria-expanded={expanded}
          aria-controls={childId}
          title={node.path}
          onClick={() => onToggle(node.key)}
        >
          <span className="file-tree-chevron" aria-hidden="true">{expanded ? "⌄" : "›"}</span>
          <span className="file-tree-folder" aria-hidden="true">{folderIcon}</span>
          <strong>{node.label}</strong>
          <span>{node.fileCount}</span>
        </button>
        {expanded && (
          <div className="file-tree-children" id={childId} role="group">
            <FileTreeNodes
              nodes={node.children}
              expandedKeys={expandedKeys}
              folderIcon={folderIcon}
              onToggle={onToggle}
              renderFile={renderFile}
            />
          </div>
        )}
      </section>
    );
  });
}

export function FileTree<T extends { path: string }>(props: FileTreeProps<T>) {
  return <div className="file-tree" role="tree" aria-label="变更文件目录树"><FileTreeNodes {...props} /></div>;
}
