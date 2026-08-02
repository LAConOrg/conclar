import "./polyfills";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { registerServiceWorker } from "./registerServiceWorker";
import { reloadOnStaleChunk } from "./reloadOnStaleChunk";

// Set publicUrl from Vite's BASE_URL environment variable
window.publicUrl = import.meta.env.BASE_URL;

reloadOnStaleChunk();
registerServiceWorker();

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
