import { useEffect, useState } from "react";
import startScreen from "./assets/start.png";
import continueButton from "./assets/continue_button.png";
import loginScreen from "./assets/log-in.png";
import repoList from "./assets/repo-list.png";

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
        if (count > 6) clearInterval(flashInterval);
      }, 300);
    }, 3000);
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
        transition: "opacity 0.2s",
        zIndex: 5
      }}
      onClick={onClick}
    />
  );
}

export default function Login() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [screen, setScreen] = useState<"start" | "login" | "repo">("start");

  return (
    <div style={{ width: "100vw", height: "100vh", position: "relative" }}>
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

          {/* INPUTS IN FOCUSABLE CONTAINER */}
          <div
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              height: "100%",
              zIndex: 10,
              display: "flex",
              flexDirection: "column",
              justifyContent: "center",
              alignItems: "center",
              pointerEvents: "auto", // ensure inputs can be clicked
              gap: "20px"
            }}
          >
            <input
              type="text"
              placeholder="Username"
              value={username}
              autoFocus
              tabIndex={0}
              onChange={e => setUsername(e.target.value)}
              style={{ padding: "10px", fontSize: "18px", width: "400px" }}
            />
            <input
              type="password"
              placeholder="Password"
              value={password}
              tabIndex={0}
              onChange={e => setPassword(e.target.value)}
              style={{ padding: "10px", fontSize: "18px", width: "400px" }}
            />
            <button
              onClick={() => {
                if (username && password) {
                  setScreen("repo");
                } else {
                  alert("Please enter username and password");
                }
              }}
              style={{ padding: "12px 40px", fontSize: "18px", cursor: "pointer" }}
            >
              Join
            </button>
          </div>
        </>
      )}

      {/* REPO SCREEN */}
      {screen === "repo" && (
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
      )}
    </div>
  );
}