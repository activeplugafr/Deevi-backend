-- =====================================================================
-- Deevi :: 006 :: Domain functions and triggers
-- Anything that must be atomic under concurrency lives here.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Application counters + auto PUBLISHED -> RECEIVING_APPLICATIONS
-- ---------------------------------------------------------------------
create or replace function public.deevi_on_application_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  update public.job_posts
     set applications_count = applications_count + 1,
         status = case when status = 'PUBLISHED' then 'RECEIVING_APPLICATIONS' else status end
   where id = new.job_post_id;

  update public.artisan_profiles
     set applications_count = applications_count + 1,
         last_active_at = now()
   where id = new.artisan_id;

  return new;
end;
$fn$;

drop trigger if exists on_application_insert on public.job_applications;
create trigger on_application_insert
  after insert on public.job_applications
  for each row execute function public.deevi_on_application_insert();

-- ---------------------------------------------------------------------
-- Shortlist counter
-- ---------------------------------------------------------------------
create or replace function public.deevi_on_application_status_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if new.status = 'SHORTLISTED' and old.status <> 'SHORTLISTED' then
    update public.job_posts set shortlisted_count = shortlisted_count + 1
     where id = new.job_post_id;
  elsif old.status = 'SHORTLISTED' and new.status <> 'SHORTLISTED' then
    update public.job_posts set shortlisted_count = greatest(shortlisted_count - 1, 0)
     where id = new.job_post_id;
  end if;
  return new;
end;
$fn$;

drop trigger if exists on_application_status_change on public.job_applications;
create trigger on_application_status_change
  after update of status on public.job_applications
  for each row execute function public.deevi_on_application_status_change();

-- ---------------------------------------------------------------------
-- Ratings are derived, never client-supplied.
-- ---------------------------------------------------------------------
create or replace function public.deevi_recalculate_ratings()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_row record;
begin
  -- COALESCE over rowtypes is not dependable in PL/pgSQL; branch explicitly.
  if tg_op = 'DELETE' then
    v_row := old;
  else
    v_row := new;
  end if;

  if v_row.direction = 'CUSTOMER_TO_ARTISAN' and v_row.artisan_id is not null then
    update public.artisan_profiles ap
       set rating_average = coalesce(agg.avg_rating, 0),
           rating_count = coalesce(agg.cnt, 0)
      from (
        select round(avg(rating)::numeric, 2) as avg_rating, count(*) as cnt
          from public.reviews
         where artisan_id = v_row.artisan_id
           and direction = 'CUSTOMER_TO_ARTISAN'
           and is_visible
      ) agg
     where ap.id = v_row.artisan_id;
  else
    update public.customer_profiles cp
       set rating_average = coalesce(agg.avg_rating, 0),
           rating_count = coalesce(agg.cnt, 0)
      from (
        select round(avg(rating)::numeric, 2) as avg_rating, count(*) as cnt
          from public.reviews
         where reviewee_id = v_row.reviewee_id
           and direction = 'ARTISAN_TO_CUSTOMER'
           and is_visible
      ) agg
     where cp.user_id = v_row.reviewee_id;
  end if;

  return v_row;
end;
$fn$;

drop trigger if exists on_review_change on public.reviews;
create trigger on_review_change
  after insert or update or delete on public.reviews
  for each row execute function public.deevi_recalculate_ratings();

-- ---------------------------------------------------------------------
-- Conversation denormalisation on new message
-- ---------------------------------------------------------------------
create or replace function public.deevi_on_message_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_customer_id uuid;
begin
  select customer_id into v_customer_id
    from public.conversations where id = new.conversation_id;

  update public.conversations
     set last_message_at = new.created_at,
         last_message_preview = left(coalesce(new.body, '[attachment]'), 140),
         last_message_sender_id = new.sender_id,
         message_count = message_count + 1,
         customer_unread_count = customer_unread_count
           + case when new.sender_id = v_customer_id then 0 else 1 end,
         artisan_unread_count = artisan_unread_count
           + case when new.sender_id = v_customer_id then 1 else 0 end
   where id = new.conversation_id;

  return new;
end;
$fn$;

drop trigger if exists on_message_insert on public.messages;
create trigger on_message_insert
  after insert on public.messages
  for each row execute function public.deevi_on_message_insert();

-- ---------------------------------------------------------------------
-- deevi_select_artisan_for_job
-- The single most race-sensitive operation in the product. It takes a row
-- lock on the job post, re-validates ownership and state under that lock,
-- accepts exactly one application, rejects the rest, and materialises the
-- engagement -- all in one transaction. The partial unique index
-- job_applications_single_accepted_idx is the second line of defence.
-- ---------------------------------------------------------------------
create or replace function public.deevi_select_artisan_for_job(
  p_job_post_id uuid,
  p_application_id uuid,
  p_customer_id uuid,
  p_agreed_price numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_post record;
  v_app record;
  v_job record;
  v_artisan_user_id uuid;
begin
  -- Serialise concurrent selections on this job post.
  select * into v_post
    from public.job_posts
   where id = p_job_post_id and deleted_at is null
   for update;

  if not found then
    raise exception 'JOB_POST_NOT_FOUND' using errcode = 'P0002';
  end if;

  if v_post.customer_id <> p_customer_id then
    raise exception 'NOT_JOB_OWNER' using errcode = 'P0001';
  end if;

  if v_post.status not in ('PUBLISHED', 'RECEIVING_APPLICATIONS') then
    raise exception 'INVALID_JOB_STATUS:%', v_post.status using errcode = 'P0001';
  end if;

  if v_post.selected_application_id is not null then
    raise exception 'ARTISAN_ALREADY_SELECTED' using errcode = 'P0001';
  end if;

  select * into v_app
    from public.job_applications
   where id = p_application_id and job_post_id = p_job_post_id
   for update;

  if not found then
    raise exception 'APPLICATION_NOT_FOUND' using errcode = 'P0002';
  end if;

  if v_app.status not in ('SUBMITTED', 'SHORTLISTED') then
    raise exception 'INVALID_APPLICATION_STATUS:%', v_app.status using errcode = 'P0001';
  end if;

  update public.job_applications
     set status = 'ACCEPTED', responded_at = now()
   where id = p_application_id;

  update public.job_applications
     set status = 'REJECTED',
         responded_at = now(),
         rejection_reason = coalesce(rejection_reason, 'Customer selected another artisan')
   where job_post_id = p_job_post_id
     and id <> p_application_id
     and status in ('SUBMITTED', 'SHORTLISTED');

  update public.job_posts
     set status = 'ARTISAN_SELECTED',
         selected_application_id = p_application_id,
         selected_artisan_id = v_app.artisan_id
   where id = p_job_post_id;

  insert into public.jobs (
    job_post_id, application_id, customer_id, artisan_id,
    status, agreed_price, currency
  ) values (
    p_job_post_id, p_application_id, p_customer_id, v_app.artisan_id,
    'PENDING_ACCEPTANCE',
    coalesce(p_agreed_price, v_app.proposed_price),
    coalesce(v_app.currency, 'NGN')
  )
  returning * into v_job;

  update public.artisan_profiles
     set acceptance_count = acceptance_count + 1
   where id = v_app.artisan_id;

  insert into public.job_status_history
    (job_post_id, job_id, entity, from_status, to_status, changed_by, actor_role, reason)
  values
    (p_job_post_id, v_job.id, 'JOB_POST', v_post.status, 'ARTISAN_SELECTED',
     p_customer_id, 'CUSTOMER', 'Customer selected an artisan');

  select user_id into v_artisan_user_id
    from public.artisan_profiles where id = v_app.artisan_id;

  return jsonb_build_object(
    'job', to_jsonb(v_job),
    'application_id', p_application_id,
    'artisan_id', v_app.artisan_id,
    'artisan_user_id', v_artisan_user_id,
    'job_post_id', p_job_post_id
  );
end;
$fn$;

-- ---------------------------------------------------------------------
-- deevi_feed_jobs_for_artisan
-- Deterministic, rule-based relevance ranking. No AI, no magic.
-- Returns only privacy-safe fields: the exact street address and location
-- notes of a job are NEVER exposed through the marketplace feed. Precise
-- coordinates are used server-side for distance, then coarsened to ~1km.
-- ---------------------------------------------------------------------
create or replace function public.deevi_feed_jobs_for_artisan(
  p_artisan_id uuid,
  p_limit integer default 20,
  p_offset integer default 0,
  p_city text default null,
  p_service_ids uuid[] default null,
  p_urgency text default null,
  p_min_budget numeric default null,
  p_max_distance_km numeric default null,
  p_search text default null
)
returns table (
  id uuid,
  title text,
  description text,
  status text,
  urgency text,
  service_id uuid,
  service_name text,
  sub_service_id uuid,
  category_id uuid,
  category_name text,
  budget_min numeric,
  budget_max numeric,
  budget_type text,
  currency text,
  preferred_start_at timestamptz,
  preferred_time_notes text,
  neighbourhood text,
  city text,
  state text,
  latitude_approx double precision,
  longitude_approx double precision,
  distance_km double precision,
  applications_count integer,
  media_count bigint,
  published_at timestamptz,
  expires_at timestamptz,
  relevance_score numeric,
  total_count bigint
)
language sql
stable
security definer
set search_path = public
as $fn$
with artisan as (
  select ap.id, ap.user_id, ap.verification_status, ap.availability_status,
         ap.rating_average, ap.rating_count, ap.jobs_completed_count,
         ap.base_latitude, ap.base_longitude, ap.max_travel_km,
         ap.base_city, ap.is_premium, ap.last_active_at
    from public.artisan_profiles ap
   where ap.id = p_artisan_id and ap.deleted_at is null
),
artisan_svc as (
  select distinct service_id, sub_service_id
    from public.artisan_services
   where artisan_id = p_artisan_id
),
candidate as (
  select jp.*,
         (select count(*) from public.job_media jm where jm.job_post_id = jp.id) as media_count,
         asv.sub_service_id as matched_sub_service,
         (
           select min(
             coalesce(
               public.deevi_distance_km(jp.latitude, jp.longitude, sa.latitude, sa.longitude),
               case when lower(sa.city) = lower(jp.city) then 0 else null end
             )
           )
           from public.artisan_service_areas sa
          where sa.artisan_id = p_artisan_id
         ) as area_distance_km,
         (
           select max(sa.radius_km)
             from public.artisan_service_areas sa
            where sa.artisan_id = p_artisan_id
         ) as area_radius_km
    from public.job_posts jp
    -- DISTINCT ON via LATERAL: an artisan may hold both a service-wide row and
    -- a sub-service row for the same service. Take the single best match so a
    -- job appears once, preferring the more specific sub-service row.
    join lateral (
      select asv2.sub_service_id
        from artisan_svc asv2
       where asv2.service_id = jp.service_id
         and (asv2.sub_service_id is null
              or jp.sub_service_id is null
              or asv2.sub_service_id = jp.sub_service_id)
       order by (asv2.sub_service_id is not distinct from jp.sub_service_id) desc,
                asv2.sub_service_id nulls last
       limit 1
    ) asv on true
   cross join artisan a
   where jp.deleted_at is null
     and jp.status in ('PUBLISHED', 'RECEIVING_APPLICATIONS')
     and (jp.expires_at is null or jp.expires_at > now())
     and jp.customer_id <> a.user_id
     and a.verification_status = 'APPROVED'
     and not exists (
       select 1 from public.job_applications ja
        where ja.job_post_id = jp.id and ja.artisan_id = p_artisan_id
     )
     and (p_city is null or lower(jp.city) = lower(p_city))
     and (p_service_ids is null or jp.service_id = any(p_service_ids))
     and (p_urgency is null or jp.urgency = p_urgency)
     and (p_min_budget is null or coalesce(jp.budget_max, jp.budget_min) >= p_min_budget)
     and (p_search is null or jp.title ilike '%' || p_search || '%'
          or jp.description ilike '%' || p_search || '%')
),
scored as (
  select c.*,
         coalesce(
           c.area_distance_km,
           public.deevi_distance_km(c.latitude, c.longitude, a.base_latitude, a.base_longitude)
         ) as eff_distance_km,
         coalesce(c.area_radius_km, a.max_travel_km, 15) as eff_radius_km,
         a.availability_status, a.rating_average, a.rating_count,
         a.jobs_completed_count, a.base_city, a.last_active_at, a.is_premium
    from candidate c cross join artisan a
),
ranked as (
  select s.*,
         round((
           -- 1 + 2. service / sub-service match (service match is mandatory)
           25
           + case when s.matched_sub_service is not null
                   and s.matched_sub_service = s.sub_service_id then 8 else 0 end
           -- 3 + 4. service area vs. job location
           + case
               when s.eff_distance_km is null then
                 case when lower(coalesce(s.city, '')) = lower(coalesce(s.base_city, '')) then 14 else 4 end
               when s.eff_distance_km <= 0.5 then 25
               else greatest(0, 25 * (1 - (s.eff_distance_km / nullif(s.eff_radius_km, 0))))
             end
           -- 5. artisan availability
           + case s.availability_status
               when 'AVAILABLE' then 10 when 'BUSY' then 3 else 0 end
           -- 7. reputation (only once there is enough signal)
           + case when s.rating_count >= 3 then (s.rating_average / 5.0) * 12 else 4 end
           + least(s.jobs_completed_count, 20) * 0.15
           -- 8. recency of the job post
           + greatest(0, 10 - (extract(epoch from (now() - coalesce(s.published_at, s.created_at))) / 3600.0) / 12.0)
           -- urgency
           + case s.urgency when 'EMERGENCY' then 8 when 'HIGH' then 5
                            when 'NORMAL' then 2 else 0 end
           -- low-competition jobs surface first
           + greatest(0, 5 - s.applications_count * 0.5)
         )::numeric, 4) as base_score
    from scored s
   where (p_max_distance_km is null
          or s.eff_distance_km is null
          or s.eff_distance_km <= p_max_distance_km)
     -- hard travel limit: never show work the artisan cannot reach
     and (s.eff_distance_km is null or s.eff_distance_km <= s.eff_radius_km * 1.25)
)
select r.id, r.title, r.description, r.status, r.urgency,
       r.service_id, sv.name as service_name, r.sub_service_id,
       r.category_id, sc.name as category_name,
       r.budget_min, r.budget_max, r.budget_type, r.currency,
       r.preferred_start_at, r.preferred_time_notes,
       r.neighbourhood, r.city, r.state,
       round(r.latitude::numeric, 2)::double precision as latitude_approx,
       round(r.longitude::numeric, 2)::double precision as longitude_approx,
       round(r.eff_distance_km::numeric, 2)::double precision as distance_km,
       r.applications_count, r.media_count,
       r.published_at, r.expires_at,
       round(
         r.base_score * coalesce((
           select max(b.weight) from public.boosts b
            where b.status = 'ACTIVE'
              and b.boost_type = 'FEED_VISIBILITY'
              and b.target_type = 'JOB_POST'
              and b.target_id = r.id
              and (b.ends_at is null or b.ends_at > now())
         ), 1.0), 4) as relevance_score,
       count(*) over () as total_count
  from ranked r
  join public.services sv on sv.id = r.service_id
  left join public.service_categories sc on sc.id = r.category_id
 order by relevance_score desc, r.published_at desc nulls last, r.id
 limit least(coalesce(p_limit, 20), 100)
offset greatest(coalesce(p_offset, 0), 0);
$fn$;

-- ---------------------------------------------------------------------
-- deevi_recommend_artisans
-- Secondary flow: Deevi proposes reliable artisans for a job/service.
-- Same deterministic philosophy as the feed, scored from the job's side.
-- ---------------------------------------------------------------------
create or replace function public.deevi_recommend_artisans(
  p_service_id uuid,
  p_sub_service_id uuid default null,
  p_latitude double precision default null,
  p_longitude double precision default null,
  p_city text default null,
  p_limit integer default 10,
  p_offset integer default 0,
  p_min_rating numeric default null
)
returns table (
  artisan_id uuid,
  user_id uuid,
  first_name text,
  last_name text,
  avatar_url text,
  headline text,
  business_name text,
  bio text,
  years_of_experience integer,
  rating_average numeric,
  rating_count integer,
  jobs_completed_count integer,
  availability_status text,
  base_city text,
  distance_km double precision,
  is_premium boolean,
  match_score numeric,
  total_count bigint
)
language sql
stable
security definer
set search_path = public
as $fn$
with eligible as (
  select ap.*, u.first_name, u.last_name, u.avatar_url,
         (
           select min(
             coalesce(
               public.deevi_distance_km(p_latitude, p_longitude, sa.latitude, sa.longitude),
               case when p_city is not null and lower(sa.city) = lower(p_city) then 0 else null end
             )
           )
           from public.artisan_service_areas sa where sa.artisan_id = ap.id
         ) as area_distance_km,
         (select max(sa.radius_km) from public.artisan_service_areas sa
           where sa.artisan_id = ap.id) as area_radius_km,
         exists (
           select 1 from public.artisan_services ax
            where ax.artisan_id = ap.id
              and ax.service_id = p_service_id
              and (p_sub_service_id is null or ax.sub_service_id is null
                   or ax.sub_service_id = p_sub_service_id)
         ) as sub_match
    from public.artisan_profiles ap
    join public.users u on u.id = ap.user_id
   where ap.deleted_at is null
     and ap.verification_status = 'APPROVED'
     and u.status = 'ACTIVE'
     and u.deleted_at is null
     and exists (
       select 1 from public.artisan_services s2
        where s2.artisan_id = ap.id and s2.service_id = p_service_id
     )
     and (p_min_rating is null or ap.rating_average >= p_min_rating)
),
scored as (
  select e.*,
         coalesce(
           e.area_distance_km,
           public.deevi_distance_km(p_latitude, p_longitude, e.base_latitude, e.base_longitude)
         ) as eff_distance_km,
         coalesce(e.area_radius_km, e.max_travel_km, 15) as eff_radius_km
    from eligible e
)
select s.id as artisan_id, s.user_id, s.first_name, s.last_name, s.avatar_url,
       s.headline, s.business_name, s.bio, s.years_of_experience,
       s.rating_average, s.rating_count, s.jobs_completed_count,
       s.availability_status, s.base_city,
       round(s.eff_distance_km::numeric, 2)::double precision as distance_km,
       s.is_premium,
       round((
           30
         + case when s.sub_match then 6 else 0 end
         + case
             when s.eff_distance_km is null then
               case when p_city is not null and lower(coalesce(s.base_city, '')) = lower(p_city)
                    then 12 else 3 end
             when s.eff_distance_km <= 0.5 then 22
             else greatest(0, 22 * (1 - (s.eff_distance_km / nullif(s.eff_radius_km, 0))))
           end
         + case s.availability_status
             when 'AVAILABLE' then 10 when 'BUSY' then 3 else 0 end
         -- reliability: rating, completed volume, low cancellation
         + case when s.rating_count >= 3 then (s.rating_average / 5.0) * 18 else 6 end
         + least(s.jobs_completed_count, 30) * 0.3
         + least(s.years_of_experience, 15) * 0.4
         - least(s.cancellation_count, 10) * 1.0
         + case when s.last_active_at is not null
                 and s.last_active_at > now() - interval '7 days' then 5 else 0 end
       )::numeric, 4) as match_score,
       count(*) over () as total_count
  from scored s
 where s.eff_distance_km is null or s.eff_distance_km <= s.eff_radius_km * 1.5
 order by match_score desc, s.rating_average desc, s.jobs_completed_count desc, s.id
 limit least(coalesce(p_limit, 10), 50)
offset greatest(coalesce(p_offset, 0), 0);
$fn$;

-- ---------------------------------------------------------------------
-- Conversation read receipts (atomic counter reset)
-- ---------------------------------------------------------------------
create or replace function public.deevi_mark_conversation_read(
  p_conversation_id uuid,
  p_user_id uuid
)
returns integer
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_conv record;
  v_updated integer;
begin
  select * into v_conv from public.conversations
   where id = p_conversation_id for update;

  if not found then
    raise exception 'CONVERSATION_NOT_FOUND' using errcode = 'P0002';
  end if;

  if p_user_id not in (v_conv.customer_id, v_conv.artisan_user_id) then
    raise exception 'NOT_CONVERSATION_PARTICIPANT' using errcode = 'P0001';
  end if;

  update public.messages
     set read_at = now()
   where conversation_id = p_conversation_id
     and recipient_id = p_user_id
     and read_at is null
     and deleted_at is null;

  get diagnostics v_updated = row_count;

  if p_user_id = v_conv.customer_id then
    update public.conversations set customer_unread_count = 0 where id = p_conversation_id;
  else
    update public.conversations set artisan_unread_count = 0 where id = p_conversation_id;
  end if;

  return v_updated;
end;
$fn$;

-- ---------------------------------------------------------------------
-- Durable queue claim: FOR UPDATE SKIP LOCKED so many workers can poll.
-- ---------------------------------------------------------------------
create or replace function public.deevi_dequeue_background_jobs(
  p_queue text,
  p_limit integer default 10,
  p_worker text default 'worker'
)
returns setof public.background_jobs
language plpgsql
security definer
set search_path = public
as $fn$
begin
  return query
  with claimed as (
    select id from public.background_jobs
     where queue = p_queue
       and status = 'PENDING'
       and run_at <= now()
     order by priority desc, run_at
     limit greatest(coalesce(p_limit, 10), 1)
     for update skip locked
  )
  update public.background_jobs bj
     set status = 'PROCESSING',
         locked_at = now(),
         locked_by = p_worker,
         attempts = bj.attempts + 1
    from claimed
   where bj.id = claimed.id
  returning bj.*;
end;
$fn$;

-- ---------------------------------------------------------------------
-- Maintenance routines, driven by the scheduler/background worker.
-- ---------------------------------------------------------------------
create or replace function public.deevi_expire_stale_job_posts()
returns integer
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_count integer;
begin
  with expired as (
    update public.job_posts
       set status = 'EXPIRED'
     where deleted_at is null
       and status in ('PUBLISHED', 'RECEIVING_APPLICATIONS')
       and expires_at is not null
       and expires_at < now()
    returning id, status
  )
  insert into public.job_status_history (job_post_id, entity, from_status, to_status, reason)
  select id, 'JOB_POST', 'PUBLISHED', 'EXPIRED', 'Automatic expiry' from expired;

  get diagnostics v_count = row_count;

  update public.job_applications ja
     set status = 'EXPIRED'
    from public.job_posts jp
   where ja.job_post_id = jp.id
     and jp.status = 'EXPIRED'
     and ja.status in ('SUBMITTED', 'SHORTLISTED');

  return v_count;
end;
$fn$;

create or replace function public.deevi_expire_subscriptions_and_boosts()
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_subs integer;
  v_boosts integer;
begin
  update public.subscriptions
     set status = 'EXPIRED', ended_at = now()
   where status in ('ACTIVE', 'TRIALING', 'PAST_DUE')
     and current_period_end is not null
     and current_period_end < now()
     and cancel_at_period_end;
  get diagnostics v_subs = row_count;

  update public.artisan_profiles
     set is_premium = false
   where is_premium
     and premium_until is not null
     and premium_until < now();

  update public.boosts
     set status = 'EXPIRED'
   where status = 'ACTIVE' and ends_at is not null and ends_at < now();
  get diagnostics v_boosts = row_count;

  return jsonb_build_object('subscriptions_expired', v_subs, 'boosts_expired', v_boosts);
end;
$fn$;

-- Admin dashboard metrics in a single round trip.
create or replace function public.deevi_admin_metrics()
returns jsonb
language sql
stable
security definer
set search_path = public
as $fn$
  select jsonb_build_object(
    'users', jsonb_build_object(
      'total', (select count(*) from public.users where deleted_at is null),
      'customers', (select count(*) from public.user_roles where role = 'CUSTOMER'),
      'artisans', (select count(*) from public.user_roles where role = 'ARTISAN'),
      'admins', (select count(*) from public.user_roles where role = 'ADMIN'),
      'new_last_7_days', (select count(*) from public.users
                           where created_at > now() - interval '7 days' and deleted_at is null),
      'suspended', (select count(*) from public.users where status = 'SUSPENDED')
    ),
    'artisans', jsonb_build_object(
      'approved', (select count(*) from public.artisan_profiles where verification_status = 'APPROVED'),
      'pending_review', (select count(*) from public.artisan_applications
                          where status in ('PENDING', 'UNDER_REVIEW')),
      'rejected', (select count(*) from public.artisan_profiles where verification_status = 'REJECTED'),
      'suspended', (select count(*) from public.artisan_profiles where verification_status = 'SUSPENDED')
    ),
    'jobs', jsonb_build_object(
      'total_posts', (select count(*) from public.job_posts where deleted_at is null),
      'open', (select count(*) from public.job_posts
                where status in ('PUBLISHED', 'RECEIVING_APPLICATIONS') and deleted_at is null),
      'in_progress', (select count(*) from public.jobs where status in ('ACCEPTED', 'IN_PROGRESS')),
      'completed', (select count(*) from public.jobs where status = 'COMPLETED'),
      'cancelled', (select count(*) from public.jobs where status = 'CANCELLED'),
      'disputed', (select count(*) from public.jobs where status = 'DISPUTED'),
      'posted_last_7_days', (select count(*) from public.job_posts
                              where created_at > now() - interval '7 days' and deleted_at is null)
    ),
    'applications', jsonb_build_object(
      'total', (select count(*) from public.job_applications),
      'accepted', (select count(*) from public.job_applications where status = 'ACCEPTED'),
      'avg_per_open_job', (select coalesce(round(avg(applications_count)::numeric, 2), 0)
                             from public.job_posts
                            where status in ('PUBLISHED', 'RECEIVING_APPLICATIONS', 'ARTISAN_SELECTED'))
    ),
    'moderation', jsonb_build_object(
      'open_reports', (select count(*) from public.reports where status in ('OPEN', 'UNDER_REVIEW')),
      'open_disputes', (select count(*) from public.disputes where status in ('OPEN', 'UNDER_REVIEW'))
    ),
    'reviews', jsonb_build_object(
      'total', (select count(*) from public.reviews),
      'average_rating', (select coalesce(round(avg(rating)::numeric, 2), 0) from public.reviews where is_visible)
    ),
    'subscriptions', jsonb_build_object(
      'active', (select count(*) from public.subscriptions where status in ('ACTIVE', 'TRIALING')),
      'mrr_ngn', (select coalesce(sum(sp.amount), 0)
                    from public.subscriptions s
                    join public.subscription_plans sp on sp.id = s.plan_id
                   where s.status = 'ACTIVE' and sp.billing_interval = 'MONTHLY')
    ),
    'generated_at', now()
  );
$fn$;
