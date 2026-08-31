-- =====================================================================
-- Deevi :: 001 :: Extensions, shared helpers, core identity tables
-- Idempotent. Safe to re-run.
-- =====================================================================

create extension if not exists "pgcrypto";
create extension if not exists "pg_trgm";

-- ---------------------------------------------------------------------
-- Shared helper: updated_at maintenance
-- ---------------------------------------------------------------------
create or replace function public.deevi_set_updated_at()
returns trigger
language plpgsql
as $fn$
begin
  new.updated_at = now();
  return new;
end;
$fn$;

create or replace function public.deevi_attach_updated_at(p_table text)
returns void
language plpgsql
as $fn$
begin
  execute format('drop trigger if exists set_updated_at on public.%I', p_table);
  execute format(
    'create trigger set_updated_at before update on public.%I
       for each row execute function public.deevi_set_updated_at()',
    p_table
  );
end;
$fn$;

-- Haversine distance in kilometres.
create or replace function public.deevi_distance_km(
  lat1 double precision,
  lng1 double precision,
  lat2 double precision,
  lng2 double precision
)
returns double precision
language sql
immutable
parallel safe
as $fn$
  select case
    when lat1 is null or lng1 is null or lat2 is null or lng2 is null then null
    else 6371 * 2 * asin(
      sqrt(
        power(sin(radians(lat2 - lat1) / 2), 2) +
        cos(radians(lat1)) * cos(radians(lat2)) *
        power(sin(radians(lng2 - lng1) / 2), 2)
      )
    )
  end;
$fn$;

-- ---------------------------------------------------------------------
-- users  (already exists in the project -- extended in place)
-- ---------------------------------------------------------------------
create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique,
  first_name text,
  last_name text,
  phone text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.users add column if not exists email text;
alter table public.users add column if not exists status text not null default 'ACTIVE';
alter table public.users add column if not exists email_verified boolean not null default false;
alter table public.users add column if not exists phone_verified boolean not null default false;
alter table public.users add column if not exists last_active_at timestamptz;
alter table public.users add column if not exists locale text default 'en-NG';
alter table public.users add column if not exists timezone text default 'Africa/Lagos';
alter table public.users add column if not exists suspended_at timestamptz;
alter table public.users add column if not exists suspension_reason text;
alter table public.users add column if not exists deleted_at timestamptz;

do $mig$ begin
  alter table public.users add constraint users_status_check
    check (status in ('ACTIVE', 'SUSPENDED', 'DEACTIVATED', 'DELETED'));
exception when duplicate_object then null; end $mig$;

-- The table predates this migration, so the inline UNIQUE above will not have
-- been applied to it. Add the constraint explicitly.
create unique index if not exists users_auth_user_id_key
  on public.users (auth_user_id) where auth_user_id is not null;
create unique index if not exists users_email_unique_idx
  on public.users (lower(email)) where email is not null and deleted_at is null;
create index if not exists users_phone_idx on public.users (phone) where phone is not null;
create index if not exists users_status_created_idx on public.users (status, created_at desc);
create index if not exists users_name_trgm_idx
  on public.users using gin ((coalesce(first_name, '') || ' ' || coalesce(last_name, '')) gin_trgm_ops);

select public.deevi_attach_updated_at('users');

-- ---------------------------------------------------------------------
-- user_roles
-- ---------------------------------------------------------------------
create table if not exists public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  role text not null,
  created_at timestamptz not null default now()
);

do $mig$ begin
  alter table public.user_roles add constraint user_roles_role_check
    check (role in ('CUSTOMER', 'ARTISAN', 'ADMIN'));
exception when duplicate_object then null; end $mig$;

create unique index if not exists user_roles_user_role_key on public.user_roles (user_id, role);
create index if not exists user_roles_role_idx on public.user_roles (role);

-- ---------------------------------------------------------------------
-- admin_profiles
-- ---------------------------------------------------------------------
create table if not exists public.admin_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.users(id) on delete cascade,
  admin_role text not null default 'SUPPORT',
  permissions jsonb not null default '[]'::jsonb,
  is_active boolean not null default true,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $mig$ begin
  alter table public.admin_profiles add constraint admin_profiles_role_check
    check (admin_role in ('SUPER_ADMIN', 'OPERATIONS', 'SUPPORT', 'VERIFICATION', 'FINANCE'));
exception when duplicate_object then null; end $mig$;

create index if not exists admin_profiles_role_idx on public.admin_profiles (admin_role) where is_active;
select public.deevi_attach_updated_at('admin_profiles');

-- ---------------------------------------------------------------------
-- customer_profiles  (already exists -- extended in place)
-- ---------------------------------------------------------------------
create table if not exists public.customer_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.customer_profiles add column if not exists default_location_id uuid;
alter table public.customer_profiles add column if not exists jobs_posted_count integer not null default 0;
alter table public.customer_profiles add column if not exists jobs_completed_count integer not null default 0;
alter table public.customer_profiles add column if not exists rating_average numeric(3,2) not null default 0;
alter table public.customer_profiles add column if not exists rating_count integer not null default 0;
alter table public.customer_profiles add column if not exists preferred_contact text default 'IN_APP';
alter table public.customer_profiles add column if not exists deleted_at timestamptz;

create unique index if not exists customer_profiles_user_id_key on public.customer_profiles (user_id);
select public.deevi_attach_updated_at('customer_profiles');

-- ---------------------------------------------------------------------
-- artisan_profiles  (already exists -- extended in place)
-- ---------------------------------------------------------------------
create table if not exists public.artisan_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.users(id) on delete cascade,
  bio text,
  verification_status text not null default 'PENDING',
  availability_status text not null default 'AVAILABLE',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.artisan_profiles add column if not exists headline text;
alter table public.artisan_profiles add column if not exists business_name text;
alter table public.artisan_profiles add column if not exists years_of_experience integer not null default 0;
alter table public.artisan_profiles add column if not exists base_city text;
alter table public.artisan_profiles add column if not exists base_state text;
alter table public.artisan_profiles add column if not exists base_latitude double precision;
alter table public.artisan_profiles add column if not exists base_longitude double precision;
alter table public.artisan_profiles add column if not exists max_travel_km integer not null default 15;
alter table public.artisan_profiles add column if not exists rating_average numeric(3,2) not null default 0;
alter table public.artisan_profiles add column if not exists rating_count integer not null default 0;
alter table public.artisan_profiles add column if not exists jobs_completed_count integer not null default 0;
alter table public.artisan_profiles add column if not exists applications_count integer not null default 0;
alter table public.artisan_profiles add column if not exists acceptance_count integer not null default 0;
alter table public.artisan_profiles add column if not exists cancellation_count integer not null default 0;
alter table public.artisan_profiles add column if not exists response_rate numeric(5,2) not null default 0;
alter table public.artisan_profiles add column if not exists profile_completion integer not null default 0;
alter table public.artisan_profiles add column if not exists is_premium boolean not null default false;
alter table public.artisan_profiles add column if not exists premium_until timestamptz;
alter table public.artisan_profiles add column if not exists featured_until timestamptz;
alter table public.artisan_profiles add column if not exists last_active_at timestamptz;
alter table public.artisan_profiles add column if not exists approved_at timestamptz;
alter table public.artisan_profiles add column if not exists suspended_at timestamptz;
alter table public.artisan_profiles add column if not exists deleted_at timestamptz;

do $mig$ begin
  alter table public.artisan_profiles add constraint artisan_profiles_verification_check
    check (verification_status in ('PENDING', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'SUSPENDED'));
exception when duplicate_object then null; end $mig$;

do $mig$ begin
  alter table public.artisan_profiles add constraint artisan_profiles_availability_check
    check (availability_status in ('AVAILABLE', 'BUSY', 'UNAVAILABLE'));
exception when duplicate_object then null; end $mig$;

create unique index if not exists artisan_profiles_user_id_key on public.artisan_profiles (user_id);
create index if not exists artisan_profiles_verification_idx
  on public.artisan_profiles (verification_status, availability_status);
create index if not exists artisan_profiles_active_ranked_idx
  on public.artisan_profiles (verification_status, rating_average desc, jobs_completed_count desc)
  where deleted_at is null;
create index if not exists artisan_profiles_geo_idx
  on public.artisan_profiles (base_latitude, base_longitude)
  where base_latitude is not null and base_longitude is not null;
create index if not exists artisan_profiles_city_idx on public.artisan_profiles (lower(base_city));

select public.deevi_attach_updated_at('artisan_profiles');

-- ---------------------------------------------------------------------
-- RLS. The API is the only consumer and it authenticates with the service
-- role, which bypasses RLS. Enabling RLS with no policies therefore denies
-- direct anon/authenticated PostgREST access, which is exactly what we want.
-- ---------------------------------------------------------------------
alter table public.users enable row level security;
alter table public.user_roles enable row level security;
alter table public.admin_profiles enable row level security;
alter table public.customer_profiles enable row level security;
alter table public.artisan_profiles enable row level security;
