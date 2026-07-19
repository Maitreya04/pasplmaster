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

const headers = {
  apikey: serviceKey,
  Authorization: `Bearer ${serviceKey}`,
};

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

const [financialYear] = await get('financial_years', {
  select: 'id,label,history_fyear_key,starts_on,ends_on',
  is_active: 'eq.true',
});
if (!financialYear) throw new Error('No active financial year');

const [targets, segments, members, targetMembers, aliases, users, sales] = await Promise.all([
  getAll('sales_targets', {
    select: 'salesperson_user_id,product_group,sales_segment_id,annual_target_lakhs',
    financial_year_id: `eq.${financialYear.id}`,
  }),
  getAll('sales_segments', { select: 'id,name,is_unmapped' }),
  getAll('sales_segment_members', {
    select: 'source_product_group,normalized_source_group,sales_segment_id',
    financial_year_id: `eq.${financialYear.id}`,
  }),
  getAll('sales_target_segment_members', {
    select: 'salesperson_user_id,source_product_group,normalized_source_group,sales_segment_id,match_rule,match_priority',
    financial_year_id: `eq.${financialYear.id}`,
  }),
  getAll('salesperson_source_aliases', {
    select: 'salesperson_user_id,normalized_source_name,source_name',
  }),
  getAll('users', { select: 'id,full_name', role: 'eq.sales' }),
  getAll('sales', {
    select: 'Salesman,ItemmainGrp,ItemGrp,Taxableamt,VchDate,FYear',
    FYear: `eq.${financialYear.history_fyear_key}`,
  }),
]);

const segmentById = new Map(segments.map((row) => [row.id, row]));
const memberByMain = new Map(members.map((row) => [row.normalized_source_group, row]));
const targetMemberByUserMain = new Map(
  targetMembers.map((row) => [`${row.salesperson_user_id}:${row.normalized_source_group}`, row]),
);
const userById = new Map(users.map((row) => [row.id, row.full_name]));
const userByAlias = new Map(aliases.map((row) => [row.normalized_source_name, row.salesperson_user_id]));
const targetByUserSegment = new Set(
  targets.map((row) => `${row.salesperson_user_id}:${row.sales_segment_id}`),
);

const sourcePairs = new Map();
const actualByUserMain = new Map();
for (const row of sales) {
  const main = normalize(row.ItemmainGrp);
  const sub = normalize(row.ItemGrp);
  if (!main) continue;
  sourcePairs.set(main, {
    main: row.ItemmainGrp?.trim(),
    normalizedMain: main,
    sub: row.ItemGrp?.trim(),
    normalizedSub: sub,
  });
  const userId = userByAlias.get(normalize(row.Salesman));
  if (!userId) continue;
  const key = `${userId}:${main}`;
  actualByUserMain.set(key, (actualByUserMain.get(key) ?? 0) + number(row.Taxableamt));
}

const distinctTargets = [...new Map(
  targets.map((row) => [normalize(row.product_group), row]),
).values()].sort((a, b) => a.product_group.localeCompare(b.product_group));

function proposedMatch(target, pair) {
  const normalizedTarget = normalize(target.product_group);
  if (normalizedTarget === pair.normalizedMain) return 'exact-main';
  if (normalizedTarget === pair.normalizedSub) return 'exact-item-group';
  if (
    (normalizedTarget === 'bfanmotorassy' && pair.normalizedMain === 'bfanmotoraasy')
    || (normalizedTarget === 'fagbearing' && pair.normalizedMain === 'scfag')
    || (normalizedTarget === 'fagcross' && ['sccross', 'sccrs'].includes(pair.normalizedMain))
    || (normalizedTarget === 'scables' && pair.normalizedMain === 'sjcables')
    || (normalizedTarget === 'swarajoil' && pair.normalizedMain === 'swaraj')
    || (normalizedTarget === 'lucasinl' && pair.normalizedSub === 'lucas')
  ) return 'governed-alias';
  if (normalizedTarget === 'usha4w' && /^u4/.test(pair.normalizedMain) && pair.normalizedSub === 'usha') {
    return 'usha-4w-family';
  }
  if (normalizedTarget === 'usha3w' && /^u3/.test(pair.normalizedMain) && pair.normalizedSub === 'usha') {
    return 'usha-3w-family';
  }
  if (
    ['fastners', 'gfastners'].includes(normalizedTarget)
    && pair.normalizedSub === 'gratco'
    && /^gf/.test(pair.normalizedMain)
  ) return 'fastener-family';
  return null;
}

const targetCoverage = distinctTargets.map((target) => {
  const matches = [...sourcePairs.values()]
    .map((pair) => ({ pair, rule: proposedMatch(target, pair) }))
    .filter((candidate) => candidate.rule);
  return {
    target: target.product_group,
    segmentId: target.sales_segment_id,
    salespeople: targets
      .filter((row) => row.sales_segment_id === target.sales_segment_id)
      .map((row) => userById.get(row.salesperson_user_id)),
    matches,
  };
});

const collisions = new Map();
for (const coverage of targetCoverage) {
  for (const match of coverage.matches) {
    const candidates = collisions.get(match.pair.normalizedMain) ?? [];
    candidates.push({ target: coverage.target, segmentId: coverage.segmentId, rule: match.rule });
    collisions.set(match.pair.normalizedMain, candidates);
  }
}

const falseZeros = [];
for (const target of targets) {
  const currentActual = [...actualByUserMain]
    .filter(([key]) => key.startsWith(`${target.salesperson_user_id}:`))
    .reduce((sum, [key, value]) => {
      const main = key.slice(key.indexOf(':') + 1);
      const mappedSegmentId = targetMemberByUserMain.get(key)?.sales_segment_id
        ?? memberByMain.get(main)?.sales_segment_id;
      return mappedSegmentId === target.sales_segment_id ? sum + value : sum;
    }, 0);
  if (currentActual !== 0) continue;

  const coverage = targetCoverage.find((row) => row.segmentId === target.sales_segment_id);
  const proposedActual = (coverage?.matches ?? []).reduce(
    (sum, match) => sum + (actualByUserMain.get(`${target.salesperson_user_id}:${match.pair.normalizedMain}`) ?? 0),
    0,
  );
  if (proposedActual === 0) continue;

  falseZeros.push({
    salesperson: userById.get(target.salesperson_user_id),
    target: target.product_group,
    proposedActual: Math.round(proposedActual * 100) / 100,
    sources: coverage.matches
      .filter((match) => actualByUserMain.has(`${target.salesperson_user_id}:${match.pair.normalizedMain}`))
      .map((match) => `${match.pair.main} (${match.rule})`),
  });
}

const ambiguous = [...collisions]
  .filter(([, candidates]) => new Set(candidates.map((row) => row.segmentId)).size > 1)
  .map(([sourceMain, candidates]) => ({ sourceMain, candidates }));

const billedOutsideTarget = [];
for (const [key, value] of actualByUserMain) {
  if (value === 0) continue;
  const [userIdText, main] = key.split(':');
  const userId = Number(userIdText);
  const mappedSegmentId = targetMemberByUserMain.get(key)?.sales_segment_id
    ?? memberByMain.get(main)?.sales_segment_id;
  if (!mappedSegmentId || targetByUserSegment.has(`${userId}:${mappedSegmentId}`)) continue;
  billedOutsideTarget.push({
    salesperson: userById.get(userId),
    sourceMain: sourcePairs.get(main)?.main,
    currentSegment: segmentById.get(mappedSegmentId)?.name,
    value: Math.round(value * 100) / 100,
  });
}

console.log(JSON.stringify({
  financialYear,
  counts: {
    salesRows: sales.length,
    targets: targets.length,
    distinctTargets: distinctTargets.length,
    sourceMainGroups: sourcePairs.size,
    mappings: members.length,
    salespersonTargetMappings: targetMembers.length,
  },
  falseZeros,
  ambiguous,
  billedOutsideTarget: billedOutsideTarget.sort((a, b) => Math.abs(b.value) - Math.abs(a.value)),
  targetCoverage: targetCoverage.map((row) => ({
    target: row.target,
    salespeople: row.salespeople,
    matches: row.matches.map((match) => `${match.pair.main} <- ${match.rule}`),
  })),
  sourcePairs: [...sourcePairs.values()].sort((a, b) => a.main.localeCompare(b.main)),
}, null, 2));
