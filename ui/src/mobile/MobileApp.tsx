import { useCallback, useEffect, useState } from "react";
import "./mobile.css";
import { StoreProvider, useStore } from "./store";
import { TabBar, Toast, type TabKey } from "./ui";
import { Cull } from "./Cull";
import { Outings, ShotGrid } from "./Library";
import { Loupe, Viewer } from "./Viewer";
import { DetailSheet } from "./DetailSheet";
import { LabelDaySheet, LabelDays } from "./LabelDays";
import { BurstsScreen, Compare } from "./Bursts";
import { LifeListScreen } from "./LifeList";
import { More, type MoreRoute } from "./More";

/**
 * Field Catalog on a phone. The same library, the same worker and the same rules
 * as the desktop app -- this is only a different pair of hands on it.
 *
 * Screens are a small stack kept in the URL hash, so the phone's own back gesture
 * does what it looks like it should.
 */

type Overlay =
  | { kind: "viewer"; ids: string[]; id: string }
  | { kind: "compare"; id: string }
  | { kind: "loupe"; id: string }
  | { kind: "detail"; id: string }
  | { kind: "labelday"; day: string };

type Route =
  | { name: "tab"; tab: TabKey }
  | { name: "cull"; day: string | null }
  | { name: "grid"; day: string | null }
  | { name: "labeldays" }
  | { name: "more"; page: MoreRoute };

function parse(hash: string): Route {
  const [name, arg = ""] = hash.replace(/^#\/?/, "").split("/");
  const value = decodeURIComponent(arg);
  if (name === "cull" && arg) return { name: "cull", day: value === "all" ? null : value };
  if (name === "grid") return { name: "grid", day: value === "all" ? null : value };
  if (name === "labeldays") return { name: "labeldays" };
  if (name === "more" && value) return { name: "more", page: value as MoreRoute };
  if (["cull", "library", "bursts", "life", "more"].includes(name)) return { name: "tab", tab: name as TabKey };
  return { name: "tab", tab: "library" };
}

function useRoute(): [Route, (hash: string) => void, () => void] {
  const [route, setRoute] = useState<Route>(() => parse(window.location.hash));
  useEffect(() => {
    const on = () => setRoute(parse(window.location.hash));
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  const go = useCallback((hash: string) => { window.location.hash = hash; }, []);
  const back = useCallback(() => {
    if (window.history.length > 1) window.history.back();
    else window.location.hash = "#/library";
  }, []);
  return [route, go, back];
}

function Shell() {
  const store = useStore();
  const [route, go, back] = useRoute();

  // Overlays stack above whatever screen opened them. Each one is a history entry,
  // so the phone's back gesture closes the top one instead of leaving the screen
  // underneath, and changing screens never strands one on top.
  const [overlays, setOverlays] = useState<Overlay[]>([]);
  useEffect(() => {
    const onPop = () => setOverlays((stack) => stack.slice(0, -1));
    const onHash = () => setOverlays([]);
    window.addEventListener("popstate", onPop);
    window.addEventListener("hashchange", onHash);
    return () => {
      window.removeEventListener("popstate", onPop);
      window.removeEventListener("hashchange", onHash);
    };
  }, []);
  const push = useCallback((o: Overlay) => {
    window.history.pushState({ overlay: o.kind }, "");
    setOverlays((stack) => [...stack, o]);
  }, []);
  const pop = useCallback(() => window.history.back(), []);
  const setDetailId = (id: string) => push({ kind: "detail", id });
  const setLoupeId = (id: string) => push({ kind: "loupe", id });
  const setCompareId = (id: string) => push({ kind: "compare", id });
  const setLabelDay = (day: string) => push({ kind: "labelday", day });

  const unrated = store.shots.reduce((n, s) => n + (s.verdict === "unrated" ? 1 : 0), 0);

  if (!store.ready) {
    return (
      <div className="m-app">
        <div className="grid flex-1 place-items-center px-8 text-center">
          <div>
            <p className="font-serif text-2xl text-paper">Field Catalog</p>
            <p className="mt-2 text-sm text-paper-dim/80">{store.error || store.busy || "Opening library…"}</p>
            {store.error ? <button type="button" className="m-btn mt-5" onClick={() => window.location.reload()}>Try again</button> : null}
          </div>
        </div>
      </div>
    );
  }

  const open = (ids: string[], id: string) => push({ kind: "viewer", ids, id });
  let screen;
  let tab: TabKey | null = null;

  if (route.name === "cull") {
    screen = <Cull key={`cull-${route.day}`} day={route.day} onExit={back} onInfo={setDetailId} onLoupe={setLoupeId} onCompare={setCompareId} />;
  } else if (route.name === "grid") {
    tab = "library";
    screen = <ShotGrid key={`grid-${route.day}`} day={route.day} onBack={back} onOpen={open}
                       onCull={(d) => go(`#/cull/${d ?? "all"}`)} onLabelDay={setLabelDay} />;
  } else if (route.name === "labeldays") {
    tab = "more";
    screen = <LabelDays onBack={back} onPick={setLabelDay} />;
  } else if (route.name === "more") {
    tab = "more";
    screen = <More page={route.page} onBack={back} go={go} onOpen={open} />;
  } else {
    tab = route.tab;
    if (route.tab === "cull") {
      screen = <Outings mode="cull" onOpen={(d) => go(`#/grid/${d}`)} onCull={(d) => go(`#/cull/${d ?? "all"}`)} onAll={() => go("#/grid/all")} />;
    } else if (route.tab === "bursts") screen = <BurstsScreen onCompare={setCompareId} />;
    else if (route.tab === "life") screen = <LifeListScreen onOpen={open} />;
    else if (route.tab === "more") screen = <More page={null} onBack={back} go={go} onOpen={open} />;
    else screen = <Outings onOpen={(d) => go(`#/grid/${d}`)} onCull={(d) => go(`#/cull/${d ?? "all"}`)} onAll={() => go("#/grid/all")} />;
  }

  return (
    <div className="m-app">
      {screen}
      {tab ? (
        <TabBar
          tab={tab}
          badges={{ cull: unrated }}
          onTab={(t) => go(`#/${t}`)}
        />
      ) : null}

      {overlays.map((o, i) => {
        if (o.kind === "viewer") return <Viewer key={i} ids={o.ids} startId={o.id} onClose={pop} onInfo={setDetailId} onLoupe={setLoupeId} onCompare={setCompareId} />;
        if (o.kind === "compare") return <Compare key={i} burstId={o.id} onClose={pop} onLoupe={setLoupeId} />;
        if (o.kind === "loupe") return <Loupe key={i} id={o.id} onClose={pop} />;
        if (o.kind === "detail") return <DetailSheet key={i} id={o.id} onClose={pop} onLabelDay={setLabelDay} />;
        return <LabelDaySheet key={i} day={o.day} onClose={pop} />;
      })}

      {store.busy ? <div className="m-toast">{store.busy}</div> : null}
      <Toast message={store.error} tone="error" onClose={() => store.setError("")} />
      <Toast message={store.error ? "" : store.notice} onClose={() => store.setNotice("")} />
    </div>
  );
}

export default function MobileApp() {
  return (
    <StoreProvider>
      <Shell />
    </StoreProvider>
  );
}
