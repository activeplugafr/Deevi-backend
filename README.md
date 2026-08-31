# Deevi Backend

A two-sided marketplace for local services in Nigeria, built on NestJS and Supabase.

Customers post jobs describing exactly what they need. Relevant, verified artisans see
those jobs in a ranked feed, apply with a price and a timeline, and the customer reviews
the applications, messages the artisans, and chooses one. The job then runs to completion
and gets reviewed.

---

## Quick start

```bash
npm install
cp .env.example .env          # fill in the three SUPABASE_* values
npm run db:migrate            # needs DATABASE_URL; see "Database" below
npm run db:verify             # confirms the schema matches what the API expects
npm run admin:create -- ops@deevi.ng 'StrongPassw0rd' Ada Obi
npm run start:dev
```

- API: `http://localhost:3001/api/v1`
- Swagger UI: `http://localhost:3001/api/v1/docs`
- Integration status: `http://localhost:3001/health`

Only the `SUPABASE_*` values are required. Every other integration falls back to a
documented mock, so the entire marketplace loop works on a fresh clone with no
third-party accounts. `GET /health` reports exactly what is live and what is mocked.

---

## The marketplace loop

```
CUSTOMER  creates a job post (with its own service location)
          -> publishes it
ARTISAN   sees it in their ranked feed        GET  /feed/jobs
          -> applies with a price and timing  POST /applications
CUSTOMER  reviews the applications            GET  /jobs/{id}/applications
          -> shortlists, messages artisans    POST /applications/{id}/shortlist
          -> selects one                      POST /applications/{id}/select
ARTISAN   accepts the engagement              POST /engagements/{id}/accept
          -> starts work                      POST /engagements/{id}/start
          -> flags it finished                POST /engagements/{id}/artisan-complete
CUSTOMER  confirms completion                 POST /engagements/{id}/complete
          -> reviews the artisan              POST /reviews
```

A secondary path lets a customer ask Deevi to recommend artisans directly
(`GET /matching/artisans`), then invite one to apply. It is an invitation, never an
assignment: the artisan still applies and the customer still chooses.

---

## Architecture

```
src/
  config/          typed runtime configuration; every integration has a mock fallback
  common/          guards, decorators, DTOs, error vocabulary, pagination
  supabase/        SupabaseService (clients) + DatabaseService (query/error layer)
  cache/           Redis when configured, bounded in-process map otherwise
  queue/           durable background jobs on Postgres (FOR UPDATE SKIP LOCKED)
  audit/           append-only trail of privileged actions
  storage/         signed upload/download URLs, per-bucket type and size policy
  notifications/   in-app source of truth; email/push via swappable providers
  auth/            Supabase Auth, JWKS token verification, OAuth provider registry
  catalogue/       service categories, services, sub-services (data, never hardcoded)
  users/ customers/ artisans/       identity and profiles
  jobs/            job posts, engagements, and the explicit state machine
  feed/            the ranked artisan job feed
  applications/    bids, shortlisting, and the atomic artisan selection
  matching/        Deevi-recommended artisans
  messaging/       job-scoped conversations
  reviews/ reports/ subscriptions/ boosts/ webhooks/ admin/
supabase/migrations/   idempotent SQL: schema, indexes, functions, triggers, seed
scripts/               migrate, verify-schema, export-openapi, create-admin
```

### Decisions worth knowing

**A job owns its location.** The customer profile address is never assumed to be the
service address: someone living in Igando frequently books work in Obalende. Saved
locations pre-fill a job post; they never silently override it. A job needs either a
city or coordinates, from the map picker or the device GPS.

**Address privacy is enforced server-side.** The marketplace feed and the public job view
expose the neighbourhood and coordinates coarsened to roughly a kilometre. The street
address and access notes are released only to the artisan who was actually selected. This
is checked in `JobsService.getOne` and in the feed SQL, not left to the client.

**Selection cannot race.** Choosing an artisan runs entirely inside one Postgres function
(`deevi_select_artisan_for_job`) that takes a row lock on the job post, re-validates
ownership and status under that lock, accepts one application, rejects the rest and creates
the engagement in a single transaction. A partial unique index on
`job_applications (job_post_id) WHERE status = 'ACCEPTED'` is the storage-layer backstop:
even a bug in the application code cannot produce two winners.

**Lifecycles are data, not scattered conditionals.** `src/jobs/job-lifecycle.ts` encodes
every legal transition and which actor may make it. An invalid move is not expressible,
and the error tells the caller what they can do instead.

**Ranking is deterministic.** No AI. `deevi_feed_jobs_for_artisan` scores in SQL on service
match, sub-service match, distance from the artisan service areas versus their radius,
availability, reputation, completed volume, job recency, urgency and competition. Approval
and travel radius are hard filters, not soft penalties. Boosts apply a bounded multiplier,
capped at 1.5x by a CHECK constraint, at the very end, so paid visibility can reorder
relevant results but never manufacture them.

**Authorization is server-side and deny-by-default.** `SupabaseAuthGuard` is registered
globally, so a new controller cannot be left unauthenticated by omission; routes opt out
with `@Public()`. Admin routes are gated by capability (`@RequireCapability`), not by a
role name the client sent.

---

## Database

The schema lives in `supabase/migrations/`. Every file is idempotent and safe to re-run.

```bash
npm run db:migrate              # applies pending migrations, tracked in _deevi_migrations
npm run db:migrate -- --force   # re-applies everything
npm run db:verify               # introspects the live schema against what the API expects
```

`db:migrate` needs `DATABASE_URL` (Supabase Dashboard, Project Settings, Database,
Connection string, URI). The API itself never uses it: only this script does, because the
REST API keys cannot execute DDL. If you would rather not keep the Postgres password in
`.env`, paste the files into the Supabase SQL editor in filename order instead.
`npm run db:verify` confirms the result either way.

| Migration | Contents |
|---|---|
| `0001_core_extensions_and_users` | extensions, `updated_at` and distance helpers, users, roles, admin/customer/artisan profiles |
| `0002_catalogue_and_locations` | categories, services, sub-services, saved locations, artisan services/areas/availability/portfolio, applications, verification documents |
| `0003_jobs_and_applications` | job posts, media, bids, engagements, status history |
| `0004_messaging_reviews_reports` | conversations, messages, reviews, reports, disputes |
| `0005_platform_infrastructure` | notifications, subscriptions, boosts, webhook events, audit log, background jobs |
| `0006_functions_and_triggers` | ranking, matching, atomic selection, counters, maintenance, metrics |
| `0007_storage_buckets` | five buckets with type and size policy; two of them private |
| `0008_seed_catalogue` | 23 categories, 65+ services, sub-services, subscription plans |

RLS is enabled with no policies on every table. The API is the only consumer and it
authenticates with the service role, which bypasses RLS; anonymous PostgREST access is
therefore denied outright rather than relying on policy correctness.

### Designed for scale

Every list endpoint is paginated with a hard cap of 100 per page; nothing returns an
unbounded set. High-volume paths select explicit columns rather than `*`, because payload
size matters a great deal on Nigerian mobile networks. Composite indexes back the feed
(`service_id, status, published_at`), the applications list (`job_post_id, status`), the
inbox (`conversation_id, created_at`) and the notification list (`user_id, created_at`),
with partial indexes on the open-job and unread-notification predicates. Conversations
use keyset pagination rather than offsets, since chat histories grow without bound and
offsets drift as new messages arrive. Counters that would otherwise need aggregates at
read time (application counts, unread counts, rating averages) are maintained by database
triggers, so they cannot drift from their source.

---

## API conventions

- Authenticate with `Authorization: Bearer <accessToken>` from `POST /auth/login`.
- List endpoints return `{ items, meta }` where `meta` carries `page`, `limit`, `total`,
  `totalPages`, `hasNextPage`, `hasPreviousPage`.
- Errors always return the same shape. Branch on `code`, never on `message`:

```json
{
  "statusCode": 409,
  "code": "ARTISAN_ALREADY_SELECTED",
  "message": "An artisan has already been selected for this job",
  "path": "/api/v1/applications/.../select",
  "timestamp": "2026-01-01T09:00:00.000Z",
  "requestId": "..."
}
```

- All timestamps are ISO 8601 UTC. Money is decimal in the stated `currency` (NGN default).
- `npm run openapi` writes the full contract to `openapi.json` (156 documented operations).

### Uploads

Clients never hold Supabase credentials. `POST /storage/upload-ticket` validates the
target bucket, MIME type and size, then returns a short-lived signed URL. The client PUTs
the bytes directly to storage and submits the returned `path` when creating the job media,
portfolio item, verification document or message attachment. Object keys are namespaced
under the owner id, and that ownership is re-checked on every reference.

`verification-documents` and `message-attachments` are private buckets. They are readable
only through a signed URL minted after an authorization check, and every admin view of a
verification document is written to the audit log.

---

## Roles and permissions

`CUSTOMER`, `ARTISAN` and `ADMIN` are top-level roles; a single account can hold more than
one, so an artisan can also post jobs. Admin authority is further split by capability:

| Admin role | Can |
|---|---|
| `SUPER_ADMIN` | everything, including creating and revoking other admins |
| `OPERATIONS` | metrics, users, artisan verification, moderation, catalogue, audit log |
| `SUPPORT` | read-only across the product, plus report handling |
| `VERIFICATION` | the artisan queue and verification documents only |
| `FINANCE` | metrics and subscriptions only |

The matrix lives in `src/common/constants/roles.ts` and is enforced by `RolesGuard`.

Only an `APPROVED` artisan can see the feed or apply to jobs. Approval happens in
`POST /admin/artisan-applications/{id}/review`, which invalidates the artisan cached
principal immediately so the change takes effect on their next request.

---

## Background work

The queue is the `background_jobs` table plus `SELECT ... FOR UPDATE SKIP LOCKED`, which
gives durable, multi-worker-safe queuing with no broker to provision. Producers call
`QueueService.enqueue`; swapping in a real broker later means reimplementing
`enqueue`/`claim` only.

Handled today: email delivery, push delivery, webhook processing, review reminders, job
post expiry, subscription and boost expiry, and metric cache invalidation. Failures retry
with exponential backoff up to a cap, then park in a `DEAD` state for inspection at
`GET /admin/ops/queue`. Jobs abandoned by a dead worker are requeued automatically every
five minutes.

Run the worker in-process (the default) or set `QUEUE_WORKER_ENABLED=false` on the API
instances and run the same class in a separate process.

---

## Testing

```bash
npm test          # 251 unit tests
npm run test:e2e  # HTTP-level smoke tests (skipped without SUPABASE_URL)
npm run lint
```

The suite concentrates on the rules that are expensive to get wrong: authentication and
authorization, the admin capability matrix, artisan approval gating, job creation and
location resolution, address-privacy scoping per viewer, every legal and illegal lifecycle
transition, the race-sensitive selection path, messaging participant isolation, review
eligibility and duplicates, report and dispute permissions, subscription quotas, webhook
signature verification and idempotency, upload validation, and pagination bounds.

---

## Deployment

```bash
npm run build
npm run start:prod
```

Before going live: set `NODE_ENV=production` (this also refuses to load the mock OAuth
adapter), replace `CORS_ORIGINS=*` with explicit origins, set `REDIS_URL` so rate limiting
is shared across instances, and rotate the Supabase keys that were committed to this
repository during development.
