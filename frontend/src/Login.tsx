import startScreen from "./assets/start.png";
import continueButton from "./assets/continue_button.png";
import loginScreen from "./assets/log-in.png";
import connectGitButton from "./assets/connect_to_git.png";
import openingGitButton from "./assets/opening_git.png";
import loadingArchitecture from "./assets/loading_architecture.png";
import googleCloudArchitecture from "./assets/google_cloud_architecture.png";
import gitlabLogo from "./assets/gitlab_logo.png";

import { useEffect, useState, useRef } from "react";
import Analysis, { type ArchitectureGraph, type RepositoryTreeItem } from "./Analysis";

type GitlabProject = {
  id: number;
  name: string;
  path_with_namespace: string;
  web_url: string;
  last_activity_at: string;
};

function StartButton({ onClick }: { onClick: () => void }) {
  const [flash, setFlash] = useState(false);

  useEffect(() => {
    let count = 0;
    const flashInterval = setInterval(() => {
      setFlash(prev => !prev);
      count++;

      if (count > 6) {
        clearInterval(flashInterval);
        setFlash(false);
      }
    }, 300);

    return () => clearInterval(flashInterval);
  }, []);

  return (
    <img
      src={continueButton}
      alt="Continue"
      style={{
        width: "200px",
        position: "absolute",
        bottom: "80px",
        left: "50%",
        transform: "translateX(-50%)",
        cursor: "pointer",
        opacity: flash ? 0.3 : 1,
        transition: "opacity 0.2s",
        zIndex: 5
      }}
      onClick={onClick}
    />
  );
}

export default function Login() {
  const [screen, setScreen] = useState<
    "start" | "login" | "repo" | "analyzing" | "confirm" | "loadingArchitecture" | "googleCloudArchitecture"
  >("start");
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [selectedRepo, setSelectedRepo] = useState<GitlabProject | null>(null);
  const [graphData, setGraphData] = useState<ArchitectureGraph | null>(null);
  const [repositoryTree, setRepositoryTree] = useState<RepositoryTreeItem[]>([]);
  const [gitlabMenuOpen, setGitlabMenuOpen] = useState(false);
  const gitlabMenuRef = useRef<HTMLDivElement>(null);

  const showGitlabMenu =
    screen === "repo" ||
    screen === "analyzing" ||
    screen === "confirm" ||
    screen === "loadingArchitecture" ||
    screen === "googleCloudArchitecture";

  useEffect(() => {
    if (!showGitlabMenu || !gitlabMenuOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (gitlabMenuRef.current && !gitlabMenuRef.current.contains(e.target as Node)) {
        setGitlabMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showGitlabMenu, gitlabMenuOpen]);

  const handleLogout = async () => {
    setGitlabMenuOpen(false);
    if (typeof window.api?.logout === "function") {
      await window.api.logout();
    }
    setScreen("login");
  };

  const handleSwitchRepo = () => {
    setGitlabMenuOpen(false);
    setScreen("repo");
  };

  // Skip login if already authenticated
  useEffect(() => {
    if (typeof window.api?.checkAuth !== "function") return;
    window.api.checkAuth().then(({ loggedIn }) => {
      if (loggedIn) setScreen("repo");
    });
  }, []);

  // After showing loading architecture, move to Google Cloud architecture screen
  useEffect(() => {
    if (screen !== "loadingArchitecture") return;
    const t = setTimeout(() => setScreen("googleCloudArchitecture"), 2500);
    return () => clearTimeout(t);
  }, [screen]);

  const handleConnectGitLab = async () => {
    if (!window.api?.login) {
      alert("GitLab login is only available in the desktop app.");
      return;
    }
    setIsLoggingIn(true);
    try {
      const result = await window.api.login();
      if (result.success) {
        setScreen("repo");
      } else {
        alert(result.error || "Login failed");
      }
    } catch (err) {
      alert("Login failed. Please try again.");
    } finally {
      setIsLoggingIn(false);
    }
  };

  return (
    <div style={{ width: "100vw", height: "100vh", position: "relative" }}>
      {/* GitLab logo menu (top-right) when logged in */}
      {showGitlabMenu && (
        <div
          ref={gitlabMenuRef}
          style={{
            position: "absolute",
            top: 16,
            right: 16,
            zIndex: 1000,
          }}
        >
          <button
            type="button"
            onClick={() => setGitlabMenuOpen(prev => !prev)}
            style={{
              padding: 4,
              border: "none",
              background: "transparent",
              cursor: "pointer",
              borderRadius: 6,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
            aria-haspopup="true"
            aria-expanded={gitlabMenuOpen}
            aria-label="GitLab menu"
          >
            <img
              src={gitlabLogo}
              alt="GitLab"
              style={{ width: 36, height: 36, display: "block" }}
            />
          </button>
          {gitlabMenuOpen && (
            <div
              style={{
                position: "absolute",
                top: "100%",
                right: 0,
                marginTop: 4,
                minWidth: 140,
                background: "rgba(15,23,42,0.98)",
                borderRadius: 8,
                boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
                padding: "6px 0",
                border: "1px solid rgba(255,255,255,0.1)",
              }}
            >
              <button
                type="button"
                onClick={handleSwitchRepo}
                style={{
                  display: "block",
                  width: "100%",
                  padding: "10px 14px",
                  border: "none",
                  background: "transparent",
                  color: "#e5e7eb",
                  fontSize: 14,
                  fontWeight: 500,
                  textAlign: "left",
                  cursor: "pointer",
                  fontFamily: "system-ui, sans-serif",
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.background = "rgba(255,255,255,0.1)";
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.background = "transparent";
                }}
              >
                Switch repo
              </button>
              <button
                type="button"
                onClick={handleLogout}
                style={{
                  display: "block",
                  width: "100%",
                  padding: "10px 14px",
                  border: "none",
                  background: "transparent",
                  color: "#e5e7eb",
                  fontSize: 14,
                  fontWeight: 500,
                  textAlign: "left",
                  cursor: "pointer",
                  fontFamily: "system-ui, sans-serif",
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.background = "rgba(255,255,255,0.1)";
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.background = "transparent";
                }}
              >
                Log out
              </button>
            </div>
          )}
        </div>
      )}

      {/* START SCREEN */}
      {screen === "start" && (
        <>
          <img
            src={startScreen}
            alt="Start"
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              position: "absolute",
              zIndex: 0
            }}
          />
          <StartButton onClick={() => setScreen("login")} />
        </>
      )}

      {/* LOGIN SCREEN */}
      {screen === "login" && (
        <>
          <style>
            {`
              .ffLoginInput {
                font-family: Agrandir, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif;
                font-weight: 700;
                font-size: 21px;
              }
              .ffLoginInput::placeholder {
                font-family: Agrandir, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif;
                font-weight: 700;
                font-size: 21px;
                color: #000;
                opacity: 1;
              }
            `}
          </style>
          {/* BACKGROUND IMAGE */}
          <img
            src={loginScreen}
            alt="Login"
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

          {/* INPUTS LAYERED ON TOP, ALIGNED TO WHITE BOXES */}
          <div
            style={{
              position: "absolute",
              inset: 0,
              zIndex: 10,
            }}
          >
            <img
              src={connectGitButton}
              alt="Connect to GitLab"
              role="button"
              tabIndex={0}
              onClick={handleConnectGitLab}
              onKeyDown={e => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  handleConnectGitLab();
                }
              }}
              style={{
                position: "absolute",
                top: "66%",
                left: "40%",
                transform: "translateX(-50%)",
                width: "200px",
                cursor: isLoggingIn ? "wait" : "pointer",
                userSelect: "none",
                opacity: isLoggingIn ? 0.6 : 1,
                pointerEvents: isLoggingIn ? "none" : "auto"
              }}
            />
            {isLoggingIn && (
              <div
                style={{
                  position: "absolute",
                  top: "76%",
                  left: "50%",
                  transform: "translateX(-50%)",
                  color: "#fff",
                  fontSize: 14,
                  fontWeight: 600
                }}
              >
                <img
                  src={openingGitButton}
                  alt="Opening GitLab"
                  style={{
                    width: "200px",
                    position: "absolute",
                    top: "66%",
                    left: "40%",
                    transform: "translateX(-50%)"
                  }}
                />
              </div>
            )}
          </div>
        </>
      )}

      {/* REPO LIST SCREEN */}
      {screen === "repo" && (
        <Analysis
          mode="repo"
          onContinue={() => {
            if (!selectedRepo) {
              alert("Please select a repository first.");
              return;
            }
            setScreen("analyzing");
          }}
          onSelectRepo={repo => {
            setSelectedRepo(repo);
          }}
        />
      )}

      {/* ANALYZING SCREEN */}
      {screen === "analyzing" && (
        <>
          <Analysis
            mode="analyzing"
            selectedRepo={selectedRepo}
            onAnalysisComplete={({ graph, repositoryTree: repoTree }) => {
              setGraphData(graph);
              setRepositoryTree(repoTree);
              setScreen("confirm");
            }}
          />
          {selectedRepo && (
            <div
              style={{
                position: "absolute",
                top: 16,
                left: 24,
                zIndex: 20,
                padding: "6px 10px",
                borderRadius: 999,
                backgroundColor: "rgba(15,23,42,0.85)",
                color: "#e5e7eb",
                fontSize: 12,
                fontWeight: 600,
                fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
              }}
            >
              Analyzing: {selectedRepo.path_with_namespace}
            </div>
          )}
        </>
      )}

      {/* CONFIRM REPO STRUCTURE SCREEN */}
      {screen === "confirm" && (
        <Analysis
          mode="confirm"
          graphData={graphData}
          repositoryTree={repositoryTree}
          onConfirmContinue={() => setScreen("loadingArchitecture")}
        />
      )}

      {/* LOADING ARCHITECTURE SCREEN */}
      {screen === "loadingArchitecture" && (
        <img
          src={loadingArchitecture}
          alt="Loading architecture"
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            position: "absolute",
            top: 0,
            left: 0,
            zIndex: 0,
          }}
        />
      )}

      {/* GOOGLE CLOUD ARCHITECTURE SCREEN */}
      {screen === "googleCloudArchitecture" && (
        <img
          src={googleCloudArchitecture}
          alt="Google Cloud architecture"
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            position: "absolute",
            top: 0,
            left: 0,
            zIndex: 0,
          }}
        />
      )}
    </div>
  );
}