import { useEffect, useState } from "react";

import continueButton from "./assets/continue_button.png";
import repoList from "./assets/repo-list.png";
import analysingRepoVideo from "./assets/analysing-repo.mp4";

export type AnalysisMode = "repo" | "analyzing";

export default function Analysis({
  mode,
  onContinue
}: {
  mode: AnalysisMode;
  onContinue?: () => void;
}) {
  const [videoVisible, setVideoVisible] = useState(false);

  useEffect(() => {
    if (mode === "analyzing") {
      setVideoVisible(false);
      const id = requestAnimationFrame(() => setVideoVisible(true));
      return () => cancelAnimationFrame(id);
    }

    setVideoVisible(false);
    return;
  }, [mode]);

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
              left: "50%",
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
    </>
  );
}
