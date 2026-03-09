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
            <input
              type="text"
              placeholder="username"
              value={username}
              onChange={e => setUsername(e.target.value)}
              className="ffLoginInput"
              style={{
                position: "absolute",
                top: "43%",
                left: "6.6%",
                width: "44.5%",
                height: "44px",
                backgroundColor: "#ffffff",
                border: "none",
                outline: "none",
                color: "#000",
                fontSize: "21px",
                fontFamily:
                  'Agrandir, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif',
                fontWeight: 700,
                padding: "0 12px",
                boxSizing: "border-box"
              }}
            />
            <input
              type="password"
              placeholder="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="ffLoginInput"
              style={{
                position: "absolute",
                top: "54.5%",
                left: "6.6%",
                width: "44.5%",
                height: "44px",
                backgroundColor: "#ffffff",
                border: "none",
                outline: "none",
                color: "#000",
                fontSize: "21px",
                fontFamily:
                  'Agrandir, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif',
                fontWeight: 700,
                padding: "0 12px",
                boxSizing: "border-box"
              }}
            />
            <img
              src={continueButton}
              alt="Join"
              role="button"
              tabIndex={0}
              onClick={() => {
                if (username && password) {
                  setScreen("repo");
                } else {
                  alert("Please enter username and password");
                }
              }}
              onKeyDown={e => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  if (username && password) {
                    setScreen("repo");
                  } else {
                    alert("Please enter username and password");
                  }
                }
              }}
              style={{
                position: "absolute",
                top: "66%",
                left: "40%",
                transform: "translateX(-50%)",
                width: "200px",
                cursor: "pointer",
                userSelect: "none"
              }}
            />
          </div>
        </>
      )}

      {/* REPO LIST SCREEN */}
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