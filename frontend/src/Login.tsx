import startScreen from "./assets/start.png";
import continueButton from "./assets/continue_button.png";
import loginScreen from "./assets/log-in.png";
import repoList from "./assets/repo-list.png";

import { useEffect, useState } from "react";

function StartButton({ onClick }: { onClick: () => void }) {
  const [showButton, setShowButton] = useState(false);
  const [flash, setFlash] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      setShowButton(true);

      let count = 0;
      const flashInterval = setInterval(() => {
        setFlash(prev => !prev);
        count++;

        if (count > 6) {
          clearInterval(flashInterval);
          setFlash(false);
        }
      }, 300);

    }, 3000); // change to 3 seconds for testing

    return () => clearTimeout(timer);
  }, []);

  if (!showButton) return null;

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
        transition: "opacity 0.2s"
      }}
      onClick={onClick}
    />
  );
}

export default function Login() {

  const [screen, setScreen] = useState("start");

  return (
    <div style={{ width: "100vw", height: "100vh", position: "relative" }}>

      {/* START SCREEN */}
      {screen === "start" && (
        <>
          <img
            src={startScreen}
            alt="Start"
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />

          <StartButton onClick={() => setScreen("login")} />
        </>
      )}

      {/* LOGIN SCREEN */}
      {screen === "login" && (
        <div onClick={() => setScreen("repo")}>
          <img
            src={loginScreen}
            alt="Login"
            style={{ width: "100%", height: "100%", objectFit: "cover", cursor:"pointer" }}
          />
        </div>
      )}

      {/* REPO LIST SCREEN */}
      {screen === "repo" && (
        <img
          src={repoList}
          alt="Repo List"
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
      )}

    </div>
  );
}