#!/usr/bin/env node
/**
 * Seed a QA admin Auth user. Credentials come from env only — never ship in the client.
 * Requires: VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, TEST_ADMIN_PHONE, TEST_ADMIN_PIN
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';

try {
  for (const line of readFileSync(resolve(process.cwd(), '.env.local'), 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i === -1) continue;
    const k = t.slice(0, i).trim();
    if (!(k in process.env)) process.env[k] = t.slice(i + 1).trim();
  }
} catch {
  // optional
}

const PHONE = (process.env.TEST_ADMIN_PHONE ?? '').replace(/\D/g, '').slice(-10);
const PIN = process.env.TEST_ADMIN_PIN ?? '';
const FULL_NAME = process.env.TEST_ADMIN_NAME ?? 'Test Admin';
const url = process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!/^\d{10}$/.test(PHONE) || !/^\d{4,6}$/.test(PIN) || !url || !key) {
  console.error('Need VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, TEST_ADMIN_PHONE, TEST_ADMIN_PIN');
  process.exit(1);
}

const admin = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
const email = `${PHONE}@paspl.local`;
const { data: listed, error: listError } = await admin.auth.admin.listUsers({ perPage: 1000 });
if (listError) { console.error(listError); process.exit(1); }

const existing = listed.users.find((u) => u.email === email);
let authId = existing?.id ?? null;
if (authId) {
  const { error } = await admin.auth.admin.updateUserById(authId, { password: PIN });
  if (error) { console.error(error); process.exit(1); }
} else {
  const { data, error } = await admin.auth.admin.createUser({ email, password: PIN, email_confirm: true });
  if (error || !data.user) { console.error(error ?? 'createUser failed'); process.exit(1); }
  authId = data.user.id;
}

const { data: row, error } = await admin.from('users').upsert(
  { full_name: FULL_NAME, role: 'admin', phone: PHONE, auth_id: authId, is_active: true, stock_location_code: 'main_store' },
  { onConflict: 'phone' },
).select('id, full_name, role, phone').maybeSingle();
if (error) { console.error(error); process.exit(1); }
console.log('Seeded', row);
