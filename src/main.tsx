import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";
import { arrivedFrom, track } from "./telemetry";

// One count per page load, so the Lab can rank its projects by how often each is opened.
track("app_open", { from: arrivedFrom() });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
