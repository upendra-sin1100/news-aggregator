-- Apply after 001_user_saved_stories.sql in the Supabase SQL Editor.
-- Rerunnable; preserves existing stories, collections, and ownership policies.
begin;

alter table public.upfeed_bookmarks add column if not exists updated_at timestamptz;
alter table public.upfeed_collections add column if not exists updated_at timestamptz;

-- Historical update times are unknown; use the creation time for existing rows.
update public.upfeed_bookmarks set updated_at = created_at where updated_at is null;
update public.upfeed_collections set updated_at = created_at where updated_at is null;
alter table public.upfeed_bookmarks alter column updated_at set default now(),
  alter column updated_at set not null;
alter table public.upfeed_collections alter column updated_at set default now(),
  alter column updated_at set not null;

create or replace function public.upfeed_set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = statement_timestamp();
  return new;
end;
$$;

revoke all on function public.upfeed_set_updated_at() from public, anon, authenticated;

drop trigger if exists upfeed_bookmarks_updated_at on public.upfeed_bookmarks;
create trigger upfeed_bookmarks_updated_at
  before insert or update on public.upfeed_bookmarks
  for each row execute function public.upfeed_set_updated_at();

drop trigger if exists upfeed_collections_updated_at on public.upfeed_collections;
create trigger upfeed_collections_updated_at
  before insert or update on public.upfeed_collections
  for each row execute function public.upfeed_set_updated_at();

notify pgrst, 'reload schema';
commit;
