import { formatPhone, lineUrl } from "@/lib/contact-format";
import { getShopContact } from "@/lib/shop-contact";

/** "Ask the shop" card for customers; renders nothing until an admin fills it in. */
export async function ShopContactCard({ title = "สอบถาม / ติดต่อแอดมิน" }: { title?: string }) {
  const { name, phone, line } = await getShopContact();
  if (!phone && !line) return null;

  return (
    <section className="card stack contact-card" style={{ gap: 10 }} aria-label="ติดต่อแอดมิน">
      <div>
        <h2 style={{ margin: 0 }}>{title}</h2>
        <p className="muted" style={{ margin: "2px 0 0", fontSize: 14 }}>
          {name ? `ติดต่อคุณ ${name}` : "ติดต่อร้าน"} เรื่องการจอง เลื่อน ยกเลิก หรือคืนเงิน
        </p>
      </div>
      <div className="contact-actions">
        {line && (
          <a className="btn btn-line btn-block" href={lineUrl(line)} target="_blank" rel="noreferrer">
            💬 ทักแชท LINE
          </a>
        )}
        {phone && (
          <a className="btn btn-ghost btn-block" href={`tel:${phone}`}>
            📞 โทร {formatPhone(phone)}
          </a>
        )}
      </div>
      {line && !/^https:\/\//.test(line) && (
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>LINE ID: {line}</p>
      )}
    </section>
  );
}
