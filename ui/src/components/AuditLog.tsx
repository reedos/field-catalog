export default function AuditLog(props: {
  entries: { ts: string; action: string; count: number; bytes: number }[];
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[90] bg-ink/80 flex items-center justify-center p-6">
      <div className="fc-card w-full max-w-2xl max-h-[80vh] flex flex-col font-serif">
        <div className="px-5 py-3 border-b border-paper-dim">
          <h2 className="text-xl">Audit log</h2>
          <p className="text-sm text-bark mt-1">Recent disk operations</p>
        </div>
        <div className="flex-1 overflow-auto px-5 py-3">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-bark">
                <th className="py-1">Time</th>
                <th>Action</th>
                <th>Count</th>
                <th>Bytes</th>
              </tr>
            </thead>
            <tbody>
              {props.entries.map((e, i) => (
                <tr key={i} className="border-t border-paper-dim">
                  <td className="py-1">{new Date(e.ts).toLocaleString()}</td>
                  <td>{e.action}</td>
                  <td>{e.count}</td>
                  <td>{(e.bytes / 1024 / 1024).toFixed(1)} MB</td>
                </tr>
              ))}
            </tbody>
          </table>
          {props.entries.length === 0 && (
            <p className="text-sm text-bark">No audit entries yet.</p>
          )}
        </div>
        <div className="px-5 py-3 border-t border-paper-dim text-right">
          <button className="px-3 py-1 border border-bark" onClick={props.onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
