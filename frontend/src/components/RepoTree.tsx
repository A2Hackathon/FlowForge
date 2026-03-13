import { Tree } from "@minoru/react-dnd-treeview";
import type { NodeModel } from "@minoru/react-dnd-treeview";

export type RepoNode = NodeModel & {
  name: string;
  type: "folder" | "file";
};

type Props = {
  nodes: RepoNode[];
  setNodes: (nodes: RepoNode[]) => void;
};

export default function RepoTree({ nodes, setNodes }: Props) {
  return (
    <Tree
      tree={nodes}
      rootId={0}
      onDrop={setNodes}
      render={(node, { depth, isOpen, onToggle }) => (
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
          {node.type === "folder" && (
            <span onClick={onToggle} style={{ marginRight: 6 }}>
              {isOpen ? "📂" : "📁"}
            </span>
          )}

          {node.type === "file" && <span style={{ marginRight: 6 }}>📄</span>}

          {node.name}
        </div>
      )}
    />
  );
}