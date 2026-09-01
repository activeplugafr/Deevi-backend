-- =====================================================================
-- Deevi :: 009 :: Reconcile legacy CHECK constraints on artisan_profiles
--
-- artisan_profiles predates these migrations and carried its own status
-- vocabulary: VERIFIED rather than APPROVED (and no UNDER_REVIEW), and
-- OFFLINE/SUSPENDED rather than UNAVAILABLE.
--
-- Adding our constraints under different names left BOTH in force, and a row
-- must satisfy every CHECK. The effective intersection silently forbade
-- APPROVED, UNDER_REVIEW and UNAVAILABLE -- so an admin could approve an
-- application while the artisan profile stayed PENDING for ever.
--
-- Existing data is migrated onto the canonical vocabulary before the legacy
-- constraints are dropped, so nothing is lost.
-- =====================================================================

-- 1. Migrate any rows still using the legacy vocabulary.
update public.artisan_profiles
   set verification_status = 'APPROVED'
 where verification_status = 'VERIFIED';

update public.artisan_profiles
   set availability_status = 'UNAVAILABLE'
 where availability_status in ('OFFLINE', 'SUSPENDED');

-- 2. Drop the legacy constraints. Suspension is tracked on verification_status,
--    so availability no longer carries a SUSPENDED value of its own.
alter table public.artisan_profiles
  drop constraint if exists artisan_profiles_verification_status_check;

alter table public.artisan_profiles
  drop constraint if exists artisan_profiles_availability_status_check;

-- 3. Re-assert the canonical constraints, replacing rather than skipping so
--    this migration is idempotent and self-correcting.
alter table public.artisan_profiles
  drop constraint if exists artisan_profiles_verification_check;
alter table public.artisan_profiles
  add constraint artisan_profiles_verification_check
  check (verification_status in ('PENDING', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'SUSPENDED'));

alter table public.artisan_profiles
  drop constraint if exists artisan_profiles_availability_check;
alter table public.artisan_profiles
  add constraint artisan_profiles_availability_check
  check (availability_status in ('AVAILABLE', 'BUSY', 'UNAVAILABLE'));

-- 4. Guard against the same trap elsewhere: report any column carrying more
--    than one CHECK constraint, which is almost always a legacy conflict.
do $mig$
declare
  v_conflict record;
begin
  for v_conflict in
    select rel.relname as table_name, count(*) as checks,
           string_agg(con.conname, ', ') as constraint_names
      from pg_constraint con
      join pg_class rel on rel.oid = con.conrelid
      join pg_namespace ns on ns.oid = rel.relnamespace
     where ns.nspname = 'public'
       and con.contype = 'c'
       and pg_get_constraintdef(con.oid) like '%status%'
     group by rel.relname, substring(pg_get_constraintdef(con.oid) from '\(\((\w+)')
    having count(*) > 1
  loop
    raise warning 'Table % has % overlapping status CHECK constraints: %',
      v_conflict.table_name, v_conflict.checks, v_conflict.constraint_names;
  end loop;
end $mig$;
