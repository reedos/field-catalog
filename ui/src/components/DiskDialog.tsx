import { fmtBytes, fileName } from "../lib/format";
import type { DiskResult } from "../types";

export default function DiskDialog(props: {
  kind: "delete" | "offload";
  dryRun: DiskResult | null;
  confirmTyped: string;
  cloudOk: boolean;
  busy: boolean;
  onTyped: (v: string) => void;
  onCloudOk: (v: boolean) => void;
  onCancel: () => void;
  onExecute: () => void;
}) {
  const needed = props.kind === "delete" ? "DELETE_ORIGINALS" : "OFFLOAD_ORIGINALS";
  // Everything shown here comes from the dry run, never from `pending` -- the
  // list the user reads has to be the list that gets executed.
  const files = props.dryRun?.files || [];
  const count = props.dryRun?.count ?? 0;
  const bytes = props.dryRun?.bytes ?? 0;
  const errors = props.dryRun?.errors || [];
  const ready =
    !props.busy &&
    count > 0 &&
    props.confirmTyped === needed &&
    (props.kind === "delete" || props.cloudOk);

  return (
    <div className="fixed inset-0 z-[80] bg-ink/80 flex items-center justify-center p-6">
      <div className="bg-paper text-ink w-full max-w-3xl max-h-[90vh] flex flex-col font-serif">
        <div className="px-5 py-3 border-b border-paper-dim">
          <h2 className="text-xl">
            {props.kind === "delete" ? "Unlink rejected originals" : "Offload keeper originals"}
          </h2>
          <p className="text-sm text-bark mt-1">
            Previews stay in the library. Originals are unlinked only after this confirm.
            {props.kind === "delete" ? " Reject itself never deletes." : ""}
          </p>
        </div>
        <div className="px-5 py-2 text-sm">
          {count} file{count === 1 ? "" : "s"} · {fmtBytes(bytes)}
          {props.dryRun?.dry_run === false ? " · executed" : " · dry-run"}
        </div>
        <div className="flex-1 overflow-auto px-5">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-bark">
                <th className="py-1">File</th>
                <th>Size</th>
                <th>Preview kept</th>
              </tr>
            </thead>
            <tbody>
              {files.map((f) => (
                <tr key={f.id} className="border-t border-paper-dim align-top">
                  <td className="py-1 break-all">{f.path || f.original_path}</td>
                  <td className="whitespace-nowrap">{fmtBytes(f.bytes || 0)}</td>
                  <td>{fileName(f.preview_kept || f.preview_path || "")}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {errors.length ? (
            <ul className="mt-3 text-sm text-reject">
              {errors.map((e) => (
                <li key={e.id}>
                  {e.id}: {e.error}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        <div className="px-5 py-4 border-t border-paper-dim space-y-3">
          {props.kind === "offload" ? (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={props.cloudOk}
                onChange={(e) => props.onCloudOk(e.target.checked)}
              />
              Cloud copy of these keepers is done
            </label>
          ) : null}
          <label className="block text-sm">
            Type {needed} to confirm
            <input
              className="mt-1 w-full border border-paper-dim px-2 py-1 font-sans"
              value={props.confirmTyped}
              onChange={(e) => props.onTyped(e.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          <div className="flex justify-end gap-2">
            <button type="button" className="px-3 py-1 border border-bark" onClick={props.onCancel}>
              Cancel
            </button>
            <button
              type="button"
              className={`px-3 py-1 ${ready ? "bg-reject text-paper" : "bg-paper-dim text-bark"}`}
              disabled={!ready}
              onClick={props.onExecute}
            >
              {props.busy ? "Working…" : "Unlink originals"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
