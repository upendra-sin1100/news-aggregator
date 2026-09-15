-- Read-only checks to run as the administrator after migrations 001 and 002.
-- Each result should be true. This checks schema and data, not signed-in RLS behavior.
select name, to_regclass('public.' || name) is not null as passed
from (values ('upfeed_bookmarks'), ('upfeed_collections')) as tables(name);

select relname as name, relrowsecurity as passed
from pg_class where oid in ('public.upfeed_bookmarks'::regclass, 'public.upfeed_collections'::regclass);

select 'no cross-account collection links' as name, not exists (
  select 1 from public.upfeed_bookmarks b
  join public.upfeed_collections c on c.id = b.collection_id
  where b.user_id <> c.user_id
) as passed;

select 'bookmark timestamps present' as name,
  not exists (select 1 from public.upfeed_bookmarks where updated_at is null) as passed
union all
select 'collection timestamps present',
  not exists (select 1 from public.upfeed_collections where updated_at is null);

select name, exists (
  select 1 from pg_trigger where tgname = name
    and tgrelid = table_name::regclass and tgenabled = 'O' and not tgisinternal
) as passed
from (values
  ('upfeed_bookmarks_updated_at', 'public.upfeed_bookmarks'),
  ('upfeed_collections_updated_at', 'public.upfeed_collections')
) as expected(name, table_name);
