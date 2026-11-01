import React from "react";
import ReactDOM from "react-dom/client";

// Font: bundled locally, no CDN — the app must work offline.
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "@fontsource/inter/800.css";

// Bootstrap + icons from node_modules, then custom.css (which overrides both).
// Order matters and matches templates/base.html.
import "bootstrap/dist/css/bootstrap.min.css";
import "bootstrap-icons/font/bootstrap-icons.css";
import "./styles/custom.css";

import App from "./App";
import { installExternalLinkGuard } from "./lib/externalLinks";

// Assistant replies can contain links; they open in the browser, never here.
installExternalLinkGuard();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
