-- 0035_community_media_and_expiry.sql
-- 1. Support customer post 7-day expiration and permanent admin posts.
-- 2. Allow admins to edit and delete any post.
-- 3. Support video uploads in the community storage bucket.

-- Add is_admin_post and expires_at to community_posts
alter table public.community_posts
  add column if not exists is_admin_post boolean not null default false,
  add column if not exists expires_at timestamptz;

-- Add is_admin_post and expires_at to community_feed
alter table public.community_feed
  add column if not exists is_admin_post boolean not null default false,
  add column if not exists expires_at timestamptz;

-- Backfill existing posts:
-- If user is admin, make permanent. If customer, set expires_at = created_at + 7 days.
update public.community_posts p
set is_admin_post = pr.is_admin,
    expires_at = case when pr.is_admin then null else p.created_at + interval '7 days' end
from public.profiles pr
where pr.id = p.user_id;

update public.community_feed f
set is_admin_post = p.is_admin_post,
    expires_at = p.expires_at
from public.community_posts p
where p.id = f.post_id;

-- Storage: allow video MIME types and raise size limit to 50MB (52428800 bytes)
update storage.buckets
set file_size_limit = 52428800,
    allowed_mime_types = array[
      'image/jpeg', 'image/png', 'image/webp', 'image/gif',
      'video/mp4', 'video/webm', 'video/quicktime'
    ]
where id = 'community';

-- Update create_community_post to set is_admin_post and expires_at
create or replace function public.create_community_post(
  p_body text,
  p_party_id uuid default null,
  p_image_path text default null
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  c_max_per_hour constant integer := 10;
  v_uid uuid := auth.uid();
  v_body text := btrim(coalesce(p_body, ''));
  v_id uuid;
  v_is_admin boolean := false;
  v_expires_at timestamptz := null;
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

  v_is_admin := coalesce((select is_admin from profiles where id = v_uid), false);
  if not v_is_admin then
    v_expires_at := now() + interval '7 days';
  end if;

  insert into community_posts (user_id, party_id, body, image_path, is_admin_post, expires_at)
  values (v_uid, p_party_id, v_body, p_image_path, v_is_admin, v_expires_at)
  returning id into v_id;

  return v_id;
end $$;

-- Update edit_community_post: Author or Admin can edit
create or replace function public.edit_community_post(p_post_id uuid, p_body text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_body text := btrim(coalesce(p_body, ''));
begin
  if char_length(v_body) < 1 or char_length(v_body) > 2000 then
    raise exception 'INVALID_POST' using errcode = '22023';
  end if;
  update community_posts set body = v_body, edited_at = now()
    where id = p_post_id and (user_id = auth.uid() or is_admin()) and status = 'visible';
  if not found then raise exception 'POST_NOT_FOUND' using errcode = 'P0002'; end if;
end $$;

-- Update delete_community_post: Author or Admin can delete
create or replace function public.delete_community_post(p_post_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update community_posts set
    status = 'removed',
    status_note = case when is_admin() and user_id <> auth.uid() then 'admin' else 'author' end
  where id = p_post_id and (user_id = auth.uid() or is_admin()) and status = 'visible';
  if not found then raise exception 'POST_NOT_FOUND' using errcode = 'P0002'; end if;
end $$;

-- Update sync_community_post: include is_admin_post and expires_at, and remove expired posts from feed
create or replace function public.sync_community_post(p_post_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_post community_posts;
  v_profile profiles;
  v_party text;
begin
  select * into v_post from community_posts where id = p_post_id;
  if not found or v_post.status <> 'visible' or (v_post.expires_at is not null and v_post.expires_at <= now()) then
    delete from community_feed where post_id = p_post_id;
    return;
  end if;
  select * into v_profile from profiles where id = v_post.user_id;
  select title into v_party from party_rooms where id = v_post.party_id;

  insert into community_feed (
    post_id, author_key, author_name, avatar_url, body, image_path,
    party_title, likes, comments, created_at, edited_at, is_admin_post, expires_at
  )
  values (
    v_post.id, v_profile.public_player_id,
    coalesce(nullif(btrim(v_profile.display_name), ''), 'ผู้เล่น'), v_profile.avatar_url,
    v_post.body, v_post.image_path, v_party, v_post.likes, v_post.comments,
    v_post.created_at, v_post.edited_at, v_post.is_admin_post, v_post.expires_at
  )
  on conflict (post_id) do update set
    author_name = excluded.author_name, avatar_url = excluded.avatar_url,
    body = excluded.body, image_path = excluded.image_path, party_title = excluded.party_title,
    likes = excluded.likes, comments = excluded.comments, edited_at = excluded.edited_at,
    is_admin_post = excluded.is_admin_post, expires_at = excluded.expires_at;
end $$;

-- Helper to purge expired posts (can be called periodically or on feed load)
create or replace function public.purge_expired_community_posts() returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from community_feed
  where expires_at is not null and expires_at <= now();
end $$;

notify pgrst, 'reload schema';
