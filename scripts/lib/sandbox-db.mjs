// A throwaway Postgres that lives inside node, for trying the shop's database rules
// without a server, without Docker and without ever touching the live project.
//
// PGlite is real Postgres compiled to WebAssembly, so the migrations, the triggers,
// the exclusion constraints and the SECURITY DEFINER functions all behave as they do
// on Supabase. What it does NOT have is Supabase itself: no Auth, no Storage, no
// PostgREST and no Realtime. auth.uid() and the storage tables below are stand-ins.
//
// Both scripts/test-db.mjs and scripts/sandbox.mjs build their database from here, so
// the migration list exists in ONE place. PR #23 shipped a broken migration because
// that list had quietly stopped at 0016 while the folder went on to 0017.
import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { readFileSync, readdirSync } from "node:fs";

/** 0002 is pg_cron, which PGlite has no extension for. Everything else runs. */
const SKIP = new Set(["0002_expire_holds_cron.sql"]);

/** Every migration in the folder, in order. Add a file and it is picked up. */
export const MIGRATIONS = readdirSync(new URL("../../supabase/migrations", import.meta.url))
  .filter((f) => f.endsWith(".sql") && !SKIP.has(f))
  .sort();

const STUBS = `
  create role anon; create role authenticated; create role service_role;
  create schema auth; create schema storage;
  create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}', raw_app_meta_data jsonb default '{}');
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
  create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
  alter table storage.objects enable row level security;
  create function storage.foldername(name text) returns text[] language sql as $$ select string_to_array(name, '/') $$;
  create publication supabase_realtime;
`;

/** A fresh database with every migration applied. */
export async function createSandboxDb() {
  const db = new PGlite({ extensions: { btree_gist } });
  await db.exec(STUBS);
  for (const file of MIGRATIONS) {
    await db.exec(readFileSync(new URL(`../../supabase/migrations/${file}`, import.meta.url), "utf8"));
  }
  return db;
}

/** Act as this signed-in user from now on (what auth.uid() returns). */
export const actAs = (db, uid) => db.exec(`select set_config('test.uid', '${uid ?? ""}', false)`);
