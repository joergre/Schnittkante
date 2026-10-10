import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../src/styles.css";
import { Workbench } from "../src/components/workbench";

const root = document.getElementById("root");
if (!root) throw new Error("Schnittkante konnte nicht starten");

createRoot(root).render(
  <StrictMode>
    <Workbench />
  </StrictMode>,
);
