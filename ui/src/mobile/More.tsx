import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../lib/worker";
import { previewUrl } from "../lib/preview";
import { fileName, fmtBytes, fmtDate } from "../lib/format";
import { useDiskFlow } from "../hooks/useDiskFlow";
import { byShootingOrder, useStore } from "./store";
import { Chip, Empty, Row, TopBar } from "./ui";

const MapView = lazy(() => import("../components/MapView"));

export type MoreRoute = "map" | "import" | "export" | "disk" | "identify" | "audit" | "slideshow" | "help";

/** Everything that is not culling: the rest of the desktop app, a tap away. */
export function More(props: {
  page: MoreRoute | null;
  onBack: () => void;
  go: (hash: string) => void;
  onOpen: (ids: string[], id: string) => void;
}) {
  const store = useStore();
  const bare = store.outings.filter((o) => o.day && o.unplaced > 0).length;
  const unnamed = store.shots.filter((s) => s.verdict === "keep" && !s.common_name).length;

  if (props.page === "map") return <MapPage onBack={props.onBack} onOpen={props.onOpen} />;
  if (props.page === "import") return <ImportPage onBack={props.onBack} />;
  if (props.page === "export") return <ExportPage onBack={props.onBack} />;
  if (props.page === "disk") return <DiskPage onBack={props.onBack} />;
  if (props.page === "identify") return <IdentifyPage onBack={props.onBack} />;
  if (props.page === "audit") return <AuditPage onBack={props.onBack} />;
  if (props.page === "slideshow") return <Slideshow onClose={props.onBack} />;
  if (props.page === "help") return <HelpPage onBack={props.onBack} />;

  return (
    <div className="m-screen">
      <TopBar title="More" sub={store.library} />
      <div className="m-scroll pb-6">
        <p className="m-section">Places</p>
        <Row label="Label days" hint={bare ? `${bare} shooting days have frames with no place` : "Name a whole day's shooting at once"} onClick={() => props.go("#/labeldays")} />
        <Row label="Map" hint="Everything with a place, on a map" onClick={() => props.go("#/more/map")} />

        <p className="m-section">Identification</p>
        <Row label="Name the unnamed" hint={unnamed ? `${unnamed} keepers have no species yet` : "Every keeper has a name"} onClick={() => props.go("#/more/identify")} />

        <p className="m-section">Looking</p>
        <Row label="Slideshow" hint="Your keepers, full screen" onClick={() => props.go("#/more/slideshow")} />

        <p className="m-section">Files on the PC</p>
        <Row label="Import a folder" hint="Originals stay where they are; only a preview enters the library" onClick={() => props.go("#/more/import")} />
        <Row label="Export keepers" hint="Copy the originals you kept to a folder, with a CSV" onClick={() => props.go("#/more/export")} />
        <Row label="Free up disk space" hint="Delete rejected originals, or offload keepers. Always a dry run first." danger onClick={() => props.go("#/more/disk")} />
        <Row label="Audit log" hint="Every file this app has ever removed" onClick={() => props.go("#/more/audit")} />

        <p className="m-section">This app</p>
        <Row label="How culling works here" onClick={() => props.go("#/more/help")} />
        <Row label="Open the desktop layout" hint="The full keyboard interface, in this browser" onClick={() => { window.location.href = "/?desktop=1"; }} />
      </div>
    </div>
  );
}

function MapPage(props: { onBack: () => void; onOpen: (ids: string[], id: string) => void }) {
  const store = useStore();
  return (
    <div className="m-screen">
      <TopBar title="Map" onBack={props.onBack} />
      <div className="relative min-h-0 flex-1">
        <Suspense fallback={<p className="grid h-full place-items-center text-sm text-paper-dim/70">Loading the map…</p>}>
          <MapView shots={store.shots} onOpen={(id) => props.onOpen([id], id)} onLocation={(id, label) => void store.setLocationLabel(id, label)} />
        </Suspense>
      </div>
    </div>
  );
}

function PathForm(props: { label: string; placeholder: string; hint: string; action: string; busy: boolean; onRun: (path: string) => void }) {
  const [path, setPath] = useState("");
  return (
    <div className="px-5 pt-2">
      <label className="m-label" htmlFor="m-path">{props.label}</label>
      <input id="m-path" className="m-input font-mono !text-[15px]" value={path} onChange={(e) => setPath(e.target.value)}
             placeholder={props.placeholder} autoCapitalize="none" autoCorrect="off" spellCheck={false} enterKeyHint="go" />
      <p className="mt-2 text-xs leading-relaxed text-paper-dim/75">{props.hint}</p>
      <button type="button" className="m-btn m-btn-keep m-btn-block mt-4" disabled={!path.trim() || props.busy} onClick={() => props.onRun(path.trim())}>
        {props.busy ? "Working…" : props.action}
      </button>
    </div>
  );
}

function ImportPage(props: { onBack: () => void }) {
  const store = useStore();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState("");
  return (
    <div className="m-screen">
      <TopBar title="Import a folder" onBack={props.onBack} />
      <div className="m-scroll">
        <PathForm
          label="Folder on the PC" placeholder="E:\DCIM\100ND850" action="Import" busy={busy}
          hint="This is a path on the PC, not on this phone: a card in the reader, or a folder of photographs. Nothing is moved or copied but a preview of each frame."
          onRun={async (source) => {
            setBusy(true);
            setDone("");
            try {
              const res = (await api.importSource(source)) as { imported?: number; skipped?: number; duplicates?: number };
              await store.reload();
              setDone(`${res.imported ?? 0} imported · ${res.skipped ?? 0} already in the library · ${res.duplicates ?? 0} duplicates`);
            } catch (e) {
              store.fail(e);
            } finally {
              setBusy(false);
            }
          }}
        />
        {done ? <p className="mx-5 mt-4 rounded-lg border border-moss/50 bg-moss/10 px-3 py-2 text-sm text-paper">{done}</p> : null}
      </div>
    </div>
  );
}

function ExportPage(props: { onBack: () => void }) {
  const store = useStore();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState("");
  const keepers = store.shots.filter((s) => s.verdict === "keep" && s.original_status === "present");
  const bytes = keepers.reduce((n, s) => n + (s.bytes_original || 0), 0);
  return (
    <div className="m-screen">
      <TopBar title="Export keepers" sub={`${keepers.length} originals · ${fmtBytes(bytes)}`} onBack={props.onBack} />
      <div className="m-scroll">
        <PathForm
          label="Destination folder on the PC" placeholder="D:\Handoff\2026-09" action={`Copy ${keepers.length} originals`} busy={busy}
          hint="Originals are copied, never moved, with a CSV of what each frame is. The folder is on the PC."
          onRun={async (dest) => {
            setBusy(true);
            setDone("");
            try {
              const res = await api.exportOriginals(dest, "keep");
              setDone(`${res.exported} copied (${fmtBytes(res.bytes)}) to ${res.dest}${res.missing ? ` · ${res.missing} originals were missing` : ""}`);
            } catch (e) {
              store.fail(e);
            } finally {
              setBusy(false);
            }
          }}
        />
        {done ? <p className="mx-5 mt-4 rounded-lg border border-moss/50 bg-moss/10 px-3 py-2 text-sm text-paper">{done}</p> : null}
      </div>
    </div>
  );
}

/**
 * The only screen that can remove a file. It keeps every rule the desk keeps: a
 * dry run first, the list you confirm is the list that goes, the exact word typed
 * out, the recycle bin, a catalog backup before anything happens. The server adds
 * one of its own -- it refuses an execute it has not just shown you the list for.
 */
function DiskPage(props: { onBack: () => void }) {
  const store = useStore();
  const flow = useDiskFlow({
    shots: store.shots, reload: store.reload, setBusy: store.setBusy, setError: store.setError, closeDetail: () => {},
  });
  const rejected = store.shots.filter((s) => s.verdict === "reject" && s.original_status === "present");
  const kept = store.shots.filter((s) => s.verdict === "keep" && s.original_status === "present");
  const sum = (list: typeof rejected) => fmtBytes(list.reduce((n, s) => n + (s.bytes_original || 0), 0));

  if (flow.disk) {
    const { kind, dryRun } = flow.disk;
    const word = kind === "delete" ? "DELETE_ORIGINALS" : "OFFLOAD_ORIGINALS";
    const files = dryRun?.files || [];
    const ready = !store.busy && (dryRun?.count ?? 0) > 0 && flow.confirmTyped === word && (kind === "delete" || flow.cloudOk);
    return (
      <div className="m-screen">
        <TopBar title={kind === "delete" ? "Delete rejected originals" : "Offload keeper originals"}
                sub={`${dryRun?.count ?? 0} files · ${fmtBytes(dryRun?.bytes ?? 0)} · ${dryRun?.dry_run === false ? "done" : "dry run, nothing removed yet"}`}
                onBack={() => flow.setDisk(null)} />
        <div className="m-scroll px-5 pb-6">
          <p className="mt-3 text-sm leading-relaxed text-paper-dim">
            Previews stay in the library, so every frame stays in the catalog. The files go to the PC's recycle bin, and the catalog is backed up first.
          </p>
          <ul className="mt-3 max-h-[34dvh] overflow-y-auto rounded-lg border border-bark/70 bg-ink/60 text-xs">
            {files.slice(0, 200).map((f) => (
              <li key={f.id} className="flex gap-2 border-b border-bark/40 px-3 py-1.5 last:border-0">
                <span className="min-w-0 flex-1 truncate font-mono text-paper-dim" title={f.path || f.original_path}>{fileName(f.path || f.original_path || "")}</span>
                <span className="tabular-nums text-paper-dim/70">{fmtBytes(f.bytes || 0)}</span>
              </li>
            ))}
          </ul>
          {files.length > 200 ? <p className="mt-1.5 text-xs text-paper-dim/70">Showing the first 200 of {files.length}. All {files.length} would go.</p> : null}
          {dryRun?.errors?.length ? (
            <ul className="mt-3 space-y-1 text-xs text-reject">{dryRun.errors.map((e) => <li key={e.id}>{e.id.slice(0, 8)}: {e.error}</li>)}</ul>
          ) : null}
          {kind === "offload" ? (
            <label className="mt-4 flex items-start gap-3 text-sm text-paper">
              <input type="checkbox" className="mt-0.5 h-5 w-5 accent-[#6a7a52]" checked={flow.cloudOk} onChange={(e) => flow.setCloudOk(e.target.checked)} />
              <span>I have checked that these originals are safely copied somewhere else.</span>
            </label>
          ) : null}
          <label className="m-label" htmlFor="m-confirm">Type {word} to confirm</label>
          <input id="m-confirm" className="m-input font-mono !text-[15px]" value={flow.confirmTyped} onChange={(e) => flow.setConfirmTyped(e.target.value)}
                 autoCapitalize="characters" autoCorrect="off" spellCheck={false} placeholder={word} />
          <button type="button" className="m-btn m-btn-danger m-btn-block mt-4" disabled={!ready} onClick={() => void flow.executeDisk()}>
            Remove {dryRun?.count ?? 0} original{(dryRun?.count ?? 0) === 1 ? "" : "s"}
          </button>
          <button type="button" className="m-btn m-btn-block mt-2" onClick={() => flow.setDisk(null)}>Cancel</button>
        </div>
      </div>
    );
  }

  return (
    <div className="m-screen">
      <TopBar title="Free up disk space" onBack={props.onBack} />
      <div className="m-scroll px-5 pb-6">
        <p className="mt-3 text-sm leading-relaxed text-paper-dim">
          Rejecting a frame never deletes it. This is where files actually leave the PC, and it always starts with a list of exactly what would go.
        </p>
        <div className="mt-4 rounded-xl border border-bark/70 p-4">
          <p className="font-serif text-[17px] text-paper">Rejected originals</p>
          <p className="mt-0.5 text-sm text-paper-dim/80">{rejected.length} files still on disk · {sum(rejected)}</p>
          <button type="button" className="m-btn m-btn-reject m-btn-block mt-3" disabled={!rejected.length} onClick={() => void flow.openDelete()}>
            See what would be deleted
          </button>
        </div>
        <div className="mt-3 rounded-xl border border-bark/70 p-4">
          <p className="font-serif text-[17px] text-paper">Keeper originals</p>
          <p className="mt-0.5 text-sm text-paper-dim/80">{kept.length} files still on disk · {sum(kept)}</p>
          <p className="mt-1 text-xs leading-snug text-paper-dim/70">Only once they are safely copied elsewhere. The catalog and the previews keep every frame.</p>
          <button type="button" className="m-btn m-btn-block mt-3" disabled={!kept.length} onClick={() => void flow.openOffload()}>
            See what would be offloaded
          </button>
        </div>
      </div>
    </div>
  );
}

function IdentifyPage(props: { onBack: () => void }) {
  const store = useStore();
  const id = store.identify;
  const [model, setModel] = useState(id.ollamaModel);
  useEffect(() => setModel(id.ollamaModel), [id.ollamaModel]);
  const unnamed = useMemo(
    () => store.shots.filter((s) => s.verdict === "keep" && !s.common_name && !s.scientific_name).sort(byShootingOrder),
    [store.shots],
  );
  return (
    <div className="m-screen">
      <TopBar title="Identification" onBack={props.onBack} />
      <div className="m-scroll px-5 pb-6">
        <div className="mt-4 rounded-xl border border-bark/70 p-4">
          <p className="font-serif text-[17px] text-paper">{unnamed.length} keepers without a name</p>
          <p className="mt-1 text-xs leading-snug text-paper-dim/75">
            The model runs on the PC, one frame at a time, and you can stop it between frames. It is a first guess: low confidence means look it up.
          </p>
          {id.identifyingSeries ? (
            <button type="button" className="m-btn m-btn-reject m-btn-block mt-3" onClick={id.cancel}>Stop after this frame</button>
          ) : (
            <button type="button" className="m-btn m-btn-keep m-btn-block mt-3" disabled={!unnamed.length}
                    onClick={() => void id.runIdentifySeries(unnamed, new Set())}>
              Name them
            </button>
          )}
        </div>

        <p className="m-label">Who does the identifying</p>
        <div className="flex gap-2">
          <Chip active={id.backend === "ollama"} onClick={() => void id.saveBackend({ backend: "ollama" })}>A model on the PC (Ollama)</Chip>
          <Chip active={id.backend === "xai"} onClick={() => void id.saveBackend({ backend: "xai" })}>xAI</Chip>
        </div>
        {id.backend === "ollama" ? (
          <>
            <label className="m-label" htmlFor="m-model">Ollama model</label>
            <div className="flex gap-2">
              <input id="m-model" className="m-input font-mono !text-[15px]" value={model} onChange={(e) => setModel(e.target.value)}
                     autoCapitalize="none" autoCorrect="off" spellCheck={false} />
              <button type="button" className="m-btn" disabled={!model.trim() || model === id.ollamaModel} onClick={() => void id.saveBackend({ model: model.trim() })}>Save</button>
            </div>
          </>
        ) : (
          <>
            <label className="m-label" htmlFor="m-key">xAI API key {id.hasXaiKey ? "(one is saved)" : ""}</label>
            <div className="flex gap-2">
              <input id="m-key" className="m-input font-mono !text-[15px]" type="password" value={id.xaiKeyDraft} onChange={(e) => id.setXaiKeyDraft(e.target.value)}
                     placeholder={id.hasXaiKey ? "Replace the saved key" : "xai-…"} autoComplete="off" />
              <button type="button" className="m-btn" disabled={!id.xaiKeyDraft.trim()} onClick={() => void id.saveKey()}>Save</button>
            </div>
            <p className="mt-2 text-xs leading-snug text-paper-dim/70">The key is stored in the library folder on the PC. With xAI, the preview image is sent to the provider; nothing else is.</p>
          </>
        )}
      </div>
    </div>
  );
}

type AuditEntry = { ts?: string; action?: string; count?: number; bytes?: number };

function AuditPage(props: { onBack: () => void }) {
  const store = useStore();
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  useEffect(() => {
    api.audit(200).then((r) => setEntries((r.entries || []) as AuditEntry[])).catch(store.fail);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="m-screen">
      <TopBar title="Audit log" sub="Every removal, newest first" onBack={props.onBack} />
      {entries === null ? <Empty title="Reading the log…" /> : entries.length ? (
        <div className="m-scroll">
          {[...entries].reverse().map((e, i) => (
            <Row key={i} label={`${e.action || "removed"} · ${e.count ?? 0} file${e.count === 1 ? "" : "s"}`}
                 hint={`${fmtDate(e.ts || "")} · ${fmtBytes(e.bytes || 0)}`} />
          ))}
        </div>
      ) : <Empty title="Nothing has ever been removed">This log records every original the app unlinks.</Empty>}
    </div>
  );
}

function HelpPage(props: { onBack: () => void }) {
  const items: Array<[string, string]> = [
    ["Swipe right", "Keep. Swipe left to reject, up to leave it for later."],
    ["Tap the photograph", "Opens the loupe. Tap where you want to check focus and the PC sends that spot at 1:1 from the original."],
    ["Undo", "Walks back through the session, taking each verdict back with it."],
    ["Bursts", "A run of near-identical frames. Keep the sharpest, or compare them and mark your own."],
    ["Reject is not delete", "A verdict is a mark. Files only leave the PC from Free up disk space, after a list and a typed confirmation."],
    ["Places", "Most frames have no GPS. Name a whole day at once in Label days, and the map uses the centre of that place."],
    ["Names you type", "A species you correct by hand is recorded as certain, and the model will not overwrite it."],
  ];
  return (
    <div className="m-screen">
      <TopBar title="How it works" onBack={props.onBack} />
      <div className="m-scroll px-5 pb-6">
        {items.map(([k, v]) => (
          <div key={k} className="border-b border-bark/50 py-3.5">
            <p className="font-serif text-[16px] text-paper">{k}</p>
            <p className="mt-0.5 text-sm leading-relaxed text-paper-dim/85">{v}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Keepers, full screen, one after another. Tap to pause; swipe to move; tap the corner to leave. */
function Slideshow(props: { onClose: () => void }) {
  const store = useStore();
  const [favs, setFavs] = useState(false);
  const list = useMemo(
    () => store.shots.filter((s) => (favs ? s.favorite : s.verdict === "keep")).sort((a, b) => -byShootingOrder(a, b)),
    [store.shots, favs],
  );
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(true);
  const startX = useRef<number | null>(null);
  useEffect(() => setIndex(0), [favs]);
  useEffect(() => {
    if (!playing || list.length < 2) return;
    const t = setTimeout(() => setIndex((i) => (i + 1) % list.length), 4500);
    return () => clearTimeout(t);
  }, [playing, index, list.length]);

  const shot = list[index];
  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-black m-noselect">
      {shot ? (
        <div className="relative min-h-0 flex-1 touch-none"
             onPointerDown={(e) => { startX.current = e.clientX; }}
             onPointerUp={(e) => {
               const d = startX.current === null ? 0 : e.clientX - startX.current;
               startX.current = null;
               if (Math.abs(d) < 9) setPlaying((p) => !p);
               else setIndex((i) => (i + (d < 0 ? 1 : -1) + list.length) % list.length);
             }}>
          <img key={shot.id} src={previewUrl(shot.preview_path)} alt="" draggable={false} className="h-full w-full object-contain" style={{ animation: "m-fade .5s ease-out" }} />
          <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-5 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-10">
            <p className="font-serif text-xl text-paper">{shot.common_name || ""}</p>
            <p className="text-xs text-paper-dim/80">{[shot.location, fmtDate(shot.captured_at)].filter(Boolean).join(" · ")}</p>
          </div>
        </div>
      ) : (
        <Empty title={favs ? "No favourites yet" : "No keepers yet"} />
      )}
      <div className="absolute inset-x-0 top-0 flex items-center gap-2 px-2 pt-[calc(env(safe-area-inset-top)+0.35rem)]">
        <button type="button" className="m-iconbtn" onClick={props.onClose} aria-label="Close">
          <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" aria-hidden><path d="M6 6l12 12M18 6L6 18" /></svg>
        </button>
        <span className="flex-1" />
        <Chip active={!favs} onClick={() => setFavs(false)}>Keepers</Chip>
        <Chip active={favs} tone="ochre" onClick={() => setFavs(true)}>Favourites</Chip>
        <span className="w-12 text-right text-xs tabular-nums text-paper-dim/70">{list.length ? `${index + 1}/${list.length}` : ""}{playing ? "" : " ❙❙"}</span>
      </div>
    </div>
  );
}
