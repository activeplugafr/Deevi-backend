-- =====================================================================
-- Deevi :: 002 :: Dynamic service catalogue + location model
-- The catalogue is data, never hardcoded in business logic.
-- =====================================================================

-- ---------------------------------------------------------------------
-- service_categories
-- ---------------------------------------------------------------------
create table if not exists public.service_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null,
  description text,
  icon_url text,
  colour_hex text,
  group_key text not null default 'GENERAL',
  sort_order integer not null default 0,
  is_active boolean not null default true,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $mig$ begin
  alter table public.service_categories add constraint service_categories_group_check
    check (group_key in ('HOME_REPAIR', 'PERSONAL', 'MOBILITY', 'GENERAL'));
exception when duplicate_object then null; end $mig$;

create unique index if not exists service_categories_slug_key
  on public.service_categories (slug) where deleted_at is null;
create index if not exists service_categories_active_idx
  on public.service_categories (is_active, sort_order) where deleted_at is null;
select public.deevi_attach_updated_at('service_categories');

-- ---------------------------------------------------------------------
-- services
-- ---------------------------------------------------------------------
create table if not exists public.services (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.service_categories(id) on delete restrict,
  name text not null,
  slug text not null,
  description text,
  icon_url text,
  typical_price_min numeric(12,2),
  typical_price_max numeric(12,2),
  requires_verification boolean not null default false,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists services_slug_key
  on public.services (slug) where deleted_at is null;
create index if not exists services_category_idx
  on public.services (category_id, is_active, sort_order) where deleted_at is null;
create index if not exists services_name_trgm_idx
  on public.services using gin (name gin_trgm_ops);
select public.deevi_attach_updated_at('services');

-- ---------------------------------------------------------------------
-- sub_services (optional third level)
-- ---------------------------------------------------------------------
create table if not exists public.sub_services (
  id uuid primary key default gen_random_uuid(),
  service_id uuid not null references public.services(id) on delete cascade,
  name text not null,
  slug text not null,
  description text,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists sub_services_service_slug_key
  on public.sub_services (service_id, slug) where deleted_at is null;
create index if not exists sub_services_service_idx
  on public.sub_services (service_id, is_active, sort_order) where deleted_at is null;
select public.deevi_attach_updated_at('sub_services');

-- ---------------------------------------------------------------------
-- locations :: saved addresses owned by a user (customer or artisan).
-- A job NEVER implicitly reuses the customer's profile address; a job
-- carries its own denormalised service location (see 003).
-- ---------------------------------------------------------------------
create table if not exists public.locations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  label text not null default 'Saved location',
  address_line text,
  neighbourhood text,
  city text,
  state text,
  country text not null default 'NG',
  postal_code text,
  latitude double precision,
  longitude double precision,
  notes text,
  source text not null default 'MANUAL',
  is_default boolean not null default false,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $mig$ begin
  alter table public.locations add constraint locations_source_check
    check (source in ('MANUAL', 'MAP', 'DEVICE', 'IMPORTED'));
exception when duplicate_object then null; end $mig$;

do $mig$ begin
  alter table public.locations add constraint locations_latitude_check
    check (latitude is null or (latitude >= -90 and latitude <= 90));
exception when duplicate_object then null; end $mig$;

do $mig$ begin
  alter table public.locations add constraint locations_longitude_check
    check (longitude is null or (longitude >= -180 and longitude <= 180));
exception when duplicate_object then null; end $mig$;

create index if not exists locations_user_idx
  on public.locations (user_id, created_at desc) where deleted_at is null;
create unique index if not exists locations_one_default_per_user
  on public.locations (user_id) where is_default and deleted_at is null;
create index if not exists locations_geo_idx on public.locations (latitude, longitude);
select public.deevi_attach_updated_at('locations');

do $mig$ begin
  alter table public.customer_profiles
    add constraint customer_profiles_default_location_fk
    foreign key (default_location_id) references public.locations(id) on delete set null;
exception when duplicate_object then null; end $mig$;

-- ---------------------------------------------------------------------
-- artisan_services :: which services an artisan offers
-- ---------------------------------------------------------------------
create table if not exists public.artisan_services (
  id uuid primary key default gen_random_uuid(),
  artisan_id uuid not null references public.artisan_profiles(id) on delete cascade,
  service_id uuid not null references public.services(id) on delete cascade,
  sub_service_id uuid references public.sub_services(id) on delete cascade,
  price_min numeric(12,2),
  price_max numeric(12,2),
  price_unit text not null default 'PER_JOB',
  years_experience integer not null default 0,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $mig$ begin
  alter table public.artisan_services add constraint artisan_services_price_unit_check
    check (price_unit in ('PER_JOB', 'PER_HOUR', 'PER_DAY', 'PER_UNIT', 'NEGOTIABLE'));
exception when duplicate_object then null; end $mig$;

create unique index if not exists artisan_services_unique_idx
  on public.artisan_services (artisan_id, service_id, coalesce(sub_service_id, '00000000-0000-0000-0000-000000000000'::uuid));
create index if not exists artisan_services_service_idx on public.artisan_services (service_id, artisan_id);
create index if not exists artisan_services_sub_service_idx
  on public.artisan_services (sub_service_id) where sub_service_id is not null;
select public.deevi_attach_updated_at('artisan_services');

-- ---------------------------------------------------------------------
-- artisan_service_areas :: where the artisan is willing to work
-- ---------------------------------------------------------------------
create table if not exists public.artisan_service_areas (
  id uuid primary key default gen_random_uuid(),
  artisan_id uuid not null references public.artisan_profiles(id) on delete cascade,
  label text,
  neighbourhood text,
  city text not null,
  state text,
  country text not null default 'NG',
  latitude double precision,
  longitude double precision,
  radius_km integer not null default 10,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $mig$ begin
  alter table public.artisan_service_areas add constraint artisan_service_areas_radius_check
    check (radius_km > 0 and radius_km <= 200);
exception when duplicate_object then null; end $mig$;

create index if not exists artisan_service_areas_artisan_idx on public.artisan_service_areas (artisan_id);
create index if not exists artisan_service_areas_city_idx on public.artisan_service_areas (lower(city));
create index if not exists artisan_service_areas_geo_idx
  on public.artisan_service_areas (latitude, longitude)
  where latitude is not null and longitude is not null;
select public.deevi_attach_updated_at('artisan_service_areas');

-- ---------------------------------------------------------------------
-- artisan_availability :: weekly working windows
-- ---------------------------------------------------------------------
create table if not exists public.artisan_availability (
  id uuid primary key default gen_random_uuid(),
  artisan_id uuid not null references public.artisan_profiles(id) on delete cascade,
  day_of_week smallint not null,
  start_time time not null,
  end_time time not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $mig$ begin
  alter table public.artisan_availability add constraint artisan_availability_day_check
    check (day_of_week between 0 and 6);
exception when duplicate_object then null; end $mig$;

do $mig$ begin
  alter table public.artisan_availability add constraint artisan_availability_window_check
    check (end_time > start_time);
exception when duplicate_object then null; end $mig$;

create unique index if not exists artisan_availability_unique_idx
  on public.artisan_availability (artisan_id, day_of_week, start_time);
select public.deevi_attach_updated_at('artisan_availability');

-- ---------------------------------------------------------------------
-- artisan_portfolio_items
-- ---------------------------------------------------------------------
create table if not exists public.artisan_portfolio_items (
  id uuid primary key default gen_random_uuid(),
  artisan_id uuid not null references public.artisan_profiles(id) on delete cascade,
  title text,
  description text,
  storage_path text not null,
  public_url text,
  media_type text not null default 'IMAGE',
  sort_order integer not null default 0,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $mig$ begin
  alter table public.artisan_portfolio_items add constraint artisan_portfolio_media_check
    check (media_type in ('IMAGE', 'VIDEO'));
exception when duplicate_object then null; end $mig$;

create index if not exists artisan_portfolio_artisan_idx
  on public.artisan_portfolio_items (artisan_id, sort_order) where deleted_at is null;
select public.deevi_attach_updated_at('artisan_portfolio_items');

-- ---------------------------------------------------------------------
-- artisan_applications :: the onboarding / verification submission
-- ---------------------------------------------------------------------
create table if not exists public.artisan_applications (
  id uuid primary key default gen_random_uuid(),
  artisan_id uuid not null references public.artisan_profiles(id) on delete cascade,
  status text not null default 'PENDING',
  submitted_at timestamptz,
  reviewed_by uuid references public.users(id),
  reviewed_at timestamptz,
  review_notes text,
  rejection_reason text,
  snapshot jsonb not null default '{}'::jsonb,
  attempt integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $mig$ begin
  alter table public.artisan_applications add constraint artisan_applications_status_check
    check (status in ('DRAFT', 'PENDING', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'SUSPENDED'));
exception when duplicate_object then null; end $mig$;

-- An artisan may only have one application in flight at a time.
create unique index if not exists artisan_applications_one_open_idx
  on public.artisan_applications (artisan_id)
  where status in ('DRAFT', 'PENDING', 'UNDER_REVIEW');
create index if not exists artisan_applications_queue_idx
  on public.artisan_applications (status, submitted_at);
create index if not exists artisan_applications_artisan_idx
  on public.artisan_applications (artisan_id, created_at desc);
select public.deevi_attach_updated_at('artisan_applications');

-- ---------------------------------------------------------------------
-- verification_documents :: PRIVATE bucket only, never public URLs
-- ---------------------------------------------------------------------
create table if not exists public.verification_documents (
  id uuid primary key default gen_random_uuid(),
  artisan_id uuid not null references public.artisan_profiles(id) on delete cascade,
  application_id uuid references public.artisan_applications(id) on delete set null,
  document_type text not null,
  storage_path text not null,
  original_filename text,
  mime_type text,
  size_bytes bigint,
  status text not null default 'PENDING',
  reviewed_by uuid references public.users(id),
  reviewed_at timestamptz,
  review_notes text,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $mig$ begin
  alter table public.verification_documents add constraint verification_documents_type_check
    check (document_type in ('NIN', 'DRIVERS_LICENCE', 'VOTERS_CARD', 'INTERNATIONAL_PASSPORT',
                            'CAC_CERTIFICATE', 'UTILITY_BILL', 'TRADE_CERTIFICATE',
                            'GUARANTOR_LETTER', 'PROOF_OF_ADDRESS', 'OTHER'));
exception when duplicate_object then null; end $mig$;

do $mig$ begin
  alter table public.verification_documents add constraint verification_documents_status_check
    check (status in ('PENDING', 'APPROVED', 'REJECTED'));
exception when duplicate_object then null; end $mig$;

create index if not exists verification_documents_artisan_idx
  on public.verification_documents (artisan_id) where deleted_at is null;
create index if not exists verification_documents_application_idx
  on public.verification_documents (application_id);
select public.deevi_attach_updated_at('verification_documents');

alter table public.service_categories enable row level security;
alter table public.services enable row level security;
alter table public.sub_services enable row level security;
alter table public.locations enable row level security;
alter table public.artisan_services enable row level security;
alter table public.artisan_service_areas enable row level security;
alter table public.artisan_availability enable row level security;
alter table public.artisan_portfolio_items enable row level security;
alter table public.artisan_applications enable row level security;
alter table public.verification_documents enable row level security;
