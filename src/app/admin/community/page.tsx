import { redirect } from "next/navigation";
import { CommunityModeration, type OpenReport } from "@/components/admin/CommunityModeration";
import { getSessionUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function AdminCommunityPage() {
  const { supabase, user, isAdmin } = await getSessionUser();
  if (!user) redirect("/login?next=/admin/community");
  if (!isAdmin) return null; // the admin layout shows the no-access screen

  const [{ data: reports, error }, { data: settings }] = await Promise.all([
    supabase.rpc("open_community_reports"),
    supabase.from("community_settings").select("posting_open").eq("id", 1).maybeSingle(),
  ]);

  if (error) {
    console.error("Failed to load community reports:", error);
    return <p className="error">โหลดคิวรายงานไม่สำเร็จ</p>;
  }

  return (
    <CommunityModeration
      reports={(reports as OpenReport[] | null) ?? []}
      postingOpen={settings?.posting_open !== false}
    />
  );
}
