import { useState } from "react";
import { Feed } from "./components/Feed";
import { Simulator } from "./components/Simulator";
import { About } from "./components/About";
import { SmoothCursor } from "./components/SmoothCursor";
import { CHAIN } from "./lib/chain";

type Tab = "feed" | "sim" | "about";

export default function App() {
  const [tab, setTab] = useState<Tab>("feed");
  return (
    <div className="app">
      <SmoothCursor />
      <header className="masthead">
        <div className="brand">
          <span className="logo">L</span>
          <div>
            <h1>
              Launch Lab<span className="dot">·</span>
              <span className="accent">vibe/vibe testnet</span>
            </h1>
            <p className="muted small">
              Unofficial launch analytics and bonding-curve simulator for {CHAIN.name} · reads public chain data only
            </p>
          </div>
        </div>
        <nav className="tabs">
          <button className={tab === "feed" ? "tab on" : "tab"} onClick={() => setTab("feed")}>
            Live launches
          </button>
          <button className={tab === "sim" ? "tab on" : "tab"} onClick={() => setTab("sim")}>
            Launch simulator
          </button>
          <button className={tab === "about" ? "tab on" : "tab"} onClick={() => setTab("about")}>
            How it works
          </button>
        </nav>
      </header>

      <main>
        {tab === "feed" && <Feed />}
        {tab === "sim" && <Simulator />}
        {tab === "about" && <About />}
      </main>

      <footer className="footer">
        <span>
          Not affiliated with vibe/vibe or Seedify. Testnet tokens are worthless. Model output is checked against the deployed
          curve contracts — see “How it works”. Built by one person on a laptop, not a foundation.
        </span>
        <a href={CHAIN.app} target="_blank" rel="noreferrer noopener">
          launchpad ↗
        </a>
      </footer>
    </div>
  );
}
