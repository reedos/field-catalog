import type { Shot } from "../types";

export default function LifeList(props: {
  shots: Shot[];
  onOpenSpecies: (name: string) => void;
}) {
  const map = new Map<string, { common: string; scientific: string; type: string | null; count: number }>();
  for (const s of props.shots) {
    const key = (s.scientific_name || s.common_name || "").trim();
    if (!key) continue;
    const cur = map.get(key);
    if (cur) cur.count += 1;
    else
      map.set(key, {
        common: s.common_name || key,
        scientific: s.scientific_name || "",
        type: s.animal_type,
        count: 1,
      });
  }
  const rows = [...map.values()].sort((a, b) => a.common.localeCompare(b.common));

  return (
    <div className="h-full overflow-auto p-8 font-serif text-paper">
      <h2 className="text-2xl mb-1">Life list</h2>
      <p className="text-sm text-paper-dim mb-6">
        {rows.length} identified species · from catalog IDs only
      </p>
      <table className="w-full text-left text-sm">
        <thead className="text-ochre">
          <tr>
            <th className="py-2">Common</th>
            <th>Scientific</th>
            <th>Type</th>
            <th className="text-right">Frames</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.common + r.scientific} className="border-t border-bark">
              <td className="py-2">
                <button
                  type="button"
                  className="text-moss hover:underline"
                  onClick={() => props.onOpenSpecies(r.common)}
                >
                  {r.common}
                </button>
              </td>
              <td className="italic text-paper-dim">{r.scientific || "—"}</td>
              <td>{r.type || "—"}</td>
              <td className="text-right">{r.count}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 ? (
        <p className="mt-8 text-paper-dim">No species IDs yet. Save an ID from the viewer.</p>
      ) : null}
    </div>
  );
}
