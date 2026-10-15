# Rules for AI coding agents (Codex, Claude, etc.)

Badminton court booking site for แบดมินตัน@สินธานี. Next.js 15 (App Router) + Supabase.
Customers pay real money through this site, so keep changes small and safe.

## Who works here

UI changes often come from a non-developer teammate. Explain what you changed in plain
Thai, without jargon, and say which page to open to see it.

## Safe to change

- Look and feel: `src/app/globals.css` (colors, spacing, fonts; prefer existing CSS variables)
- Customer pages: `src/app/(customer)/**`
- Presentational components in `src/components/**` (layout, text, styling)
- Copy/text anywhere in the UI

## Do NOT change without the owner (โดม) approving first

- `supabase/migrations/**` — database schema and booking/payment rules
- `src/lib/supabase/**`, `src/app/api/**`, `src/app/actions.ts`, `src/app/request-actions.ts`,
  `src/app/admin-actions.ts`, `src/middleware.ts`, `src/lib/slip/**`, `src/lib/bank/**`, `src/lib/line/**`
- `src/lib/config.ts` prices/hours (they must match the database functions)
- Any `.env*` file. Never print, copy, or commit secret values.

If a request needs one of these, stop, explain why in plain words, and leave it for the owner.

## Never

- Deploy to production, push to `main`, or run SQL against the live database.
- Create bookings or press admin buttons while testing locally: local dev uses the live database.

## Workflow

1. Work on a branch: `ui/<short-name>`.
2. Keep the site mobile-first; check it at phone width (~390px) in light and dark mode.
3. Before saying you are done, run and pass:
   - `npm test`
   - `npm run build`
4. Commit with a short English message, push the branch, and open a Pull Request with a Thai
   description of what changed and before/after screenshots.
