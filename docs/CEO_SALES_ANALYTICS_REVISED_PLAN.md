# CEO Sales Analytics — Revised Phase 1 Delivery Plan

## Goal

Deliver an admin-only company sales command center without putting the production database, existing Busy refreshes, or the current application at risk. The metric definitions from the approved Phase 1 brief remain unchanged; this revision changes how the work is developed, deployed, backfilled, and verified.

## What changes from the first approach

1. **No backfill, refresh, or cron work inside a schema migration.** Migrations contain bounded DDL only and should complete in seconds.
2. **No direct production-first development.** SQL is iterated with disposable/test execution, reconciled, and only then captured as a clean migration.
3. **Backfill is resumable and month-bounded.** Each month commits independently, records its checkpoint, and can be retried without replacing already verified months.
4. **The frontend ships last and stays behind a database-controlled feature flag.** A missing or unhealthy analytics backend cannot expose a broken Admin route.
5. **Every release has an explicit stop gate and rollback script.** Schema, data, RPC, UI, and scheduling are separate releases.

## Release 0 — Recover and establish a clean baseline

Do not resume implementation until the linked Supabase project answers REST and SQL health checks normally.

- Confirm the project API, Auth, and SQL endpoints respond.
- Inspect `pg_stat_activity`, locks, `cron.job`, migration history, and the `analytics_private` schema.
- Cancel only sessions whose query text is an abandoned CEO analytics refresh.
- Unschedule only CEO analytics cron jobs, if present.
- Drop the four CEO public RPCs and the `analytics_private` schema if they were partially created.
- Verify no CEO analytics migration is recorded and no CEO analytics objects remain.
- Re-run the existing application smoke test before any new database work.

**Gate:** production is healthy and the pre-project schema/catalog is restored.

## Release 1 — Freeze the metric contract with read-only proofs

Build a SQL verification pack before creating tables.

- Define one canonical expression each for Busy voucher date, signed taxable value, signed quantity, party text, salesperson key, product-group key, and distinct invoice identity.
- Prove totals for both loaded financial years and at least three sample months.
- Produce fixed expected results for:
  - source rows and signed net sales;
  - positive sales and absolute returns;
  - distinct invoices, including multi-product-group bills;
  - exact, unique-normalized, collision, and unmatched party coverage;
  - market completeness and `Unmapped` contribution;
  - `Direct` contribution;
  - current overdue outstanding joined by Busy code.
- Save the expected results as assertions in the audit script, with tolerances only for currency rounding.

**Gate:** metric definitions are agreed and read-only source queries reconcile.

## Release 2 — Identity spine only

Create one small DDL migration containing:

- private `analytics_private` schema;
- `party_identity_map`, keyed by exact trimmed source party text;
- generated normalized-name index, canonical customer id, match method, confidence, review state, and audit fields;
- `analytics_refresh_runs` and `analytics_backfill_checkpoints` metadata tables;
- least-privilege grants, revoked defaults, and RLS defense in depth;
- indexes and constraints only.

Seed or refresh identities with a separate bounded command after the migration commits:

- exact unique match first;
- unique normalized match second;
- collisions remain unresolved;
- manual/reviewed mappings are immutable to automatic refreshes.

**Gate:** identity counts, 17 collision keys, unmatched labels, and mapped absolute value reconcile; mapped value is at least 97%.

## Release 3 — Facts and refresh engine, without cron

Create a second small DDL migration containing:

- daily sales fact at date × party identity × normalized salesperson × normalized product group;
- daily invoice fact at date × party identity × normalized salesperson;
- composite indexes matching the date/window and party/date access paths;
- refresh functions with explicit date ranges, advisory try-locks, short statement/lock timeouts, and source-volume guards.

Refresh design:

- Parse each source row once into a temporary staging relation for the requested range.
- Aggregate and validate staging before touching target rows.
- Replace one bounded date range in a short transaction only after source/fact assertions pass.
- Record success or failure outside the replace transaction so failed runs remain observable.
- Never use an exception handler that accidentally commits partial target replacement.

Backfill operationally, not through migration execution:

1. Run one month at a time, oldest to newest.
2. After each month, reconcile raw row count, signed taxable amount, return amount, signed quantity, and distinct invoice count.
3. Mark the month complete only after all assertions pass.
4. Stop on the first failed month; retry only that month after diagnosis.

**Gate:** every loaded month is checkpointed and reconciled; duplicate fact grains are zero.

## Release 4 — Admin RPC contract and security

Create a third DDL migration for the public RPCs only:

- `ceo_sales_overview`;
- `ceo_city_contribution`;
- `ceo_unmapped_sales_parties`;
- `ceo_map_sales_party`.

Security requirements:

- JWT identity comes only from `auth.uid()`;
- active admin status is checked inside each privileged RPC;
- `SECURITY DEFINER` functions use `search_path = ''` and fully qualified objects;
- execution is revoked from `PUBLIC` and `anon`, and granted only where required;
- no client role can read private facts or run refresh functions.

Performance requirements:

- use `EXPLAIN (ANALYZE, BUFFERS)` against representative MTD, QTD, and FYTD calls;
- all CEO read RPCs complete within the agreed interactive budget under production-scale data;
- run Supabase security and performance advisors and resolve new findings.

**Gate:** active admins succeed; anonymous, sales, billing, inactive-admin, and impersonation scenarios fail as intended; overview and market totals reconcile exactly.

## Release 5 — Frontend behind a feature flag

Implement the lazy-loaded `/admin/sales-analytics` page in an isolated frontend change.

- Route requires the real authenticated admin and admin unlock state.
- A server-controlled capability/feature flag hides the Admin entry until backend gates pass.
- React Query hooks and parsers remain isolated from the salesperson dashboard.
- URL parameters own `period` and `sort`.
- Data-quality below 97% blocks decision KPIs and shows the unmatched summary.
- Include skeleton, empty, stale, missing-calendar, missing-target, and retryable-error states.
- Verify 320 px and 390 px layouts, keyboard operation, accessible labels, and no horizontal overflow.

**Gate:** presentation tests, scoped lint, TypeScript build, browser smoke tests, and a real authenticated-admin session all pass.

## Release 6 — Scheduling and production enablement

Scheduling is the final database change.

- Add the 45-day refresh every 15 minutes.
- Add the active-FY refresh after the external Busy refresh window.
- Do not schedule an initial backfill job.
- Enable the frontend feature flag only after the first scheduled refresh succeeds and reconciles.
- Monitor refresh failure count, duration, source maximum date, source-volume guard trips, and mapped value.

**Gate:** two consecutive incremental refreshes and one nightly refresh complete within budget with no reconciliation drift.

## Rollback strategy

Prepare and review rollback SQL before each release.

- **UI:** disable the feature flag, then revert the frontend-only change.
- **Scheduling:** unschedule CEO jobs first.
- **RPC:** revoke and drop only the four CEO RPC signatures.
- **Facts:** stop refresh jobs, retain data for diagnosis if safe, then drop the facts in a separately approved cleanup.
- **Identity:** preserve reviewed manual mappings as an export before dropping the private schema.
- Never roll back or rewrite raw `sales`, `customers`, `customersos`, sales pace tables, or existing Busy refresh jobs.

## Final acceptance checklist

- Production remains responsive throughout schema deployment and backfill.
- Raw/fact reconciliation passes for both financial years and every loaded month.
- Market totals, including `Unmapped`, equal the company overview.
- Distinct invoice counts do not duplicate multi-group bills.
- Mapping is at least 97% by absolute sales value and collisions remain unresolved automatically.
- `Direct` remains explicit and included in company and market totals.
- Current overdue values carry the latest receivables report date.
- Unauthorized roles cannot call CEO RPCs or access internal objects.
- The actual-admin dashboard works on mobile and desktop with real production data.
