// Shown instantly while a customer page renders on the server.
export default function Loading() {
  return (
    <div className="stack" aria-busy="true" aria-label="กำลังโหลด">
      <div className="skeleton" style={{ height: 120 }} />
      <div className="skeleton" style={{ height: 56, width: "60%" }} />
      <div className="skeleton" style={{ height: 220 }} />
    </div>
  );
}
