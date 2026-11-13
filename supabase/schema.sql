-- The Grand Library: cloud schema for a FREE Supabase project.
-- Run once in the Supabase dashboard: SQL Editor -> New query -> paste -> Run.
-- Safe to run again (idempotent).
--
-- One table mirrors every local table (departments, collections, documents, assignments, tags,
-- notes, highlights, bookmarks, progress, texts). New kinds of records in later versions of the
-- library need no new migration here.

create table if not exists public.gl_records (
  user_id           uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  id                text        not null,           -- "<table>:<local id>"
  tbl               text        not null,
  data              jsonb,
  deleted           boolean     not null default false,
  client_updated_at bigint      not null default 0, -- edit time on the device (ms)
  updated_at        timestamptz not null default clock_timestamp(),
  primary key (user_id, id)
);

create index if not exists gl_records_user_updated on public.gl_records (user_id, updated_at);

alter table public.gl_records enable row level security;

drop policy if exists "gl_records: own rows" on public.gl_records;
create policy "gl_records: own rows" on public.gl_records
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Newest edit wins: an older version from a device that was offline never overwrites a newer one.
create or replace function public.gl_records_guard() returns trigger
language plpgsql as $$
begin
  if tg_op = 'UPDATE' and new.client_updated_at < old.client_updated_at then
    return null;
  end if;
  new.updated_at := clock_timestamp();
  return new;
end $$;

drop trigger if exists gl_records_guard on public.gl_records;
create trigger gl_records_guard before insert or update on public.gl_records
  for each row execute function public.gl_records_guard();

-- Private bucket for the files (EPUB, PDF, ...) and covers. 50 MB per file = free-tier limit.
insert into storage.buckets (id, name, public, file_size_limit)
values ('library', 'library', false, 52428800)
on conflict (id) do update set public = false, file_size_limit = 52428800;

drop policy if exists "library: read own"   on storage.objects;
drop policy if exists "library: add own"    on storage.objects;
drop policy if exists "library: change own" on storage.objects;
drop policy if exists "library: remove own" on storage.objects;

create policy "library: read own" on storage.objects for select to authenticated
  using (bucket_id = 'library' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "library: add own" on storage.objects for insert to authenticated
  with check (bucket_id = 'library' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "library: change own" on storage.objects for update to authenticated
  using (bucket_id = 'library' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "library: remove own" on storage.objects for delete to authenticated
  using (bucket_id = 'library' and (storage.foldername(name))[1] = auth.uid()::text);

-- How full the free tier is, so the library can warn before a limit is reached.
-- Runs with owner rights so it can read the database size; it only ever counts the caller's files.
create or replace function public.gl_usage() returns json
language sql stable security definer set search_path = '' as $$
  select json_build_object(
    'files', coalesce((
      select sum((o.metadata ->> 'size')::bigint)
      from storage.objects o
      where o.bucket_id = 'library' and (storage.foldername(o.name))[1] = auth.uid()::text
    ), 0),
    'database', pg_catalog.pg_database_size(pg_catalog.current_database())
  );
$$;

revoke all on function public.gl_usage() from public, anon;
grant execute on function public.gl_usage() to authenticated;
