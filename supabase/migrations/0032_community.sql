-- 0032_community.sql
--
-- A place to share how the night went — with the tools to look after it built in from
-- the first day, not bolted on after the first problem.
--
-- This runs on a site where customers pay real money, so the parts that usually get
-- added later are here now:
--
--   * NOTHING IS EVER REALLY DELETED. A post the author removes, or an admin hides, keeps
--     its row and its text with a status and a reason. The public mirror drops it
--     immediately, so it is gone from every screen, but the shop can still see what was
--     said if someone asks. Hiding is reversible; the audit trail is not editable.
--
--   * EVERY PIECE OF CONTENT CAN BE REPORTED, by anyone signed in, and every report lands
--     in one queue an admin works through at /admin/community.
--
--   * RATE LIMITS IN THE DATABASE, like bookings and the play queue already have, so one
--     account cannot flood the feed faster than a person can be asked to stop.
--
--   * NO USER IDS ON THE PUBLIC BOARDS. The feed shows the same public_player_id handle
--     the ladder uses (0030), never an account id.
--
-- OWNER'S NOTE (โดม): a photo posted here is visible to anyone signed in, and there is no
-- automatic check on what is in it. Somebody has to read the report queue. If nobody can
-- watch it on a given week, set community_settings.posting_open to false and the feed
-- becomes read-only until it is turned back on — no deploy needed.

-- ---------------------------------------------------------------------------
create table public.community_settings (
  id            smallint primary key default 1 check (id = 1),
  posting_open  boolean not null default true,
  updated_at    timestamptz not null default now()
);
insert into public.community_settings (id) values (1) on conflict (id) do nothing;

alter table public.community_settings enable row level security;
create policy "community settings are public" on public.community_settings
  for select to anon, authenticated using (true);

create type public.community_status as enum ('visible', 'hidden', 'removed');

create table public.community_posts (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users on delete cascade,
  party_id    uuid references public.party_rooms on delete set null,
  body        text not null check (char_length(btrim(body)) between 1 and 2000),
  image_path  text,
  status      public.community_status not null default 'visible',
  status_note text,
  likes       integer not null default 0,
  comments    integer not null default 0,
  created_at  timestamptz not null default now(),
  edited_at   timestamptz
);

create table public.community_comments (
  id          uuid primary key default gen_random_uuid(),
  post_id     uuid not null references public.community_posts on delete cascade,
  user_id     uuid not null references auth.users on delete cascade,
  body        text not null check (char_length(btrim(body)) between 1 and 500),
  status      public.community_status not null default 'visible',
  status_note text,
  created_at  timestamptz not null default now()
);

create table public.community_likes (
  post_id    uuid not null references public.community_posts on delete cascade,
  user_id    uuid not null references auth.users on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

create table public.community_reports (
  id           uuid primary key default gen_random_uuid(),
  target_type  text not null check (target_type in ('post', 'comment')),
  target_id    uuid not null,
  reporter_id  uuid not null references auth.users on delete cascade,
  reason       text not null check (char_length(btrim(reason)) between 1 and 300),
  status       text not null default 'open' check (status in ('open', 'actioned', 'dismissed')),
  created_at   timestamptz not null default now(),
  handled_by   uuid references auth.users,
  handled_at   timestamptz,
  -- One report per person per thing, so a queue cannot be padded by one account.
  unique (target_type, target_id, reporter_id)
);

create index community_posts_recent_idx on public.community_posts (status, created_at desc);
create index community_comments_post_idx on public.community_comments (post_id, status, created_at);
create index community_reports_open_idx on public.community_reports (status, created_at desc);

-- ---------------------------------------------------------------------------
-- The public side. No user id: the author is the same handle the ladder shows.
-- ---------------------------------------------------------------------------
create table public.community_feed (
  post_id     uuid primary key references public.community_posts on delete cascade,
  author_key  uuid not null,
  author_name text not null,
  avatar_url  text,
  body        text not null,
  image_path  text,
  party_title text,
  likes       integer not null default 0,
  comments    integer not null default 0,
  created_at  timestamptz not null,
  edited_at   timestamptz
);

create table public.community_comment_board (
  comment_id  uuid primary key references public.community_comments on delete cascade,
  post_id     uuid not null references public.community_posts on delete cascade,
  author_key  uuid not null,
  author_name text not null,
  avatar_url  text,
  body        text not null,
  created_at  timestamptz not null
);

create index community_feed_recent_idx on public.community_feed (created_at desc);
create index community_comment_board_post_idx on public.community_comment_board (post_id, created_at);

alter table public.community_posts enable row level security;
alter table public.community_comments enable row level security;
alter table public.community_likes enable row level security;
alter table public.community_reports enable row level security;
alter table public.community_feed enable row level security;
alter table public.community_comment_board enable row level security;

-- The feed is for people who play here, like the ladder.
create policy "the feed is for signed-in players" on public.community_feed
  for select to authenticated using (true);
create policy "comments are for signed-in players" on public.community_comment_board
  for select to authenticated using (true);
create policy "a player reads their own posts" on public.community_posts
  for select to authenticated using (user_id = auth.uid() or is_admin());
create policy "a player reads their own comments" on public.community_comments
  for select to authenticated using (user_id = auth.uid() or is_admin());
create policy "a player sees their own likes" on public.community_likes
  for select to authenticated using (user_id = auth.uid());
-- Reports are an admin queue. A reporter is not shown other people's reports.
create policy "reports are read by admins" on public.community_reports
  for select to authenticated using (is_admin() or reporter_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Mirrors follow the private tables, and only ever carry what is visible.
-- ---------------------------------------------------------------------------
create or replace function public.sync_community_post(p_post_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_post community_posts; v_profile profiles; v_party text;
begin
  select * into v_post from community_posts where id = p_post_id;
  if not found or v_post.status <> 'visible' then
    delete from community_feed where post_id = p_post_id;
    return;
  end if;
  select * into v_profile from profiles where id = v_post.user_id;
  select title into v_party from party_rooms where id = v_post.party_id;

  insert into community_feed (post_id, author_key, author_name, avatar_url, body, image_path,
                              party_title, likes, comments, created_at, edited_at)
  values (v_post.id, v_profile.public_player_id,
          coalesce(nullif(btrim(v_profile.display_name), ''), 'ผู้เล่น'), v_profile.avatar_url,
          v_post.body, v_post.image_path, v_party, v_post.likes, v_post.comments,
          v_post.created_at, v_post.edited_at)
  on conflict (post_id) do update set
    author_name = excluded.author_name, avatar_url = excluded.avatar_url,
    body = excluded.body, image_path = excluded.image_path, party_title = excluded.party_title,
    likes = excluded.likes, comments = excluded.comments, edited_at = excluded.edited_at;
end $$;

create or replace function public.sync_community_comment(p_comment_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_comment community_comments; v_profile profiles;
begin
  select * into v_comment from community_comments where id = p_comment_id;
  if not found or v_comment.status <> 'visible' then
    delete from community_comment_board where comment_id = p_comment_id;
    return;
  end if;
  select * into v_profile from profiles where id = v_comment.user_id;
  insert into community_comment_board (comment_id, post_id, author_key, author_name, avatar_url, body, created_at)
  values (v_comment.id, v_comment.post_id, v_profile.public_player_id,
          coalesce(nullif(btrim(v_profile.display_name), ''), 'ผู้เล่น'), v_profile.avatar_url,
          v_comment.body, v_comment.created_at)
  on conflict (comment_id) do update set
    author_name = excluded.author_name, avatar_url = excluded.avatar_url, body = excluded.body;
end $$;

create or replace function public.community_post_changed() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform sync_community_post(case when tg_op = 'DELETE' then old.id else new.id end);
  return coalesce(new, old);
end $$;

create or replace function public.community_comment_changed() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_post uuid := case when tg_op = 'DELETE' then old.post_id else new.post_id end;
begin
  perform sync_community_comment(case when tg_op = 'DELETE' then old.id else new.id end);
  update community_posts set comments =
    (select count(*) from community_comments c where c.post_id = v_post and c.status = 'visible')
    where id = v_post;
  perform sync_community_post(v_post);
  return coalesce(new, old);
end $$;

create or replace function public.community_like_changed() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_post uuid := case when tg_op = 'DELETE' then old.post_id else new.post_id end;
begin
  update community_posts set likes = (select count(*) from community_likes l where l.post_id = v_post)
    where id = v_post;
  perform sync_community_post(v_post);
  return coalesce(new, old);
end $$;

create trigger community_posts_sync after insert or update or delete on public.community_posts
  for each row execute function public.community_post_changed();
create trigger community_comments_sync after insert or update or delete on public.community_comments
  for each row execute function public.community_comment_changed();
create trigger community_likes_sync after insert or delete on public.community_likes
  for each row execute function public.community_like_changed();

-- A name or picture change follows into everything that person has written.
create or replace function public.community_profile_changed() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  for v_id in select id from community_posts where user_id = new.id and status = 'visible' loop
    perform sync_community_post(v_id);
  end loop;
  for v_id in select id from community_comments where user_id = new.id and status = 'visible' loop
    perform sync_community_comment(v_id);
  end loop;
  return new;
end $$;

create trigger profiles_sync_community after update of display_name, avatar_url on public.profiles
  for each row execute function public.community_profile_changed();

-- ---------------------------------------------------------------------------
-- Writing. Rate limits sit here, where they cannot be skipped by calling the API
-- directly, exactly as create_booking() and join_queue() already do it.
-- ---------------------------------------------------------------------------
create or replace function public.create_community_post(p_body text, p_party_id uuid default null, p_image_path text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare c_max_per_hour constant integer := 10; v_uid uuid := auth.uid(); v_body text := btrim(coalesce(p_body, '')); v_id uuid;
begin
  if v_uid is null then raise exception 'LOGIN_REQUIRED' using errcode = '42501'; end if;
  if not (select posting_open from community_settings where id = 1) then
    raise exception 'COMMUNITY_CLOSED' using errcode = '42501';
  end if;
  if char_length(v_body) < 1 or char_length(v_body) > 2000 then
    raise exception 'INVALID_POST' using errcode = '22023';
  end if;
  if p_image_path is not null and p_image_path !~ ('^' || v_uid::text || '/') then
    raise exception 'INVALID_POST' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_uid::text, 1));
  if (select count(*) from community_posts
      where user_id = v_uid and created_at > now() - interval '1 hour') >= c_max_per_hour then
    raise exception 'TOO_MANY_POSTS' using errcode = '22023';
  end if;

  insert into community_posts (user_id, party_id, body, image_path)
  values (v_uid, p_party_id, v_body, p_image_path) returning id into v_id;
  return v_id;
end $$;

create or replace function public.edit_community_post(p_post_id uuid, p_body text)
returns void language plpgsql security definer set search_path = public as $$
declare v_body text := btrim(coalesce(p_body, ''));
begin
  if char_length(v_body) < 1 or char_length(v_body) > 2000 then
    raise exception 'INVALID_POST' using errcode = '22023';
  end if;
  update community_posts set body = v_body, edited_at = now()
    where id = p_post_id and user_id = auth.uid() and status = 'visible';
  if not found then raise exception 'POST_NOT_FOUND' using errcode = 'P0002'; end if;
end $$;

-- The author takes it down. The row and its text stay, so a complaint about something
-- that was deleted in a hurry can still be looked into.
create or replace function public.delete_community_post(p_post_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update community_posts set status = 'removed', status_note = 'author'
    where id = p_post_id and user_id = auth.uid() and status = 'visible';
  if not found then raise exception 'POST_NOT_FOUND' using errcode = 'P0002'; end if;
end $$;

create or replace function public.add_community_comment(p_post_id uuid, p_body text)
returns uuid language plpgsql security definer set search_path = public as $$
declare c_max_per_hour constant integer := 30; v_uid uuid := auth.uid(); v_body text := btrim(coalesce(p_body, '')); v_id uuid;
begin
  if v_uid is null then raise exception 'LOGIN_REQUIRED' using errcode = '42501'; end if;
  if not (select posting_open from community_settings where id = 1) then
    raise exception 'COMMUNITY_CLOSED' using errcode = '42501';
  end if;
  if char_length(v_body) < 1 or char_length(v_body) > 500 then
    raise exception 'INVALID_POST' using errcode = '22023';
  end if;
  if not exists (select 1 from community_posts where id = p_post_id and status = 'visible') then
    raise exception 'POST_NOT_FOUND' using errcode = 'P0002';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_uid::text, 2));
  if (select count(*) from community_comments
      where user_id = v_uid and created_at > now() - interval '1 hour') >= c_max_per_hour then
    raise exception 'TOO_MANY_POSTS' using errcode = '22023';
  end if;

  insert into community_comments (post_id, user_id, body) values (p_post_id, v_uid, v_body) returning id into v_id;
  return v_id;
end $$;

create or replace function public.delete_community_comment(p_comment_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update community_comments set status = 'removed', status_note = 'author'
    where id = p_comment_id and user_id = auth.uid() and status = 'visible';
  if not found then raise exception 'POST_NOT_FOUND' using errcode = 'P0002'; end if;
end $$;

create or replace function public.toggle_community_like(p_post_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'LOGIN_REQUIRED' using errcode = '42501'; end if;
  if exists (select 1 from community_likes where post_id = p_post_id and user_id = v_uid) then
    delete from community_likes where post_id = p_post_id and user_id = v_uid;
    return false;
  end if;
  if not exists (select 1 from community_posts where id = p_post_id and status = 'visible') then
    raise exception 'POST_NOT_FOUND' using errcode = 'P0002';
  end if;
  insert into community_likes (post_id, user_id) values (p_post_id, v_uid);
  return true;
end $$;

-- ---------------------------------------------------------------------------
-- Reporting and moderation.
-- ---------------------------------------------------------------------------
create or replace function public.report_community_content(p_target_type text, p_target_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare c_max_per_hour constant integer := 20; v_uid uuid := auth.uid(); v_reason text := btrim(coalesce(p_reason, ''));
begin
  if v_uid is null then raise exception 'LOGIN_REQUIRED' using errcode = '42501'; end if;
  if p_target_type not in ('post', 'comment') or char_length(v_reason) < 1 or char_length(v_reason) > 300 then
    raise exception 'INVALID_REPORT' using errcode = '22023';
  end if;
  if (p_target_type = 'post' and not exists (select 1 from community_posts where id = p_target_id))
     or (p_target_type = 'comment' and not exists (select 1 from community_comments where id = p_target_id)) then
    raise exception 'POST_NOT_FOUND' using errcode = 'P0002';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_uid::text, 3));
  if (select count(*) from community_reports
      where reporter_id = v_uid and created_at > now() - interval '1 hour') >= c_max_per_hour then
    raise exception 'TOO_MANY_POSTS' using errcode = '22023';
  end if;

  insert into community_reports (target_type, target_id, reporter_id, reason)
  values (p_target_type, p_target_id, v_uid, v_reason)
  on conflict (target_type, target_id, reporter_id) do update set reason = excluded.reason, created_at = now();
end $$;

-- An admin hides something, or puts it back. Hiding removes it from every screen at once
-- because the mirror drops the row; the text itself is kept with who did it and why.
create or replace function public.moderate_community_content(
  p_target_type text, p_target_id uuid, p_action text, p_note text default null
) returns void language plpgsql security definer set search_path = public as $$
declare v_note text := left(btrim(coalesce(p_note, '')), 300);
begin
  if not is_admin() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if p_target_type not in ('post', 'comment') or p_action not in ('hide', 'restore', 'dismiss') then
    raise exception 'INVALID_REPORT' using errcode = '22023';
  end if;

  if p_action = 'hide' then
    if p_target_type = 'post' then
      update community_posts set status = 'hidden', status_note = v_note where id = p_target_id;
    else
      update community_comments set status = 'hidden', status_note = v_note where id = p_target_id;
    end if;
  elsif p_action = 'restore' then
    if p_target_type = 'post' then
      update community_posts set status = 'visible', status_note = v_note
        where id = p_target_id and status = 'hidden';
    else
      update community_comments set status = 'visible', status_note = v_note
        where id = p_target_id and status = 'hidden';
    end if;
  end if;

  update community_reports
  set status = case when p_action = 'dismiss' then 'dismissed' else 'actioned' end,
      handled_by = auth.uid(), handled_at = now()
  where target_type = p_target_type and target_id = p_target_id and status = 'open';
end $$;

create or replace function public.set_community_posting(p_open boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if p_open is null then raise exception 'INVALID_REPORT' using errcode = '22023'; end if;
  update community_settings set posting_open = p_open, updated_at = now() where id = 1;
end $$;

-- What the admin queue shows: every open report with the text it is about.
create or replace function public.open_community_reports()
returns table (
  report_id uuid, target_type text, target_id uuid, reason text, created_at timestamptz,
  reports integer, body text, author_name text, content_status public.community_status
) language plpgsql stable security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  return query
  select r.id, r.target_type, r.target_id, r.reason, r.created_at,
         (select count(*)::integer from community_reports o
          where o.target_type = r.target_type and o.target_id = r.target_id and o.status = 'open'),
         coalesce(p.body, c.body),
         coalesce(nullif(btrim(pr.display_name), ''), 'ผู้เล่น'),
         coalesce(p.status, c.status)
  from community_reports r
  left join community_posts p on r.target_type = 'post' and p.id = r.target_id
  left join community_comments c on r.target_type = 'comment' and c.id = r.target_id
  left join profiles pr on pr.id = coalesce(p.user_id, c.user_id)
  where r.status = 'open'
  order by r.created_at;
end $$;

/** Which posts the signed-in player has liked, so the feed can fill in the hearts. */
create or replace function public.my_community_likes()
returns table (post_id uuid) language sql stable security definer set search_path = public as $$
  select post_id from community_likes where user_id = auth.uid()
$$;

-- ---------------------------------------------------------------------------
-- Photos. One per post, in its own bucket, written only under your own folder.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('community', 'community', true, 4194304, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy "upload own community photo" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'community' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "remove own community photo" on storage.objects
  for delete to authenticated
  using (bucket_id = 'community' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));

-- ---------------------------------------------------------------------------
revoke execute on function public.sync_community_post(uuid) from public, anon, authenticated;
revoke execute on function public.sync_community_comment(uuid) from public, anon, authenticated;
revoke execute on function public.community_post_changed() from public, anon, authenticated;
revoke execute on function public.community_comment_changed() from public, anon, authenticated;
revoke execute on function public.community_like_changed() from public, anon, authenticated;
revoke execute on function public.community_profile_changed() from public, anon, authenticated;
revoke execute on function public.create_community_post(text, uuid, text) from public, anon;
grant execute on function public.create_community_post(text, uuid, text) to authenticated;
revoke execute on function public.edit_community_post(uuid, text) from public, anon;
grant execute on function public.edit_community_post(uuid, text) to authenticated;
revoke execute on function public.delete_community_post(uuid) from public, anon;
grant execute on function public.delete_community_post(uuid) to authenticated;
revoke execute on function public.add_community_comment(uuid, text) from public, anon;
grant execute on function public.add_community_comment(uuid, text) to authenticated;
revoke execute on function public.delete_community_comment(uuid) from public, anon;
grant execute on function public.delete_community_comment(uuid) to authenticated;
revoke execute on function public.toggle_community_like(uuid) from public, anon;
grant execute on function public.toggle_community_like(uuid) to authenticated;
revoke execute on function public.report_community_content(text, uuid, text) from public, anon;
grant execute on function public.report_community_content(text, uuid, text) to authenticated;
revoke execute on function public.moderate_community_content(text, uuid, text, text) from public, anon;
grant execute on function public.moderate_community_content(text, uuid, text, text) to authenticated;
revoke execute on function public.set_community_posting(boolean) from public, anon;
grant execute on function public.set_community_posting(boolean) to authenticated;
revoke execute on function public.open_community_reports() from public, anon;
grant execute on function public.open_community_reports() to authenticated;
revoke execute on function public.my_community_likes() from public, anon;
grant execute on function public.my_community_likes() to authenticated;

alter publication supabase_realtime add table public.community_feed, public.community_comment_board;

notify pgrst, 'reload schema';
