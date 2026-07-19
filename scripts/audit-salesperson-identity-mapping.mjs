import { readFile } from 'node:fs/promises';

const envText = await readFile(new URL('../.env.local', import.meta.url), 'utf8');
const env = Object.fromEntries(
  envText
    .split(/\r?\n/)
    .filter((line) => line && !line.startsWith('#') && line.includes('='))
    .map((line) => {
      const separator = line.indexOf('=');
      return [line.slice(0, separator), line.slice(separator + 1).replace(/^['"]|['"]$/g, '')];
    }),
);

const baseUrl = env.VITE_SUPABASE_URL;
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
if (!baseUrl || !serviceKey) throw new Error('Missing Supabase environment configuration');

const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };

async function get(path, params = {}, range = null) {
  const url = new URL(`/rest/v1/${path}`, baseUrl);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const requestHeaders = { ...headers };
  if (range) requestHeaders.Range = `${range.from}-${range.to}`;
  const response = await fetch(url, { headers: requestHeaders });
  if (!response.ok) throw new Error(`${path}: ${response.status} ${await response.text()}`);
  return response.json();
}

async function getAll(path, params = {}) {
  const pageSize = 1000;
  const rows = [];
  for (let from = 0; ; from += pageSize) {
    const page = await get(path, params, { from, to: from + pageSize - 1 });
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}

const normalize = (value) => String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
const number = (value) => Number(String(value ?? '').replace(/[^0-9.-]/g, '')) || 0;
const auditAllYears = process.argv.includes('--all-years');
const busyDateKey = (value) => {
  const match = String(value ?? '').trim().match(/^(\d{2})-(\d{2})-(\d{4})$/);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : null;
};

const [financialYear] = await get('financial_years', {
  select: 'id,label,history_fyear_key,starts_on,ends_on',
  is_active: 'eq.true',
});
if (!financialYear) throw new Error('No active financial year');

const [users, aliases, sales] = await Promise.all([
  getAll('users', { select: 'id,full_name,role,is_active', role: 'eq.sales', order: 'full_name.asc' }),
  getAll('salesperson_source_aliases', {
    select: 'salesperson_user_id,source_name,normalized_source_name',
    order: 'source_name.asc',
  }),
  getAll('sales', {
    select: 'Salesman,Taxableamt,VchDate,FYear',
    ...(auditAllYears ? {} : { FYear: `eq.${financialYear.history_fyear_key}` }),
  }),
]);

const userById = new Map(users.map((user) => [user.id, user]));
const usersByNormalizedName = new Map();
for (const user of users) {
  const key = normalize(user.full_name);
  const matches = usersByNormalizedName.get(key) ?? [];
  matches.push(user);
  usersByNormalizedName.set(key, matches);
}
const aliasBySource = new Map(aliases.map((alias) => [alias.normalized_source_name, alias]));

const sourceSummary = new Map();
const blankSalesperson = { lineCount: 0, netSales: 0, financialYears: new Set() };
for (const row of sales) {
  const sourceName = String(row.Salesman ?? '').trim();
  const normalized = normalize(sourceName);
  if (!normalized) {
    blankSalesperson.lineCount += 1;
    blankSalesperson.netSales += number(row.Taxableamt);
    if (row.FYear) blankSalesperson.financialYears.add(String(row.FYear).trim());
    continue;
  }
  const current = sourceSummary.get(normalized) ?? {
    sourceName,
    normalizedSourceName: normalized,
    lineCount: 0,
    netSales: 0,
    firstDate: null,
    lastDate: null,
  };
  current.lineCount += 1;
  current.netSales += number(row.Taxableamt);
  const date = busyDateKey(row.VchDate);
  if (date && (!current.firstDate || date < current.firstDate)) current.firstDate = date;
  if (date && (!current.lastDate || date > current.lastDate)) current.lastDate = date;
  sourceSummary.set(normalized, current);
}

const rows = [...sourceSummary.values()].map((source) => {
  const alias = aliasBySource.get(source.normalizedSourceName) ?? null;
  const mappedUser = alias ? userById.get(alias.salesperson_user_id) ?? null : null;
  const exactUsers = usersByNormalizedName.get(source.normalizedSourceName) ?? [];
  let status = 'unmapped';
  let proposedUser = null;

  if (mappedUser?.is_active) {
    status = 'mapped-active';
  } else if (mappedUser && !mappedUser.is_active) {
    status = 'mapped-inactive-review';
  } else if (!alias && exactUsers.length === 1 && exactUsers[0].is_active) {
    status = 'safe-exact-match';
    proposedUser = exactUsers[0];
  } else if (!alias && exactUsers.length > 0) {
    status = 'ambiguous-exact-match';
  }

  return {
    ...source,
    netSales: Math.round(source.netSales * 100) / 100,
    status,
    mappedUserId: mappedUser?.id ?? null,
    mappedUserName: mappedUser?.full_name ?? null,
    mappedUserActive: mappedUser?.is_active ?? null,
    proposedUserId: proposedUser?.id ?? null,
    proposedUserName: proposedUser?.full_name ?? null,
  };
}).sort((a, b) => Math.abs(b.netSales) - Math.abs(a.netSales));

const aliasedSourceNames = new Set(rows.map((row) => row.normalizedSourceName));
const activeUsersWithoutAnyAlias = users
  .filter((user) => user.is_active && !aliases.some((alias) => alias.salesperson_user_id === user.id))
  .map((user) => ({ id: user.id, name: user.full_name }));
const staleAliases = aliases
  .filter((alias) => !aliasedSourceNames.has(alias.normalized_source_name))
  .map((alias) => ({
    sourceName: alias.source_name,
    mappedUserId: alias.salesperson_user_id,
    mappedUserName: userById.get(alias.salesperson_user_id)?.full_name ?? null,
  }));

const report = {
  financialYear,
  scope: auditAllYears ? 'all-history' : financialYear.label,
  counts: {
    sourceRows: sales.length,
    distinctSourceSalespeople: rows.length,
    appSalesUsers: users.length,
    aliases: aliases.length,
  },
  safeExactMatches: rows.filter((row) => row.status === 'safe-exact-match'),
  reviewRequired: rows.filter((row) => ['unmapped', 'mapped-inactive-review', 'ambiguous-exact-match'].includes(row.status)),
  mappedActive: rows.filter((row) => row.status === 'mapped-active'),
  activeUsersWithoutAnyAlias,
  staleAliases,
  blankSalesperson: {
    lineCount: blankSalesperson.lineCount,
    netSales: Math.round(blankSalesperson.netSales * 100) / 100,
    financialYears: [...blankSalesperson.financialYears].sort(),
  },
};

if (process.argv.includes('--actionable-only')) {
  delete report.mappedActive;
}

console.log(JSON.stringify(report, null, 2));
