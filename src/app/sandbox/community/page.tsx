import { notFound } from "next/navigation";
import { CommunityModeration, type OpenReport } from "@/components/admin/CommunityModeration";
import { PostCard, type FeedComment, type FeedPost } from "@/components/community/PostCard";
import { PostComposer } from "@/components/community/PostComposer";

// The community feed and the admin report queue at phone width, drawn from rows made up
// in this file. It reads nothing and is a 404 in a production build. Same components as
// /community and /admin/community, so what is here is what those pages draw.
//
// The buttons are live and would write to the real tables. Look, do not click.

export const dynamic = "force-static";

const key = (n: number) => `00000000-0000-4000-8000-0000000c${String(n).padStart(4, "0")}`;
const ME = key(1);

const post = (n: number, name: string, body: string, likes: number, comments: number, extra?: Partial<FeedPost>): FeedPost => ({
  post_id: key(100 + n),
  author_key: key(n),
  author_name: name,
  avatar_url: null,
  body,
  image_path: null,
  party_title: null,
  likes,
  comments,
  created_at: `2026-11-0${n}T12:30:00.000Z`,
  edited_at: null,
  ...extra,
});

const FEED: FeedPost[] = [
  post(1, "โดม", "คืนนี้เจอคู่สูสีสามเกมติด เหนื่อยแต่สนุกมาก ใครว่างศุกร์หน้ามาตีกันอีกนะ", 7, 2, {
    party_title: "ก๊วนเดี่ยว คืนวันเสาร์",
  }),
  post(2, "เบนซ์", "ขอถามหน่อยครับ เอ็นเบอร์ไหนดีสำหรับคนตีแรงแต่ข้อมือไม่ค่อยแข็ง พอดีเพิ่งขาดไปสองเส้น 😅", 3, 1),
  post(3, "ส้ม", "เพิ่งเริ่มเล่นได้สองเดือน จากที่ตีไม่ข้ามเน็ต ตอนนี้ชนะไปสองเกมแล้ว ขอบคุณทุกคนที่ใจดีสอนนะคะ", 12, 0),
];

const COMMENTS: FeedComment[] = [
  {
    comment_id: key(200),
    post_id: FEED[0].post_id,
    author_key: key(2),
    author_name: "เบนซ์",
    avatar_url: null,
    body: "เสียดายไม่ได้ไป ครั้งหน้าชวนด้วยนะ",
    created_at: "2026-11-01T13:00:00.000Z",
  },
  {
    comment_id: key(201),
    post_id: FEED[0].post_id,
    author_key: ME,
    author_name: "คุณ",
    avatar_url: null,
    body: "ได้เลย เดี๋ยวเปิดห้องแล้วส่งรหัสให้",
    created_at: "2026-11-01T13:05:00.000Z",
  },
  {
    comment_id: key(202),
    post_id: FEED[1].post_id,
    author_key: key(3),
    author_name: "ส้ม",
    avatar_url: null,
    body: "ลองเบอร์ 24 ดูค่ะ ตึงกำลังดี",
    created_at: "2026-11-02T13:00:00.000Z",
  },
];

const REPORTS: OpenReport[] = [
  {
    report_id: key(300),
    target_type: "post",
    target_id: key(102),
    reason: "โพสต์ขายของ ไม่เกี่ยวกับแบด",
    created_at: "2026-11-03T10:00:00.000Z",
    reports: 3,
    body: "รับสมัครงานออนไลน์ รายได้ดี ทักแชทมาเลย 💰💰",
    author_name: "ไม่ทราบชื่อ",
    content_status: "visible",
  },
  {
    report_id: key(301),
    target_type: "comment",
    target_id: key(203),
    reason: "ใช้คำหยาบใส่กัน",
    created_at: "2026-11-03T11:00:00.000Z",
    reports: 1,
    body: "เล่นแบบนี้ก็ไปเล่นที่อื่นเถอะ",
    author_name: "ขาจร",
    content_status: "hidden",
  },
];

export default function CommunitySandboxPage() {
  if (process.env.NODE_ENV === "production") notFound();

  return (
    <div className="app">
      <main className="app-main stack">
        <div className="party-open-note">
          <b>!</b>
          <span>
            <strong>หน้าทดลอง (sandbox)</strong>
            <small>ข้อความสมมติทั้งหมด ไม่ได้อ่านฐานข้อมูล และเปิดได้เฉพาะตอน npm run dev</small>
          </span>
        </div>

        <h2 style={{ margin: "4px 0 0" }}>ฟีดคอมมูนิตี้ (หน้า /community)</h2>
        <PostComposer open displayName="โดม" />
        {FEED.map((p) => (
          <PostCard
            key={p.post_id}
            post={p}
            comments={COMMENTS.filter((c) => c.post_id === p.post_id)}
            myKey={ME}
            liked={p.post_id === FEED[0].post_id}
            postingOpen
          />
        ))}

        <h2 style={{ margin: "18px 0 0" }}>ตอนร้านปิดรับโพสต์</h2>
        <PostComposer open={false} displayName="โดม" />

        <h2 style={{ margin: "18px 0 0" }}>คิวรายงานของแอดมิน (หน้า /admin/community)</h2>
        <CommunityModeration reports={REPORTS} postingOpen />

        <h2 style={{ margin: "18px 0 0" }}>คิวว่าง</h2>
        <CommunityModeration reports={[]} postingOpen={false} />
      </main>
    </div>
  );
}
