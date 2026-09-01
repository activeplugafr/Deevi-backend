-- =====================================================================
-- Deevi :: 003 :: Job posts, applications/bids, engagements, history
-- =====================================================================

-- ---------------------------------------------------------------------
-- job_posts
-- The service location is owned by the job, not by the customer profile.
-- address_line / location_notes are PRIVATE and must never be exposed in
-- the public marketplace feed (see feed_jobs_for_artisan in 006).
-- ---------------------------------------------------------------------
create table if not exists public.job_posts (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.users(id) on delete cascade,
  category_id uuid references public.service_categories(id) on delete restrict,
  service_id uuid not null references public.services(id) on delete restrict,
  sub_service_id uuid references public.sub_services(id) on delete set null,

  title text not null,
  description text not null,
  status text not null default 'DRAFT',
  urgency text not null default 'NORMAL',

  budget_min numeric(12,2),
  budget_max numeric(12,2),
  budget_type text not null default 'NEGOTIABLE',
  currency text not null default 'NGN',

  preferred_start_at timestamptz,
  preferred_end_at timestamptz,
  preferred_time_notes text,
  is_flexible_timing boolean not null default true,

  saved_location_id uuid references public.locations(id) on delete set null,
  address_line text,
  neighbourhood text,
  city text,
  state text,
  country text not null default 'NG',
  latitude double precision,
  longitude double precision,
  location_notes text,
  location_source text not null default 'MANUAL',

  additional_notes text,

  selected_application_id uuid,
  selected_artisan_id uuid references public.artisan_profiles(id) on delete set null,

  applications_count integer not null default 0,
  shortlisted_count integer not null default 0,
  views_count integer not null default 0,

  boosted_until timestamptz,

  published_at timestamptz,
  expires_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  cancellation_reason text,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $mig$ begin
  alter table public.job_posts add constraint job_posts_status_check
    check (status in ('DRAFT', 'PUBLISHED', 'RECEIVING_APPLICATIONS', 'ARTISAN_SELECTED',
                      'ACCEPTED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'DISPUTED', 'EXPIRED'));
exception when duplicate_object then null; end $mig$;

do $mig$ begin
  alter table public.job_posts add constraint job_posts_urgency_check
    check (urgency in ('LOW', 'NORMAL', 'HIGH', 'EMERGENCY'));
exception when duplicate_object then null; end $mig$;

do $mig$ begin
  alter table public.job_posts add constraint job_posts_budget_type_check
    check (budget_type in ('FIXED', 'HOURLY', 'DAILY', 'NEGOTIABLE'));
exception when duplicate_object then null; end $mig$;

do $mig$ begin
  alter table public.job_posts add constraint job_posts_budget_range_check
    check (budget_min is null or budget_max is null or budget_max >= budget_min);
exception when duplicate_object then null; end $mig$;

do $mig$ begin
  alter table public.job_posts add constraint job_posts_location_source_check
    check (location_source in ('MANUAL', 'MAP', 'DEVICE', 'SAVED'));
exception when duplicate_object then null; end $mig$;

-- A published job must carry a resolvable service location.
do $mig$ begin
  alter table public.job_posts add constraint job_posts_published_location_check
    check (
      status = 'DRAFT'
      or city is not null
      or (latitude is not null and longitude is not null)
    );
exception when duplicate_object then null; end $mig$;

-- Feed / lookup indexes -----------------------------------------------
create index if not exists job_posts_feed_idx
  on public.job_posts (service_id, status, published_at desc)
  where deleted_at is null;
create index if not exists job_posts_feed_city_idx
  on public.job_posts (lower(city), status, published_at desc)
  where deleted_at is null;
create index if not exists job_posts_open_idx
  on public.job_posts (published_at desc)
  where deleted_at is null and status in ('PUBLISHED', 'RECEIVING_APPLICATIONS');
create index if not exists job_posts_customer_idx
  on public.job_posts (customer_id, created_at desc) where deleted_at is null;
create index if not exists job_posts_selected_artisan_idx
  on public.job_posts (selected_artisan_id, status) where selected_artisan_id is not null;
create index if not exists job_posts_geo_idx
  on public.job_posts (latitude, longitude)
  where latitude is not null and longitude is not null and deleted_at is null;
create index if not exists job_posts_category_idx
  on public.job_posts (category_id, status, published_at desc) where deleted_at is null;
create index if not exists job_posts_expiry_idx
  on public.job_posts (expires_at)
  where deleted_at is null and status in ('PUBLISHED', 'RECEIVING_APPLICATIONS');
create index if not exists job_posts_title_trgm_idx
  on public.job_posts using gin (title gin_trgm_ops);

select public.deevi_attach_updated_at('job_posts');

-- ---------------------------------------------------------------------
-- job_media
-- ---------------------------------------------------------------------
create table if not exists public.job_media (
  id uuid primary key default gen_random_uuid(),
  job_post_id uuid not null references public.job_posts(id) on delete cascade,
  media_type text not null default 'IMAGE',
  storage_path text not null,
  public_url text,
  mime_type text,
  size_bytes bigint,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

do $mig$ begin
  alter table public.job_media add constraint job_media_type_check
    check (media_type in ('IMAGE', 'VIDEO'));
exception when duplicate_object then null; end $mig$;

create index if not exists job_media_job_idx on public.job_media (job_post_id, sort_order);

-- ---------------------------------------------------------------------
-- job_applications :: an artisan's bid on a job post
-- ---------------------------------------------------------------------
create table if not exists public.job_applications (
  id uuid primary key default gen_random_uuid(),
  job_post_id uuid not null references public.job_posts(id) on delete cascade,
  artisan_id uuid not null references public.artisan_profiles(id) on delete cascade,

  message text not null,
  proposed_price numeric(12,2),
  price_type text not null default 'FIXED',
  currency text not null default 'NGN',
  estimated_duration_value integer,
  estimated_duration_unit text,
  availability_note text,
  can_start_at timestamptz,
  relevant_experience text,

  status text not null default 'SUBMITTED',
  is_boosted boolean not null default false,
  boost_id uuid,

  customer_viewed_at timestamptz,
  shortlisted_at timestamptz,
  responded_at timestamptz,
  withdrawn_at timestamptz,
  rejection_reason text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $mig$ begin
  alter table public.job_applications add constraint job_applications_status_check
    check (status in ('SUBMITTED', 'SHORTLISTED', 'ACCEPTED', 'REJECTED', 'WITHDRAWN', 'EXPIRED'));
exception when duplicate_object then null; end $mig$;

do $mig$ begin
  alter table public.job_applications add constraint job_applications_price_type_check
    check (price_type in ('FIXED', 'HOURLY', 'DAILY', 'NEGOTIABLE'));
exception when duplicate_object then null; end $mig$;

do $mig$ begin
  alter table public.job_applications add constraint job_applications_duration_unit_check
    check (estimated_duration_unit is null
           or estimated_duration_unit in ('MINUTE', 'HOUR', 'DAY', 'WEEK'));
exception when duplicate_object then null; end $mig$;

-- One bid per artisan per job.
create unique index if not exists job_applications_unique_bid_idx
  on public.job_applications (job_post_id, artisan_id);

-- HARD GUARANTEE: at most one accepted application per job post. This is the
-- database-level backstop against the double-selection race condition.
create unique index if not exists job_applications_single_accepted_idx
  on public.job_applications (job_post_id) where status = 'ACCEPTED';

create index if not exists job_applications_job_status_idx
  on public.job_applications (job_post_id, status, created_at desc);
create index if not exists job_applications_artisan_idx
  on public.job_applications (artisan_id, created_at desc);
create index if not exists job_applications_artisan_status_idx
  on public.job_applications (artisan_id, status);
select public.deevi_attach_updated_at('job_applications');

do $mig$ begin
  alter table public.job_posts add constraint job_posts_selected_application_fk
    foreign key (selected_application_id)
    references public.job_applications(id) on delete set null;
exception when duplicate_object then null; end $mig$;

-- ---------------------------------------------------------------------
-- jobs :: the engagement created once a customer selects an artisan
-- ---------------------------------------------------------------------
create table if not exists public.jobs (
  id uuid primary key default gen_random_uuid(),
  job_post_id uuid not null unique references public.job_posts(id) on delete cascade,
  application_id uuid not null references public.job_applications(id) on delete restrict,
  customer_id uuid not null references public.users(id) on delete cascade,
  artisan_id uuid not null references public.artisan_profiles(id) on delete restrict,

  status text not null default 'PENDING_ACCEPTANCE',
  agreed_price numeric(12,2),
  currency text not null default 'NGN',
  payment_mode text not null default 'OFFLINE',

  artisan_accepted_at timestamptz,
  artisan_declined_at timestamptz,
  decline_reason text,
  started_at timestamptz,
  artisan_completed_at timestamptz,
  customer_confirmed_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  cancelled_by uuid references public.users(id),
  cancellation_reason text,
  disputed_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $mig$ begin
  alter table public.jobs add constraint jobs_status_check
    check (status in ('PENDING_ACCEPTANCE', 'ACCEPTED', 'IN_PROGRESS',
                      'COMPLETED', 'CANCELLED', 'DISPUTED'));
exception when duplicate_object then null; end $mig$;

-- Deevi does not process job payments in MVP. This constraint keeps the data
-- model honest: money moves offline until a provider integration exists.
do $mig$ begin
  alter table public.jobs add constraint jobs_payment_mode_check
    check (payment_mode in ('OFFLINE'));
exception when duplicate_object then null; end $mig$;

create index if not exists jobs_customer_idx on public.jobs (customer_id, created_at desc);
create index if not exists jobs_artisan_idx on public.jobs (artisan_id, created_at desc);
create index if not exists jobs_status_idx on public.jobs (status, updated_at desc);
select public.deevi_attach_updated_at('jobs');

-- ---------------------------------------------------------------------
-- job_status_history :: full auditable lifecycle trail
-- ---------------------------------------------------------------------
create table if not exists public.job_status_history (
  id uuid primary key default gen_random_uuid(),
  job_post_id uuid references public.job_posts(id) on delete cascade,
  job_id uuid references public.jobs(id) on delete cascade,
  entity text not null default 'JOB_POST',
  from_status text,
  to_status text not null,
  changed_by uuid references public.users(id),
  actor_role text,
  reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists job_status_history_post_idx
  on public.job_status_history (job_post_id, created_at desc);
create index if not exists job_status_history_job_idx
  on public.job_status_history (job_id, created_at desc);

alter table public.job_posts enable row level security;
alter table public.job_media enable row level security;
alter table public.job_applications enable row level security;
alter table public.jobs enable row level security;
alter table public.job_status_history enable row level security;
