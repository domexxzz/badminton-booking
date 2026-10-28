import Link from "next/link";
import { redirect } from "next/navigation";
import { LiveRefresh } from "@/components/LiveRefresh";
import { PostCard, type FeedComment, type FeedPost } from "@/components/community/PostCard";
import { PostComposer } from "@/components/community/PostComposer";
import { getSessionUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type PlayerCard = { player_key: string };

export default async function CommunityPage() {
  const { supabase, user, isAdmin, displayName } = await getSessionUser();
  // The feed is readable by signed-in players only (RLS, 0032), so an anonymous visitor
  // would see an empty page. Send them to sign in instead of showing nothing.
  if (!user) redirect("/login?next=/community");

  const [{ data: posts, error }, { data: settings }, { data: likeRows }, { data: cardRows }] = await Promise.all([
    supabase
      .from("community_feed")
      .select("post_id, author_key, author_name, avatar_url, body, image_path, party_title, likes, comments, created_at, edited_at, is_admin_post, expires_at")
      .or("expires_at.is.null,expires_at.gt.now()")
      .order("created_at", { ascending: false })
      .limit(50)
      .returns<FeedPost[]>(),
    supabase.from("community_settings").select("posting_open").eq("id", 1).maybeSingle(),
    supabase.rpc("my_community_likes"),
    supabase.rpc("my_player_card"),
  ]);

  if (error) {
    console.error("Failed to load the community feed:", error);
    return <p className="error">โหลดฟีดไม่สำเร็จ</p>;
  }

  const feed = posts ?? [];
  const postIds = feed.map((p) => p.post_id);
  const { data: commentRows } = postIds.length
    ? await supabase
        .from("community_comment_board")
        .select("comment_id, post_id, author_key, author_name, avatar_url, body, created_at")
        .in("post_id", postIds)
        .order("created_at")
        .returns<FeedComment[]>()
    : { data: [] as FeedComment[] };

  const likedIds = new Set(((likeRows as { post_id: string }[] | null) ?? []).map((r) => r.post_id));
  const myKey = ((cardRows as PlayerCard[] | null) ?? [])[0]?.player_key ?? null;
  const postingOpen = settings?.posting_open !== false;

  return (
    <>
      <LiveRefresh table="community_feed" />
      <LiveRefresh table="community_comment_board" />
      <section className="stack community-page">
        <header className="card community-hero">
          <div className="party-list-icon">💬</div>
          <div>
            <h1>คุยกับเพื่อนร่วมก๊วน</h1>
            <span>เล่าเรื่องคืนที่ผ่านมา ถามหาคู่ซ้อม หรือแชร์รูปและคลิปวิดีโอสนุกๆ</span>
          </div>
        </header>

        <div className="card community-expiry-banner">
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 700, fontSize: 13.5 }}>
            <span>⏳</span>
            <span>กติกาการแสดงโพสต์</span>
          </div>
          <p style={{ margin: "4px 0 0", fontSize: 13, lineHeight: 1.6, color: "var(--muted)" }}>
            โพสต์ของลูกค้าจะมีอายุ <strong>7 วัน</strong> (ระบบจะลบอัตโนมัติเมื่อครบกำหนด เพื่อรักษาบรรยากาศก๊วนให้สดใหม่อยู่เสมอ) · โพสต์ของแอดมินจะแสดงผล<strong>ถาวร</strong>
          </p>
        </div>

        <PostComposer
          open={postingOpen}
          displayName={displayName ?? ""}
          userId={user.id}
          isAdmin={isAdmin}
        />

        {feed.length === 0 ? (
          <div className="card community-empty">
            <strong>ยังไม่มีใครโพสต์</strong>
            <span className="muted">เป็นคนแรกที่เล่าเรื่องคืนก๊วนให้เพื่อนฟังสิ</span>
          </div>
        ) : (
          feed.map((post) => (
            <PostCard
              key={post.post_id}
              post={post}
              comments={(commentRows ?? []).filter((c) => c.post_id === post.post_id)}
              myKey={myKey}
              liked={likedIds.has(post.post_id)}
              postingOpen={postingOpen}
              isAdmin={isAdmin}
            />
          ))
        )}

        <div className="card community-rules">
          <h2>ข้อกำหนดและกติกาการใช้งาน</h2>
          <ul>
            <li>สื่อสารด้วยความสุภาพและเคารพซึ่งกันและกัน เพื่อสร้างบรรยากาศที่ดีในกลุ่มผู้รักกีฬาแบดมินตัน</li>
            <li>สามารถแนบรูปภาพ (ขนาดสูงสุด 10MB) หรือคลิปวิดีโอ (ขนาดสูงสุด 50MB) ที่เกี่ยวข้องกับกิจกรรมการเล่นกีฬาภายในสนาม</li>
            <li>โพสต์ของสมาชิกทั่วไปมีอายุการแสดงผล 7 วัน (ระบบจะลบโดยอัตโนมัติเมื่อครบกำหนด) ส่วนโพสต์ประชาสัมพันธ์จากผู้ดูแลระบบจะแสดงผลถาวร</li>
            <li>ไม่อนุญาตให้โพสต์โฆษณาเชิงพาณิชย์ ส่งข้อความซ้ำซ้อน (สแปม) หรือเปิดเผยข้อมูลส่วนบุคคลของผู้อื่นโดยไม่ได้รับอนุญาต</li>
            <li>หากพบเห็นข้อความหรือเนื้อหาที่ไม่เหมาะสม สามารถกด "รายงาน" เพื่อให้เจ้าหน้าที่ตรวจสอบและดำเนินการได้ทันที</li>
            <li>ผู้โพสต์สามารถแก้ไขหรือลบโพสต์ของตนเองได้ตลอดเวลา โดยมีผู้ดูแลระบบร่วมดูแลความสงบเรียบร้อยของชุมชน</li>
          </ul>
          <Link href="/guide#community" className="btn btn-block btn-ghost">อ่านข้อกำหนดและวิธีใช้งานทั้งหมด</Link>
        </div>
      </section>
    </>
  );
}
