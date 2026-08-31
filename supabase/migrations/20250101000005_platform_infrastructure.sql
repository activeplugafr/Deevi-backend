-- =====================================================================
-- Deevi :: 005 :: Notifications, subscriptions, boosts, webhooks,
--                 audit log, durable background-job queue
-- =====================================================================

-- ---------------------------------------------------------------------
-- notifications :: in-app is the source of truth; other channels are
-- delivery attempts recorded in notification_deliveries.
-- ---------------------------------------------------------------------
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  type text not null,
  title text not null,
  body text,
  data jsonb not null default '{}'::jsonb,
  entity_type text,
  entity_id uuid,
  priority text not null default 'NORMAL',
  read_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz not null default now()
);

do $mig$ begin
  alter table public.notifications add constraint notifications_priority_check
    check (priority in ('LOW', 'NORMAL', 'HIGH'));
exception when duplicate_object then null; end $mig$;

create index if not exists notifications_user_idx
  on public.notifications (user_id, created_at desc) where archived_at is null;
create index if not exists notifications_unread_idx
  on public.notifications (user_id, created_at desc) where read_at is null and archived_at is null;
create index if not exists notifications_entity_idx
  on public.notifications (entity_type, entity_id) where entity_id is not null;

create table if not exists public.notification_preferences (
  user_id uuid primary key references public.users(id) on delete cascade,
  in_app_enabled boolean not null default true,
  email_enabled boolean not null default true,
  push_enabled boolean not null default true,
  sms_enabled boolean not null default false,
  muted_types jsonb not null default '[]'::jsonb,
  quiet_hours_start time,
  quiet_hours_end time,
  push_tokens jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
select public.deevi_attach_updated_at('notification_preferences');

create table if not exists public.notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid references public.notifications(id) on delete cascade,
  user_id uuid references public.users(id) on delete cascade,
  channel text not null,
  provider text not null,
  destination text,
  subject text,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'PENDING',
  error text,
  attempts integer not null default 0,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);

do $mig$ begin
  alter table public.notification_deliveries add constraint notification_deliveries_channel_check
    check (channel in ('IN_APP', 'EMAIL', 'PUSH', 'SMS'));
exception when duplicate_object then null; end $mig$;

do $mig$ begin
  alter table public.notification_deliveries add constraint notification_deliveries_status_check
    check (status in ('PENDING', 'SENT', 'FAILED', 'SKIPPED'));
exception when duplicate_object then null; end $mig$;

create index if not exists notification_deliveries_notification_idx
  on public.notification_deliveries (notification_id);
create index if not exists notification_deliveries_status_idx
  on public.notification_deliveries (status, created_at desc);

-- ---------------------------------------------------------------------
-- subscription_plans / subscriptions
-- Premium artisan subscriptions are the FIRST money Deevi handles.
-- Job payments themselves stay off-platform in MVP.
-- ---------------------------------------------------------------------
create table if not exists public.subscription_plans (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  name text not null,
  description text,
  amount numeric(12,2) not null default 0,
  currency text not null default 'NGN',
  billing_interval text not null default 'MONTHLY',
  trial_days integer not null default 0,
  features jsonb not null default '{}'::jsonb,
  monthly_application_limit integer,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  provider text,
  provider_plan_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $mig$ begin
  alter table public.subscription_plans add constraint subscription_plans_interval_check
    check (billing_interval in ('MONTHLY', 'QUARTERLY', 'YEARLY', 'LIFETIME'));
exception when duplicate_object then null; end $mig$;

create unique index if not exists subscription_plans_code_key on public.subscription_plans (code);
select public.deevi_attach_updated_at('subscription_plans');

create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  artisan_id uuid references public.artisan_profiles(id) on delete cascade,
  plan_id uuid not null references public.subscription_plans(id) on delete restrict,
  status text not null default 'INCOMPLETE',
  provider text not null default 'MOCK',
  provider_customer_id text,
  provider_subscription_id text,
  provider_checkout_reference text,
  current_period_start timestamptz,
  current_period_end timestamptz,
  trial_ends_at timestamptz,
  cancel_at_period_end boolean not null default false,
  cancelled_at timestamptz,
  ended_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $mig$ begin
  alter table public.subscriptions add constraint subscriptions_status_check
    check (status in ('INCOMPLETE', 'TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELLED', 'EXPIRED'));
exception when duplicate_object then null; end $mig$;

create unique index if not exists subscriptions_one_live_per_artisan_idx
  on public.subscriptions (artisan_id)
  where status in ('TRIALING', 'ACTIVE', 'PAST_DUE') and artisan_id is not null;
create index if not exists subscriptions_user_idx on public.subscriptions (user_id, created_at desc);
create index if not exists subscriptions_renewal_idx
  on public.subscriptions (current_period_end) where status in ('ACTIVE', 'TRIALING');
create unique index if not exists subscriptions_provider_sub_key
  on public.subscriptions (provider, provider_subscription_id)
  where provider_subscription_id is not null;
select public.deevi_attach_updated_at('subscriptions');

create table if not exists public.subscription_invoices (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references public.subscriptions(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  amount numeric(12,2) not null,
  currency text not null default 'NGN',
  status text not null default 'PENDING',
  provider text not null default 'MOCK',
  provider_invoice_id text,
  provider_reference text,
  period_start timestamptz,
  period_end timestamptz,
  paid_at timestamptz,
  created_at timestamptz not null default now()
);

do $mig$ begin
  alter table public.subscription_invoices add constraint subscription_invoices_status_check
    check (status in ('PENDING', 'PAID', 'FAILED', 'REFUNDED', 'VOID'));
exception when duplicate_object then null; end $mig$;

create index if not exists subscription_invoices_sub_idx
  on public.subscription_invoices (subscription_id, created_at desc);

-- ---------------------------------------------------------------------
-- boosts :: reserved domain structure. Boosts influence ORDERING ONLY
-- within an already-relevant result set; they never inject an artisan
-- into a feed they do not otherwise qualify for.
-- ---------------------------------------------------------------------
create table if not exists public.boosts (
  id uuid primary key default gen_random_uuid(),
  artisan_id uuid not null references public.artisan_profiles(id) on delete cascade,
  boost_type text not null,
  target_type text,
  target_id uuid,
  status text not null default 'PENDING',
  credits_spent integer not null default 0,
  amount numeric(12,2) not null default 0,
  currency text not null default 'NGN',
  weight numeric(4,2) not null default 1.0,
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $mig$ begin
  alter table public.boosts add constraint boosts_type_check
    check (boost_type in ('APPLICATION_PROMOTION', 'FEED_VISIBILITY', 'FEATURED_PROFILE'));
exception when duplicate_object then null; end $mig$;

do $mig$ begin
  alter table public.boosts add constraint boosts_status_check
    check (status in ('PENDING', 'ACTIVE', 'EXPIRED', 'CANCELLED', 'REFUNDED'));
exception when duplicate_object then null; end $mig$;

-- A boost must never outrank relevance by more than a bounded factor.
do $mig$ begin
  alter table public.boosts add constraint boosts_weight_bounds_check
    check (weight >= 1.0 and weight <= 1.5);
exception when duplicate_object then null; end $mig$;

create index if not exists boosts_artisan_idx on public.boosts (artisan_id, status);
create index if not exists boosts_active_idx
  on public.boosts (target_type, target_id, ends_at) where status = 'ACTIVE';

create table if not exists public.boost_transactions (
  id uuid primary key default gen_random_uuid(),
  artisan_id uuid not null references public.artisan_profiles(id) on delete cascade,
  boost_id uuid references public.boosts(id) on delete set null,
  transaction_type text not null,
  credits integer not null default 0,
  amount numeric(12,2) not null default 0,
  currency text not null default 'NGN',
  balance_after integer,
  provider text,
  provider_reference text,
  status text not null default 'PENDING',
  created_at timestamptz not null default now()
);

do $mig$ begin
  alter table public.boost_transactions add constraint boost_transactions_type_check
    check (transaction_type in ('PURCHASE', 'SPEND', 'REFUND', 'GRANT'));
exception when duplicate_object then null; end $mig$;

create index if not exists boost_transactions_artisan_idx
  on public.boost_transactions (artisan_id, created_at desc);
select public.deevi_attach_updated_at('boosts');

-- ---------------------------------------------------------------------
-- webhook_events :: generic, provider-agnostic, idempotent ingestion
-- ---------------------------------------------------------------------
create table if not exists public.webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  event_id text,
  event_type text,
  payload jsonb not null,
  headers jsonb not null default '{}'::jsonb,
  signature text,
  signature_valid boolean not null default false,
  status text not null default 'RECEIVED',
  attempts integer not null default 0,
  max_attempts integer not null default 5,
  next_attempt_at timestamptz,
  error text,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $mig$ begin
  alter table public.webhook_events add constraint webhook_events_status_check
    check (status in ('RECEIVED', 'PROCESSING', 'PROCESSED', 'FAILED', 'IGNORED', 'REJECTED'));
exception when duplicate_object then null; end $mig$;

-- Idempotency: the same provider event is only ever stored once.
create unique index if not exists webhook_events_provider_event_key
  on public.webhook_events (provider, event_id) where event_id is not null;
create index if not exists webhook_events_retry_idx
  on public.webhook_events (status, next_attempt_at)
  where status in ('RECEIVED', 'FAILED');
select public.deevi_attach_updated_at('webhook_events');

-- ---------------------------------------------------------------------
-- audit_logs :: every sensitive admin action
-- ---------------------------------------------------------------------
create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references public.users(id) on delete set null,
  actor_role text,
  actor_admin_role text,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  summary text,
  before_state jsonb,
  after_state jsonb,
  metadata jsonb not null default '{}'::jsonb,
  ip_address text,
  user_agent text,
  created_at timestamptz not null default now()
);

create index if not exists audit_logs_actor_idx on public.audit_logs (actor_user_id, created_at desc);
create index if not exists audit_logs_entity_idx on public.audit_logs (entity_type, entity_id, created_at desc);
create index if not exists audit_logs_action_idx on public.audit_logs (action, created_at desc);

-- ---------------------------------------------------------------------
-- background_jobs :: durable queue. Used by the DatabaseQueueAdapter when
-- Redis/an external broker is not configured, so async work is never lost.
-- ---------------------------------------------------------------------
create table if not exists public.background_jobs (
  id uuid primary key default gen_random_uuid(),
  queue text not null default 'default',
  name text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'PENDING',
  priority integer not null default 0,
  attempts integer not null default 0,
  max_attempts integer not null default 3,
  run_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  last_error text,
  completed_at timestamptz,
  dedupe_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $mig$ begin
  alter table public.background_jobs add constraint background_jobs_status_check
    check (status in ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'DEAD'));
exception when duplicate_object then null; end $mig$;

create index if not exists background_jobs_poll_idx
  on public.background_jobs (queue, status, priority desc, run_at) where status = 'PENDING';
create index if not exists background_jobs_stuck_idx
  on public.background_jobs (locked_at) where status = 'PROCESSING';
create unique index if not exists background_jobs_dedupe_idx
  on public.background_jobs (dedupe_key)
  where dedupe_key is not null and status in ('PENDING', 'PROCESSING');
select public.deevi_attach_updated_at('background_jobs');

alter table public.notifications enable row level security;
alter table public.notification_preferences enable row level security;
alter table public.notification_deliveries enable row level security;
alter table public.subscription_plans enable row level security;
alter table public.subscriptions enable row level security;
alter table public.subscription_invoices enable row level security;
alter table public.boosts enable row level security;
alter table public.boost_transactions enable row level security;
alter table public.webhook_events enable row level security;
alter table public.audit_logs enable row level security;
alter table public.background_jobs enable row level security;
