// Shown instantly while an admin page renders on the server.
export default function Loading() {
  return (
    <div className="stack" aria-busy="true" aria-label="กำลังโหลด">
      <div className="skeleton" style={{ height: 44 }} />
      <div className="kpi-grid">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="skeleton" style={{ height: 88 }} />
        ))}
      </div>
      <div className="skeleton" style={{ height: 200 }} />
    </div>
  );
}
