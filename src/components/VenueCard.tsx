/**
 * Where the venue is and what it has: a map, a directions button and the facilities.
 * Opening hours, courts and price already sit in the home page hero, so they are not
 * repeated here.
 *
 * TODO(โดม): the shop's real location is not in the code yet. Paste the pin from Google
 * Maps (open the place → Share → copy the coordinates, e.g. 13.7563, 100.5018) into
 * VENUE_LOCATION, and list the facilities in VENUE_AMENITIES. Until one of them is set
 * the card does not render at all — nothing is guessed.
 */
const VENUE_LOCATION: { lat: number; lng: number } | null = null;
const VENUE_AMENITIES: string[] = [];

export function VenueCard() {
  const pin = VENUE_LOCATION ? `${VENUE_LOCATION.lat},${VENUE_LOCATION.lng}` : null;
  if (!pin && VENUE_AMENITIES.length === 0) return null;

  return (
    <section className="card venue-card" aria-labelledby="venue-card-title">
      <h2 id="venue-card-title">📍 ที่ตั้งและสิ่งอำนวยความสะดวก</h2>

      {pin && (
        <>
          <iframe
            className="venue-map"
            title="แผนที่สนาม"
            src={`https://maps.google.com/maps?q=${pin}&z=16&output=embed`}
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
          />
          <div className="venue-actions">
            <a
              className="btn"
              href={`https://www.google.com/maps/dir/?api=1&destination=${pin}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              🧭 นำทางด้วย Google Maps
            </a>
          </div>
        </>
      )}

      {VENUE_AMENITIES.length > 0 && (
        <ul className="venue-amenities">
          {VENUE_AMENITIES.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
