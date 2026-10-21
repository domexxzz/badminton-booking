import { formatPhone, lineUrl } from "@/lib/contact-format";
import { getPublicShopContact } from "@/lib/public-data";

/** "Ask the shop" card for customers; renders nothing until an admin fills it in. */
export async function ShopContactCard({ title = "สอบถาม / ติดต่อแอดมิน" }: { title?: string }) {
  const { name, phone, line } = await getPublicShopContact();
  if (!phone && !line) return null;

  return (
    <section className="card stack contact-card" style={{ gap: 12 }} aria-label="ติดต่อแอดมิน">
      <div>
        <h2 style={{ margin: 0, fontSize: 16 }}>{title}</h2>
        <p className="muted" style={{ margin: "3px 0 0", fontSize: 13.5 }}>
          {name ? `ติดต่อคุณ ${name}` : "ติดต่อร้าน"} เรื่องการจอง เลื่อน ยกเลิก หรือคืนเงิน
        </p>
      </div>
      <div className="contact-actions">
        {line && (
          <a className="btn btn-line btn-block" href={lineUrl(line)} target="_blank" rel="noreferrer">
            <span>💬</span>
            <span>ทักแชท LINE {!/^https:\/\//.test(line) && <span style={{ opacity: 0.9, fontWeight: 500, fontSize: 13.5 }}>(ID: {line})</span>}</span>
          </a>
        )}
        {phone && (
          <a className="btn btn-ghost btn-block" href={`tel:${phone}`}>
            <span>📞</span>
            <span>โทร {formatPhone(phone)}</span>
          </a>
        )}
      </div>
    </section>
  );
}
