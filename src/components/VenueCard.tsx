/**
 * Where the venue is and what it has: a map, a directions button and the facilities.
 * Opening hours, courts and price already sit in the home page hero, so they are not
 * repeated here.
 *
 * The place is the one in the shop's own Google Maps share link
 * (https://maps.app.goo.gl/LAUcgQFLXXvXg8jc9): its plus code and name, so Google lands on
 * the shop's pin rather than on coordinates someone typed in.
 *
 * TODO(โดม): list the facilities in VENUE_AMENITIES (parking, showers, …); the list stays
 * hidden while it is empty — nothing is guessed.
 */
const VENUE_PLACE: string | null = "2P49+6JR แบดมินตัน@สินธานี ตำบล รังสิต อำเภอธัญบุรี ปทุมธานี 12110";
const VENUE_AMENITIES: string[] = [];

export function VenueCard() {
  const place = VENUE_PLACE ? encodeURIComponent(VENUE_PLACE) : null;
  if (!place && VENUE_AMENITIES.length === 0) return null;

  return (
    <section className="card venue-card" aria-labelledby="venue-card-title">
      <h2 id="venue-card-title">{VENUE_AMENITIES.length > 0 ? "📍 ที่ตั้งและสิ่งอำนวยความสะดวก" : "📍 ที่ตั้งสนาม"}</h2>

      {place && (
        <>
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>
            ตำบลรังสิต อำเภอธัญบุรี ปทุมธานี 12110
          </p>
          <iframe
            className="venue-map"
            title="แผนที่สนาม"
            src={`https://maps.google.com/maps?q=${place}&z=16&output=embed`}
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
          />
          <div className="venue-actions">
            <a
              className="btn"
              href={`https://www.google.com/maps/dir/?api=1&destination=${place}`}
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
