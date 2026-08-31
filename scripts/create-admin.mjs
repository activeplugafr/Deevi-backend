#!/usr/bin/env node
/**
 * Bootstraps the very first SUPER_ADMIN.
 *
 * Admin accounts are never self-registered through the API -- an existing
 * SUPER_ADMIN creates every other admin. That leaves a chicken-and-egg
 * problem for the first one, which this script solves out-of-band, using the
 * service key rather than an HTTP route that would have to be left open.
 *
 *   npm run admin:create -- ops@deevi.ng 'StrongPassw0rd' 'Ada' 'Obi'
 *   npm run admin:create -- existing@deevi.ng            # promote an existing user
 */
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const [email, password, firstName = 'Deevi', lastName = 'Admin'] = process.argv.slice(2);

if (!email) {
  console.error('\n  Usage: npm run admin:create -- <email> [password] [firstName] [lastName]\n');
  process.exit(1);
}

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('  SUPABASE_URL and SUPABASE_SECRET_KEY must be set in .env');
  process.exit(1);
}

const db = createClient(url, key, { auth: { persistSession: false } });

const fail = (message, error) => {
  console.error(`\n  ${message}${error ? `: ${error.message}` : ''}\n`);
  process.exit(1);
};

// 1. Find or create the Deevi user.
let { data: user } = await db
  .from('users')
  .select('id, auth_user_id, email')
  .eq('email', email.toLowerCase())
  .maybeSingle();

if (!user) {
  if (!password) fail('That email has no account yet, so a password is required to create one');

  const { data: authData, error: authError } = await db.auth.admin.createUser({
    email, password, email_confirm: true,
    user_metadata: { first_name: firstName, last_name: lastName },
  });
  if (authError) fail('Could not create the auth account', authError);

  const { data: created, error: userError } = await db
    .from('users')
    .insert({
      auth_user_id: authData.user.id,
      email: email.toLowerCase(),
      first_name: firstName,
      last_name: lastName,
      email_verified: true,
      status: 'ACTIVE',
    })
    .select('id, auth_user_id, email')
    .single();
  if (userError) {
    await db.auth.admin.deleteUser(authData.user.id);
    fail('Could not create the Deevi user', userError);
  }

  user = created;
  console.log(`  Created user ${user.email}`);
} else {
  console.log(`  Found existing user ${user.email}`);
}

// 2. Grant the ADMIN role and the SUPER_ADMIN profile.
const { error: roleError } = await db
  .from('user_roles')
  .upsert({ user_id: user.id, role: 'ADMIN' }, { onConflict: 'user_id,role', ignoreDuplicates: true });
if (roleError) fail('Could not grant the ADMIN role', roleError);

const { error: profileError } = await db
  .from('admin_profiles')
  .upsert(
    { user_id: user.id, admin_role: 'SUPER_ADMIN', is_active: true },
    { onConflict: 'user_id' },
  );
if (profileError) fail('Could not create the admin profile', profileError);

await db.from('notification_preferences')
  .upsert({ user_id: user.id }, { onConflict: 'user_id', ignoreDuplicates: true });

console.log(`\n  ${email} is now a SUPER_ADMIN.`);
console.log('  Log in via POST /api/v1/auth/login to get a token.\n');
