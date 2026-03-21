import { Tree } from "@minoru/react-dnd-treeview";
import type { DropOptions, NodeModel } from "@minoru/react-dnd-treeview";

export type RepoNode = NodeModel & {
  name: string;
  type: "folder" | "file";
};

type Props = {
  nodes: RepoNode[];
  setNodes: (nodes: RepoNode[]) => void;
};

export default function RepoTree({ nodes, setNodes }: Props) {
  const handleDrop = (tree: NodeModel<unknown>[], _options: DropOptions<unknown>) => {
    setNodes(tree as RepoNode[]);
  };

  return (
    <Tree
      tree={nodes}
      rootId={0}
      onDrop={handleDrop}
      render={(node, { depth, isOpen, onToggle }) => {
        const n = node as RepoNode;
        return (
          <div
            style={{
              marginLeft: depth * 18,
              display: "flex",
              alignItems: "center",
              padding: "4px 6px",
              cursor: "pointer",
              color: "#fff",
              fontWeight: 600
            }}
          >
            {n.type === "folder" && (
              <span onClick={onToggle} style={{ marginRight: 6 }}>
                {isOpen ? "📂" : "📁"}
              </span>
            )}

            {n.type === "file" && <span style={{ marginRight: 6 }}>📄</span>}

            {n.name}
          </div>
        );
      }}
    />
  );
}