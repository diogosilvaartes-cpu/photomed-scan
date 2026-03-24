import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

// Desregistra qualquer service worker antigo para forçar atualização
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.getRegistrations().then((regs) => {
    regs.forEach((r) => r.unregister());
  });
}

createRoot(document.getElementById("root")!).render(<App />);
