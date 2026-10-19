import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { cache } from "react";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "./env";

export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (list) => {
        try {
          list.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Called from a Server Component, where cookies are read-only.
          // The middleware refreshes the session, so this is safe to ignore.
        }
      },
    },
  });
}

// Layouts and pages both need the session; cache() makes it one auth check and
// one profile query per request instead of one per component.
export const getSessionUser = cache(async () => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return { supabase, user: null, isAdmin: false, isCoach: false, displayName: null } as const;

  const { data: profile } = await supabase
    .from("profiles")
    // "*" keeps working while a newly added column (e.g. is_coach) is not migrated yet.
    .select("*")
    .eq("id", data.user.id)
    .maybeSingle();

  return {
    supabase,
    user: data.user,
    isAdmin: profile?.is_admin === true,
    isCoach: profile?.is_coach === true,
    displayName: (profile?.display_name as string | null | undefined) ?? null,
  } as const;
});
