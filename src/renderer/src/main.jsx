import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "@fontsource/inter/800.css";
import "./styles.css";
import { createRoot } from "react-dom/client";
import { noteError } from "./lib/errors";
import { AppProvider } from "./state/AppProvider";
import { App } from "./App";
import { Boundary } from "./shell/Boundary";

window.addEventListener("error", (e) => {
  if (e.message && !/ResizeObserver loop|^Script error\.?$/i.test(e.message)) noteError(e.message, "uncaught");
});
window.addEventListener("unhandledrejection", (e) => {
  const m = String(e.reason?.message ?? e.reason ?? "");
  if (m && !/abort|cancel/i.test(m)) noteError(m, "uncaught");
});
createRoot(document.getElementById("root")).render(
  <AppProvider>
    <Boundary>
      <App />
    </Boundary>
  </AppProvider>,
);
