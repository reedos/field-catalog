import React, { Suspense, lazy } from "react";
import ReactDOM from "react-dom/client";
import { isTauri } from "./lib/preview";
import "./index.css";

// Served to a browser by `fieldcatalog web`, a narrow screen gets the phone
// interface: the same library and the same rules in a different pair of hands.
// The desktop shell always gets the desktop app, and ?desktop=1 asks for it in a
// browser (?phone=1 asks for the other, on a wide screen).
// Each is its own chunk: a phone should not download the desktop app to not use it.
const App = lazy(() => import("./App"));
const MobileApp = lazy(() => import("./mobile/MobileApp"));

function wantsPhone(): boolean {
  if (isTauri()) return false;
  const q = new URLSearchParams(window.location.search);
  if (q.has("desktop")) return false;
  if (q.has("phone")) return true;
  return window.matchMedia("(max-width: 820px), (pointer: coarse) and (max-width: 1100px)").matches;
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Suspense fallback={null}>{wantsPhone() ? <MobileApp /> : <App />}</Suspense>
  </React.StrictMode>,
);
