import Link from "next/link";
import { redirect } from "next/navigation";
import { LiveRefresh } from "@/components/LiveRefresh";
import { PostCard, type FeedComment, type FeedPost } from "@/components/community/PostCard";
import { PostComposer } from "@/components/community/PostComposer";
import { getSessionUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type PlayerCard = { player_key: string };

export default async function CommunityPage() {
  const { supabase, user, displayName } = await getSessionUser();
  // The feed is readable by signed-in players only (RLS, 0032), so an anonymous visitor
  // would see an empty page. Send them to sign in instead of showing nothing.
  if (!user) redirect("/login?next=/community");

  const [{ data: posts, error }, { data: settings }, { data: likeRows }, { data: cardRows }] = await Promise.all([
    supabase
      .from("community_feed")
      .select("post_id, author_key, author_name, avatar_url, body, image_path, party_title, likes, comments, created_at, edited_at")
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
            <span>เล่าเรื่องคืนที่ผ่านมา ถามหาคู่ซ้อม หรือแชร์รูปสนุกๆ</span>
          </div>
        </header>

        <PostComposer open={postingOpen} displayName={displayName ?? ""} />

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
            />
          ))
        )}

        <div className="card community-rules">
          <h2>กติกาง่ายๆ</h2>
          <ul>
            <li>คุยกันดีๆ ที่นี่เป็นที่ของคนที่มาตีแบดด้วยกัน</li>
            <li>ไม่ขายของ ไม่สแปม ไม่โพสต์เรื่องส่วนตัวของคนอื่น</li>
            <li>เจออะไรไม่เหมาะสม กดรายงานได้เลย ทางร้านจะเข้ามาดู</li>
            <li>โพสต์ของตัวเองลบเองได้ตลอดเวลา</li>
          </ul>
          <Link href="/guide#community" className="btn btn-block btn-ghost">อ่านวิธีใช้งานทั้งหมด</Link>
        </div>
      </section>
    </>
  );
}
