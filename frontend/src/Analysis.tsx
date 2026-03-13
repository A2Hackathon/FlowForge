import RepoTree from "./components/RepoTree";
import type { NodeModel } from "@minoru/react-dnd-treeview";

import { useEffect, useState, useRef } from "react";

import continueButton from "./assets/continue_button.png";
import repoList from "./assets/repo-list.png";
import analysingRepoVideo from "./assets/analysing-repo.mp4";
import confirmRepoStructure from "./assets/confirm_repo_structure.png";

export type AnalysisMode = "repo" | "analyzing" | "confirm";

type RepoNode = NodeModel & {
    name: string;
    type: "folder" | "file";
  };

type GitlabProject = {
  id: number;
  name: string;
  path_with_namespace: string;
  web_url: string;
  last_activity_at: string;
};

export type ArchitectureGraph = {
  nodes: Array<{
    id: string;
    position: { x: number; y: number };
    data: { label: string; category: string; icon?: string; gcpMapping?: string };
  }>;
  edges: Array<{ id: string; source: string; target: string; label?: string }>;
  metadata?: Record<string, unknown>;
};

export type RepositoryTreeItem = { path: string; type: string };

type AnalysisProps = {
  mode: AnalysisMode;
  onContinue?: () => void;
  onSelectRepo?: (repo: GitlabProject) => void;
  selectedRepo?: GitlabProject | null;
  onAnalysisComplete?: (payload: { graph: ArchitectureGraph; repositoryTree: RepositoryTreeItem[] }) => void;
  onConfirmContinue?: () => void;
  graphData?: ArchitectureGraph | null;
  repositoryTree?: RepositoryTreeItem[] | null;
};

function convertRepositoryTreeToNodes(items: RepositoryTreeItem[]): RepoNode[] {
  if (!items.length) return [];
  const sorted = [...items].sort((a, b) => a.path.localeCompare(b.path));
  return sorted.map(({ path, type }) => {
    const name = path.includes("/") ? path.split("/").pop()! : path;
    const parent = path.includes("/") ? path.split("/").slice(0, -1).join("/") : 0;
    const isFolder = type === "tree";
    return {
      id: path,
      parent,
      droppable: isFolder,
      name,
      type: isFolder ? "folder" : "file",
      text: name,
    };
  });
}

export default function Analysis({
  mode,
  onContinue,
  onSelectRepo,
  selectedRepo,
  onAnalysisComplete,
  onConfirmContinue,
  graphData,
  repositoryTree: repositoryTreeProp,
}: AnalysisProps) {
  const [videoVisible, setVideoVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [repos, setRepos] = useState<GitlabProject[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const scanStartedRef = useRef(false);
  const [treeNodes, setTreeNodes] = useState<RepoNode[]>([]);

  useEffect(() => {
    if (mode === "confirm") {
      if (repositoryTreeProp && repositoryTreeProp.length > 0) {
        setTreeNodes(convertRepositoryTreeToNodes(repositoryTreeProp));
      } else {
        setTreeNodes([]);
      }
      return;
    }
    if (graphData?.nodes?.length) {
      const tree = graphData.nodes.map(node => ({
        id: node.id,
        parent: 0 as const,
        droppable: true,
        name: node.data.label,
        type: (node.data.category === "folder" ? "folder" : "file") as "folder" | "file",
        text: node.data.label,
      }));
      setTreeNodes(tree);
    }
  }, [mode, graphData, repositoryTreeProp]);

  useEffect(() => {
    if (mode === "analyzing") {
      setVideoVisible(false);
      const id = requestAnimationFrame(() => setVideoVisible(true));
      return () => cancelAnimationFrame(id);
    }

    setVideoVisible(false);
  }, [mode]);

  // Run repo scan when on analyzing screen with a selected repo
  useEffect(() => {
    if (mode !== "analyzing" || !selectedRepo || scanStartedRef.current) return;
    if (typeof window.api?.scanRepo !== "function" || typeof window.api?.generateGraph !== "function") {
      if (onAnalysisComplete) {
        onAnalysisComplete({ graph: { nodes: [], edges: [], metadata: {} }, repositoryTree: [] });
      }
      return;
    }

    scanStartedRef.current = true;

    const runScan = async () => {
      const cleanup =
        typeof window.api?.onScanProgress === "function"
          ? window.api.onScanProgress(() => {})
          : () => {};

      try {
        const result = await window.api.scanRepo({ projectId: selectedRepo.id });
        cleanup();

        if (!result.success) {
          if (onAnalysisComplete) {
            onAnalysisComplete({ graph: { nodes: [], edges: [], metadata: {} }, repositoryTree: [] });
          }
          return;
        }

        const scanResult = result.data as {
          isMonorepo?: boolean;
          repositoryTree?: RepositoryTreeItem[];
          services?: Array<{ frameworks: unknown; infrastructure: unknown; languages: unknown }>;
          frameworks?: unknown;
          infrastructure?: unknown;
          languages?: unknown;
        };

        const repoTree = scanResult.repositoryTree ?? [];

        const payload = scanResult?.isMonorepo && scanResult.services?.length
          ? scanResult.services[0]
          : scanResult;

        const graphResult = await window.api.generateGraph({ scanResult: payload });
        if (graphResult.success && onAnalysisComplete) {
          onAnalysisComplete({
            graph: graphResult.data as ArchitectureGraph,
            repositoryTree: repoTree,
          });
        } else if (onAnalysisComplete) {
          onAnalysisComplete({ graph: { nodes: [], edges: [], metadata: {} }, repositoryTree: [] });
        }
      } catch {
        if (onAnalysisComplete) {
          onAnalysisComplete({ graph: { nodes: [], edges: [], metadata: {} }, repositoryTree: [] });
        }
      } finally {
        scanStartedRef.current = false;
      }
    };

    runScan();
  }, [mode, selectedRepo?.id, onAnalysisComplete]);

  // Fetch repositories when entering repo selection mode
  useEffect(() => {
    if (mode !== "repo") return;

    if (typeof window.api?.listRepos !== "function") {
      setError("Repository listing is only available in the desktop app.");
      return;
    }

    let cancelled = false;

    const fetchRepos = async () => {
      setLoading(true);
      setError(null);
      try {
        const result = await window.api.listRepos({ page: 1 });
        if (cancelled) return;

        if (result.success) {
          const data = result.data as {
            repositories: GitlabProject[];
          };
          setRepos(data.repositories);
        } else {
          setError(result.error || "Failed to load repositories.");
        }
      } catch {
        if (!cancelled) {
          setError("Failed to load repositories.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    fetchRepos();

    return () => {
      cancelled = true;
    };
  }, [mode]);

  const handleSelectRepo = (repo: GitlabProject) => {
    if (onSelectRepo) onSelectRepo(repo);
  };

  return (
    <>
      {mode === "repo" && (
        <>
          <img
            src={repoList}
            alt="Repo List"
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              position: "absolute",
              zIndex: 0
            }}
          />
          <div
            style={{
              position: "absolute",
              top: "47%",
              left: "52%",
              width: "33%",
              height: "48%",
              display: "flex",
              flexDirection: "column",
              zIndex: 5,
              color: "#f97316",
              fontFamily: 'Agrandir, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif',
            }}
          >
            <input
              type="text"
              placeholder="Search repositories…"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              style={{
                width: "95%",
                boxSizing: "border-box",
                padding: "8px 12px",
                marginBottom: 8,
                border: "1px solid rgba(249, 115, 22, 0.5)",
                borderRadius: 6,
                backgroundColor: "rgba(255, 255, 255, 0.95)",
                color: "#1f2937",
                fontSize: 14,
                outline: "none",
                fontFamily: "Agrandir, system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif",
              }}
            />
            <div style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
              {loading && <div>Loading repositories…</div>}
              {error && <div style={{ color: "#f87171" }}>{error}</div>}
              {!loading &&
                !error &&
                repos
                  .filter(
                    repo =>
                      !searchQuery.trim() ||
                      repo.name.toLowerCase().includes(searchQuery.trim().toLowerCase()) ||
                      repo.path_with_namespace.toLowerCase().includes(searchQuery.trim().toLowerCase())
                  )
                  .map(repo => (
              <button
                key={repo.id}
                style={{
                  display: "block",
                  width: "100%",
                  textAlign: "left",
                  marginBottom: 6,
                  padding: "6px 10px",
                  border: "none",
                  background: "transparent",
                  color: "#f97316",
                  cursor: "pointer",
                }}
                onClick={() => handleSelectRepo(repo)}
              >
                <div style={{ fontWeight: 700, letterSpacing: 0.2 }}>
                  {repo.name}
                </div>
                <div style={{ fontSize: 11, opacity: 0.85 }}>
                  {repo.path_with_namespace}
                </div>
              </button>
                  ))}
            </div>
          </div>

          <img
            src={continueButton}
            alt="Continue"
            role="button"
            tabIndex={0}
            onClick={onContinue}
            onKeyDown={e => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onContinue?.();
              }
            }}
            style={{
              width: "200px",
              position: "absolute",
              bottom: "80px",
              left: "70%",
              transform: "translateX(-50%)",
              cursor: "pointer",
              userSelect: "none",
              zIndex: 10
            }}
          />
        </>
      )}

      {mode === "analyzing" && (
        <video
          src={analysingRepoVideo}
          autoPlay
          loop
          muted
          playsInline
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            position: "absolute",
            top: 0,
            left: 0,
            zIndex: 0,
            opacity: videoVisible ? 1 : 0,
            transition: "opacity 600ms ease-in-out"
          }}
        />
      )}

      {mode === "confirm" && graphData && (
        <>
          <img
            src={confirmRepoStructure}
            alt="Confirm repo structure"
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              position: "absolute",
              top: 0,
              left: 0,
              zIndex: 0
            }}
          />
          <div
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              zIndex: 5,
              pointerEvents: "none"
            }}
          >
            <div
              style={{
                position: "absolute",
                top: "15%",
                left: "25%",
                width: "30%",
                height: "65%",
                borderRadius: 8,
                padding: 12,
                overflow: "auto",
                zIndex: 10,
                pointerEvents: "auto"
              }}
            >
              <RepoTree nodes={treeNodes} setNodes={setTreeNodes} />
            </div>
            <img
              src={continueButton}
              alt="Continue"
              role="button"
              tabIndex={0}
              onClick={() => onConfirmContinue?.()}
              onKeyDown={e => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onConfirmContinue?.();
                }
              }}
              style={{
                position: "absolute",
                bottom: "80px",
                left: "50%",
                transform: "translateX(-50%)",
                width: 200,
                cursor: "pointer",
                userSelect: "none",
                zIndex: 10,
                pointerEvents: "auto"
              }}
            />
          </div>
        </>
      )}
    </>
  );
}
