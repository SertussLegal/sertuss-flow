import { createRoot } from "react-dom/client";
import "./index.css";

const root = createRoot(document.getElementById("root")!);

import("./App.tsx")
  .then(({ default: App }) => {
    root.render(<App />);
  })
  .catch((error) => {
    console.error("App initialization failed:", error);
    root.render(
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", fontFamily: "system-ui", flexDirection: "column", gap: "1rem", padding: "2rem", textAlign: "center" }}>
        <h1 style={{ fontSize: "1.5rem", fontWeight: 600 }}>Error al iniciar la aplicación</h1>
        <p style={{ color: "#666" }}>Hubo un problema de configuración. Intenta recargar la página.</p>
        <button onClick={() => window.location.reload()} style={{ padding: "0.5rem 1.5rem", borderRadius: "0.5rem", border: "1px solid #ccc", cursor: "pointer", background: "#f5f5f5" }}>
          Recargar
        </button>
      </div>
    );
  });
