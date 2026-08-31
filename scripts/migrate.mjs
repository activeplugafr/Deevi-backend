#!/usr/bin/env node
/**
 * Deevi migration runner.
 *
 * Applies every file in supabase/migrations in filename order inside a
 * transaction, recording what has run in _deevi_migrations so re-runs are
 * cheap. Requires DATABASE_URL (Supabase -> Project Settings -> Database ->
 * Connection string -> URI). The anon/service API keys cannot execute DDL,
 * which is why this needs the Postgres connection string specifically.
 *
 *   npm run db:migrate            apply pending migrations
 *   npm run db:migrate -- --force re-apply everything (files are idempotent)
 */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, '..', 'supabase', 'migrations');
const force = process.argv.includes('--force');

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error(
    '\n  DATABASE_URL is not set.\n\n' +
      '  Supabase Dashboard -> Project Settings -> Database -> Connection string -> URI\n' +
      '  Add it to .env as DATABASE_URL, then re-run: npm run db:migrate\n\n' +
      '  Alternative: paste supabase/migrations/*.sql into the Supabase SQL editor\n' +
      '  in filename order. Every file is idempotent.\n',
  );
  process.exit(1);
}

const client = new pg.Client({
  connectionString,
  ssl: connectionString.includes('localhost') ? false : { rejectUnauthorized: false },
});

const files = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();

await client.connect();
await client.query(`
  create table if not exists public._deevi_migrations (
    filename text primary key,
    checksum text,
    applied_at timestamptz not null default now()
  )
`);

const { rows: applied } = await client.query('select filename from public._deevi_migrations');
const doneSet = new Set(applied.map((r) => r.filename));

let ran = 0;
for (const file of files) {
  if (doneSet.has(file) && !force) {
    console.log(`  skip     ${file}`);
    continue;
  }
  const sql = readFileSync(join(migrationsDir, file), 'utf8');
  process.stdout.write(`  applying ${file} ... `);
  try {
    await client.query('begin');
    await client.query(sql);
    await client.query(
      `insert into public._deevi_migrations (filename) values ($1)
       on conflict (filename) do update set applied_at = now()`,
      [file],
    );
    await client.query('commit');
    console.log('ok');
    ran += 1;
  } catch (err) {
    await client.query('rollback');
    console.log('FAILED');
    console.error(`\n${err.message}\n`);
    if (err.position) console.error(`  at character position ${err.position}`);
    await client.end();
    process.exit(1);
  }
}

await client.end();
console.log(`\n  ${ran} migration(s) applied, ${files.length - ran} already up to date.\n`);
