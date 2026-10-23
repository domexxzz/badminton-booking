// Limits the community feed is built around (migration 0032). They live here, not in
// community-actions.ts, because a "use server" file may only export async functions.
// The database enforces the same numbers; these keep the page from letting someone type
// past a limit it already knows about.

export const POST_MAX = 2000;
export const COMMENT_MAX = 500;
export const REPORT_MAX = 300;

/** Per hour, per account — the same ceilings create_community_post() and friends apply. */
export const POSTS_PER_HOUR = 10;
export const COMMENTS_PER_HOUR = 30;
