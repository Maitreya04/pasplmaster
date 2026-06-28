#!/usr/bin/env node
/**
 * Creates (or updates) the test admin Supabase Auth user and public.users row.
 *
 * Usage:
 *   node scripts/seed-test-admin.mjs
 *
 * Requires in .env.local:
 *   VITE_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const PHONE = '9300944311';
const PIN = '0807';
const FULL_NAME = 'Test Admin';
const AUTH_DOMAIN = 'paspl.local';

function loadEnvLocal() {
  const path = resolve(process.cwd(), '.env.local');
  try {
    const raw = readFileSync(path, 'utf8');
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      const value = trimmed.slice(eq + 1).trim();
      if (!(key in process.env)) process.env[key] = value;
    }
  } catch {
    // .env.local optional if vars already exported
  }
}

loadEnvLocal();

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  console.error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');
  process.exit(1);
}

const email = `${PHONE}@${AUTH_DOMAIN}`;

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function main() {
  const { data: existingUser, error: lookupError } = await supabase
    .from('users')
    .select('id, auth_id, phone, role, is_active')
    .eq('full_name', FULL_NAME)
    .maybeSingle();

  if (lookupError) {
    console.error('users lookup failed:', lookupError.message);
    process.exit(1);
  }

  let authUserId = existingUser?.auth_id ?? null;

  const { data: authByEmail } = await supabase.auth.admin.listUsers();
  const existingAuth = authByEmail?.users?.find((u) => u.email === email);

  if (existingAuth) {
    authUserId = existingAuth.id;
    const { error: updateAuthError } = await supabase.auth.admin.updateUserById(authUserId, {
      password: PIN,
      email_confirm: true,
      user_metadata: {
        full_name: FULL_NAME,
        phone: PHONE,
        role: 'admin',
      },
    });
    if (updateAuthError) {
      console.error('auth update failed:', updateAuthError.message);
      process.exit(1);
    }
    console.log('Updated existing auth user:', email);
  } else {
    const { data: created, error: createError } = await supabase.auth.admin.createUser({
      email,
      password: PIN,
      email_confirm: true,
      user_metadata: {
        full_name: FULL_NAME,
        phone: PHONE,
        role: 'admin',
      },
    });
    if (createError || !created.user) {
      console.error('auth create failed:', createError?.message ?? 'unknown');
      process.exit(1);
    }
    authUserId = created.user.id;
    console.log('Created auth user:', email);
  }

  if (existingUser) {
    const { error: updateError } = await supabase
      .from('users')
      .update({
        auth_id: authUserId,
        phone: PHONE,
        role: 'admin',
        is_active: true,
        activated_at: new Date().toISOString(),
        invite_code: null,
        invite_code_expires_at: null,
      })
      .eq('id', existingUser.id);

    if (updateError) {
      console.error('users update failed:', updateError.message);
      process.exit(1);
    }
    console.log('Updated public.users row id=', existingUser.id);
  } else {
    const { data: inserted, error: insertError } = await supabase
      .from('users')
      .insert({
        full_name: FULL_NAME,
        role: 'admin',
        is_active: true,
        auth_id: authUserId,
        phone: PHONE,
        activated_at: new Date().toISOString(),
      })
      .select('id')
      .single();

    if (insertError || !inserted) {
      console.error('users insert failed:', insertError?.message ?? 'unknown');
      process.exit(1);
    }
    console.log('Created public.users row id=', inserted.id);
  }

  console.log('\nTest admin ready.');
  console.log('  Phone:', PHONE);
  console.log('  PIN:  ', PIN);
  console.log('  Sign in at /login — you will land on role select to switch modes.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
