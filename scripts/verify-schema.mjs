#!/usr/bin/env node
/**
 * Verifies the live Supabase schema against what the API expects, using only
 * the service key (no Postgres connection required). Run this after applying
 * migrations to confirm the backend will actually work against the project.
 *
 *   npm run db:verify
 */
import dotenv from 'dotenv';
dotenv.config();

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error('SUPABASE_URL and SUPABASE_SECRET_KEY must be set in .env');
  process.exit(1);
}

const EXPECTED_TABLES = [
  'users', 'user_roles', 'admin_profiles', 'customer_profiles', 'artisan_profiles',
  'service_categories', 'services', 'sub_services',
  'locations', 'artisan_services', 'artisan_service_areas', 'artisan_availability',
  'artisan_portfolio_items', 'artisan_applications', 'verification_documents',
  'job_posts', 'job_media', 'job_applications', 'jobs', 'job_status_history',
  'conversations', 'messages', 'reviews', 'reports', 'disputes',
  'notifications', 'notification_preferences', 'notification_deliveries',
  'subscription_plans', 'subscriptions', 'subscription_invoices',
  'boosts', 'boost_transactions', 'webhook_events', 'audit_logs', 'background_jobs',
];

const EXPECTED_RPCS = [
  'deevi_select_artisan_for_job',
  'deevi_feed_jobs_for_artisan',
  'deevi_recommend_artisans',
  'deevi_mark_conversation_read',
  'deevi_dequeue_background_jobs',
  'deevi_expire_stale_job_posts',
  'deevi_expire_subscriptions_and_boosts',
  'deevi_admin_metrics',
];

const res = await fetch(`${url}/rest/v1/`, {
  headers: { apikey: key, Authorization: `Bearer ${key}` },
});
if (!res.ok) {
  console.error(`Could not reach PostgREST: ${res.status} ${res.statusText}`);
  process.exit(1);
}
const spec = await res.json();
const paths = Object.keys(spec.paths || {});
const tables = new Set(paths.filter((p) => p.startsWith('/') && !p.startsWith('/rpc/')).map((p) => p.slice(1)));
const rpcs = new Set(paths.filter((p) => p.startsWith('/rpc/')).map((p) => p.slice(5)));

const missingTables = EXPECTED_TABLES.filter((t) => !tables.has(t));
const missingRpcs = EXPECTED_RPCS.filter((r) => !rpcs.has(r));

console.log(`\n  Tables : ${EXPECTED_TABLES.length - missingTables.length}/${EXPECTED_TABLES.length} present`);
console.log(`  RPCs   : ${EXPECTED_RPCS.length - missingRpcs.length}/${EXPECTED_RPCS.length} present`);

if (missingTables.length) console.log(`\n  MISSING TABLES:\n    ${missingTables.join('\n    ')}`);
if (missingRpcs.length) console.log(`\n  MISSING FUNCTIONS:\n    ${missingRpcs.join('\n    ')}`);

if (missingTables.length || missingRpcs.length) {
  console.log('\n  -> Run `npm run db:migrate` (needs DATABASE_URL) or apply');
  console.log('     supabase/migrations/*.sql in the Supabase SQL editor.\n');
  process.exit(1);
}

// Spot-check that the seed catalogue landed.
const cats = await fetch(`${url}/rest/v1/service_categories?select=id&limit=1`, {
  headers: { apikey: key, Authorization: `Bearer ${key}` },
});
const catRows = await cats.json();
console.log(`  Seed   : service catalogue ${Array.isArray(catRows) && catRows.length ? 'populated' : 'EMPTY -- run migration 008'}`);
console.log('\n  Schema verification passed.\n');
