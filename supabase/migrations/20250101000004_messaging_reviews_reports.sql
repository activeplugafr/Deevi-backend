-- =====================================================================
-- Deevi :: 004 :: Conversations, messages, reviews, reports, disputes
-- =====================================================================

-- ---------------------------------------------------------------------
-- conversations :: always scoped to a job post + artisan pair
-- ---------------------------------------------------------------------
create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  job_post_id uuid not null references public.job_posts(id) on delete cascade,
  job_application_id uuid references public.job_applications(id) on delete set null,
  customer_id uuid not null references public.users(id) on delete cascade,
  artisan_id uuid not null references public.artisan_profiles(id) on delete cascade,
  artisan_user_id uuid not null references public.users(id) on delete cascade,

  status text not null default 'ACTIVE',
  last_message_at timestamptz,
  last_message_preview text,
  last_message_sender_id uuid references public.users(id),
  customer_unread_count integer not null default 0,
  artisan_unread_count integer not null default 0,
  message_count integer not null default 0,

  customer_archived_at timestamptz,
  artisan_archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $mig$ begin
  alter table public.conversations add constraint conversations_status_check
    check (status in ('ACTIVE', 'CLOSED', 'BLOCKED'));
exception when duplicate_object then null; end $mig$;

create unique index if not exists conversations_unique_pair_idx
  on public.conversations (job_post_id, artisan_id);
create index if not exists conversations_customer_idx
  on public.conversations (customer_id, last_message_at desc nulls last);
create index if not exists conversations_artisan_idx
  on public.conversations (artisan_user_id, last_message_at desc nulls last);
select public.deevi_attach_updated_at('conversations');

-- ---------------------------------------------------------------------
-- messages
-- ---------------------------------------------------------------------
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id uuid not null references public.users(id) on delete cascade,
  recipient_id uuid not null references public.users(id) on delete cascade,
  body text,
  message_type text not null default 'TEXT',
  attachment_path text,
  attachment_url text,
  attachment_mime text,
  attachment_size_bytes bigint,
  read_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now()
);

do $mig$ begin
  alter table public.messages add constraint messages_type_check
    check (message_type in ('TEXT', 'IMAGE', 'SYSTEM'));
exception when duplicate_object then null; end $mig$;

do $mig$ begin
  alter table public.messages add constraint messages_content_check
    check (body is not null or attachment_path is not null);
exception when duplicate_object then null; end $mig$;

-- Keyset pagination on (conversation_id, created_at desc, id desc).
create index if not exists messages_conversation_idx
  on public.messages (conversation_id, created_at desc, id desc) where deleted_at is null;
create index if not exists messages_unread_idx
  on public.messages (recipient_id, conversation_id) where read_at is null and deleted_at is null;

-- ---------------------------------------------------------------------
-- reviews :: tied to a completed job. Two-sided by design; MVP only
-- enables CUSTOMER_TO_ARTISAN at the service layer.
-- ---------------------------------------------------------------------
create table if not exists public.reviews (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  job_post_id uuid not null references public.job_posts(id) on delete cascade,
  reviewer_id uuid not null references public.users(id) on delete cascade,
  reviewee_id uuid not null references public.users(id) on delete cascade,
  artisan_id uuid references public.artisan_profiles(id) on delete cascade,
  direction text not null default 'CUSTOMER_TO_ARTISAN',
  rating smallint not null,
  comment text,
  is_visible boolean not null default true,
  hidden_reason text,
  hidden_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $mig$ begin
  alter table public.reviews add constraint reviews_rating_check
    check (rating between 1 and 5);
exception when duplicate_object then null; end $mig$;

do $mig$ begin
  alter table public.reviews add constraint reviews_direction_check
    check (direction in ('CUSTOMER_TO_ARTISAN', 'ARTISAN_TO_CUSTOMER'));
exception when duplicate_object then null; end $mig$;

-- One review per reviewer per job per direction.
create unique index if not exists reviews_unique_per_job_idx
  on public.reviews (job_id, reviewer_id, direction);
create index if not exists reviews_artisan_idx
  on public.reviews (artisan_id, created_at desc) where is_visible;
create index if not exists reviews_reviewee_idx
  on public.reviews (reviewee_id, created_at desc) where is_visible;
select public.deevi_attach_updated_at('reviews');

-- ---------------------------------------------------------------------
-- reports :: raised by either side
-- ---------------------------------------------------------------------
create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  reference text not null default ('RPT-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10))),
  reporter_id uuid not null references public.users(id) on delete cascade,
  reporter_role text,
  reported_user_id uuid references public.users(id) on delete set null,
  job_post_id uuid references public.job_posts(id) on delete set null,
  job_id uuid references public.jobs(id) on delete set null,
  message_id uuid references public.messages(id) on delete set null,

  category text not null,
  description text not null,
  evidence_urls jsonb not null default '[]'::jsonb,

  status text not null default 'OPEN',
  priority text not null default 'NORMAL',
  assigned_admin_id uuid references public.users(id) on delete set null,
  resolution text,
  resolution_notes text,
  resolved_by uuid references public.users(id) on delete set null,
  resolved_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $mig$ begin
  alter table public.reports add constraint reports_category_check
    check (category in ('NO_SHOW', 'POOR_WORKMANSHIP', 'INAPPROPRIATE_BEHAVIOUR',
                        'MISLEADING_LISTING', 'MISLEADING_PROFILE', 'PRICING_ISSUE',
                        'INCOMPLETE_SERVICE', 'SAFETY_CONCERN', 'PAYMENT_ISSUE',
                        'SPAM', 'FRAUD', 'OTHER'));
exception when duplicate_object then null; end $mig$;

do $mig$ begin
  alter table public.reports add constraint reports_status_check
    check (status in ('OPEN', 'UNDER_REVIEW', 'RESOLVED', 'DISMISSED'));
exception when duplicate_object then null; end $mig$;

do $mig$ begin
  alter table public.reports add constraint reports_priority_check
    check (priority in ('LOW', 'NORMAL', 'HIGH', 'URGENT'));
exception when duplicate_object then null; end $mig$;

create unique index if not exists reports_reference_key on public.reports (reference);
create index if not exists reports_queue_idx on public.reports (status, priority, created_at desc);
create index if not exists reports_reporter_idx on public.reports (reporter_id, created_at desc);
create index if not exists reports_reported_user_idx
  on public.reports (reported_user_id, status) where reported_user_id is not null;
create index if not exists reports_assigned_idx
  on public.reports (assigned_admin_id, status) where assigned_admin_id is not null;
select public.deevi_attach_updated_at('reports');

-- ---------------------------------------------------------------------
-- disputes :: escalation attached to a live engagement
-- ---------------------------------------------------------------------
create table if not exists public.disputes (
  id uuid primary key default gen_random_uuid(),
  reference text not null default ('DSP-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10))),
  job_id uuid not null references public.jobs(id) on delete cascade,
  job_post_id uuid references public.job_posts(id) on delete set null,
  report_id uuid references public.reports(id) on delete set null,
  raised_by uuid not null references public.users(id) on delete cascade,
  raised_by_role text,
  against_user_id uuid references public.users(id) on delete set null,
  reason text not null,
  details text,
  status text not null default 'OPEN',
  assigned_admin_id uuid references public.users(id) on delete set null,
  resolution text,
  resolution_notes text,
  resolved_by uuid references public.users(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $mig$ begin
  alter table public.disputes add constraint disputes_status_check
    check (status in ('OPEN', 'UNDER_REVIEW', 'RESOLVED', 'DISMISSED'));
exception when duplicate_object then null; end $mig$;

create unique index if not exists disputes_reference_key on public.disputes (reference);
-- Only one live dispute per job at a time.
create unique index if not exists disputes_one_open_per_job_idx
  on public.disputes (job_id) where status in ('OPEN', 'UNDER_REVIEW');
create index if not exists disputes_queue_idx on public.disputes (status, created_at desc);
select public.deevi_attach_updated_at('disputes');

alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.reviews enable row level security;
alter table public.reports enable row level security;
alter table public.disputes enable row level security;
