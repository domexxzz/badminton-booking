import { chunkIntoGames, type CourtQueueView } from "@/lib/queue";

const gameLabel = (index: number) => (index === 0 ? "เกมถัดไป" : `อีก ${index} เกม`);

/** Read-only view of one court's queue, shared by customers (live) and anyone logged out. */
export function CourtQueueBoard({ view, myEntryId }: { view: CourtQueueView; myEntryId: string | null }) {
  return (
    <section className="card queue-court" aria-labelledby={`queue-court-${view.courtId}`}>
      <div className="queue-court-head">
        <h2 id={`queue-court-${view.courtId}`}>{view.courtName}</h2>
        <span className="muted">
          เกมละ {view.playersPerGame} คน · รอ {view.waiting.length} คน
        </span>
      </div>

      <div className="queue-on-court">
        <span className="queue-section-label">🏸 กำลังเล่น</span>
        {view.playing.length === 0 ? (
          <span className="muted">ยังไม่มีคนลงสนาม</span>
        ) : (
          <div className="queue-playing">
            {view.playing.map((r) => (
              <span key={r.entry_id} className={`queue-player ${r.entry_id === myEntryId ? "is-me" : ""}`}>
                {r.name}
                {r.entry_id === myEntryId && " (คุณ)"}
              </span>
            ))}
          </div>
        )}
      </div>

      {view.waiting.length === 0 ? (
        <p className="muted" style={{ margin: 0 }}>ยังไม่มีคนรอคิว</p>
      ) : (
        chunkIntoGames(view.waiting, view.playersPerGame).map((game, index) => (
          <div key={game[0].entry_id} className={`queue-game ${index === 0 ? "is-next" : ""}`}>
            <span className="queue-section-label">{gameLabel(index)}</span>
            <ol className="queue-list">
              {game.map((r, i) => {
                const isMe = r.entry_id === myEntryId;
                return (
                  <li key={r.entry_id} className={isMe ? "is-me" : undefined} aria-current={isMe ? "true" : undefined}>
                    <span className="queue-num">{index * view.playersPerGame + i + 1}</span>
                    <span className="queue-name">{r.name}</span>
                    {isMe && <span className="badge confirmed">คุณ</span>}
                  </li>
                );
              })}
            </ol>
          </div>
        ))
      )}
    </section>
  );
}
