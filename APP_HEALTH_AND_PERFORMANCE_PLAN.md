# PASPL Master — App Health & Performance Plan

Date: 2026-07-18. Scope: full working tree (`src/` 619 TS/TSX files, ~119k lines; 185 migrations; 5 edge functions). Builds on `PERFORMANCE_AUDIT_FINDINGS.md`, `audits/codebase-audit-2026-05-24.md`, and `docs/ENGINEERING_STRATEGY_SUMMARY.md` — this document turns those findings plus a fresh structural analysis into an execution plan.

---

## 1. Executive summary

The app is in better shape than most codebases of its age: strict TypeScript with a clean typecheck and only 3 `any` usages, 41 pure-logic test files, disciplined bundle splitting (heavy deps like `xlsx`, `pdfjs`, `maplibre`, and the WASM scanners all live in lazy chunks), a hardened realtime helper with circuit breaking, and a strong docs culture.

The risks are structural, and they compound with growth speed. The codebase **doubled in ~8 weeks** (284 files in the May audit → 619 now). The three biggest problems:

1. **No safety net.** There is no CI, no test runner, and no single `npm test`. Only ~17 of 41 test files are wired into package.json as individual node scripts. At the current change rate this is the highest-leverage gap.
2. **The data layer is duplicated, not shared.** 14 files query `orders` directly with different select shapes; 306 `useQuery`/`useMutation` call sites use ad-hoc string-literal keys; 223 scattered `invalidateQueries` calls. Four parallel billing work surfaces (Dashboard, LiveQueue, CompactQueue, BillingDesk) each re-implement queue fetching, claiming, and approval.
3. **Hotspot god-files keep growing.** `NewOrderPage.tsx` is now 3,958 lines (+1,660 since the last audit); `PickFlowPanel.tsx` 3,223; `CartPage.tsx` 2,057. The highest-churn files (git, last 90 days) are exactly the biggest files — every feature makes them bigger and riskier.

Database-side load (5s/2s queue polling, 30s items/pending polls, trigger fan-out on ERP deltas) is already well documented in `PERFORMANCE_AUDIT_FINDINGS.md` §7 — that work needs execution and measurement, not re-analysis.

**Recommended order of attack:** guardrails first (CI + test runner, ~1 week), then measure the DB (run the prepared diagnostic SQL, ~1 day), then fix the top confirmed hot paths, then consolidate the data layer, then decompose hotspots opportunistically. Details and sequencing in §6.

---

## 2. What is already good — protect it

| Strength | Evidence | Rule to keep it |
|---|---|---|
| Type discipline | `tsc --noEmit` passes; 3 `any` usages in 119k lines | Keep `strict`; no new `any` |
| Pure-logic testing style | 41 `*.test.ts` files testing derivation functions (`billLineOutcome`, `pickQueueEligibility`, …) | Keep extracting logic into pure functions; this is the cheapest testing strategy available |
| Bundle discipline | 59 lazy routes; `maplibre` (1.0 MB), `pdf` (365 KB), wasm scanners all lazy; core `index` chunk 287 KB | Add a bundle-size check to CI so regressions are caught (see §6, Phase 0) |
| Realtime resilience | `src/lib/realtime.ts` — circuit breaker, deferred teardown, REST fallback | All new subscriptions go through `subscribeToTable`; never raw `.channel()` |
| Docs culture | 20 docs in `docs/`, contracts written before integrations | Keep writing contracts first (per `ENGINEERING_STRATEGY_SUMMARY.md` §10) |
| PWA/offline groundwork | Tuned precache globs in `vite.config.ts`; offline pick/sales-order queues with conflict pages | Unify the storage layer before adding more offline features (§5.3) |

---

## 3. Findings — code health

### 3.1 God components at the center of churn

Top files by size, cross-referenced with git churn (commits touching the file, last 90 days):

| File | Lines | Churn | Notes |
|---|---:|---:|---|
| `src/pages/sales/NewOrderPage.tsx` | 3,958 | 20 | +1,660 lines since the perf audit was written |
| `src/pages/picking/PickFlowPanel.tsx` | 3,223 | 15 | |
| `src/pages/sales/CartPage.tsx` | 2,057 | 28 | |
| `src/pages/admin/LabelStudioPage.tsx` | 2,043 | — | low churn; lower priority |
| `src/pages/picking/PickPage.tsx` | — | 39 | highest churn in repo |
| `src/types/index.ts` | 716 | 35 | every domain change touches this one file |
| `src/context/AuthContext.tsx` | 770 | — | grew from 257 lines; session recovery + impersonation + backfill in one provider |

The pattern to worry about: **churn concentrates in the biggest files.** That means every feature increases the cost of the next one (classic change amplification). The fix is not a big-bang rewrite — it is a standing rule: *when you touch a >1,500-line file, extract the piece you're touching into a hook/component/lib module first.* The codebase already knows how to do this well — `src/pages/billing/BillingDesk/` is a good example of a decomposed feature folder (22 focused files), and so is `src/features/picking/`.

### 3.2 Types monolith

`src/types/index.ts` holds 63 interfaces/types for every domain (orders, billing, picking, receiving, sales, users). It has 35 commits in 90 days — it is a global coupling point and a merge-conflict magnet. Split it by domain (`src/types/orders.ts`, `billing.ts`, `picking.ts`, …) and re-export from `index.ts` so no imports break. Mechanical, low-risk, one sitting.

### 3.3 Dead/vestigial code paths

- `usePickerPushNotifications.ts` is a 4-line alias of `useRolePushNotifications` — fold it in.
- `useClaimableOrders` still subscribes to `work_claims`, which migration 035 removed from the realtime publication — the subscription silently does nothing (perf audit §4).
- Env flags keep whole parallel implementations alive: `VITE_BILLING_QUEUE_EVENTS` (legacy vs event-stream queue paths inside `useClaimableOrders`, 767 lines), `VITE_PICKER_V`, `VITE_PICK_MRP_SPLIT`, `VITE_PICK_TRANSITION_MODE`, `VITE_ENABLE_DIRECT_TABLE_REALTIME`, `VITE_DISABLE_SUPABASE_REALTIME`. Each flag doubles the states the code can be in. Decide the winner for each, delete the loser (see §6, Phase 2).
- `refresh_customer_frequency` / `rebuild_item_cooccurrence` and the `customer_item_frequency` MV have no callsites in `src/` (perf audit §3) — confirm and drop.
- Repo-root junk: `output/` (476 KB), `.codex_tmp/`, `tmp/`, `analyze.js`, `task.md` — delete or gitignore.
- 23 `console.log` leftovers in `src/`.

### 3.4 Migration hygiene

185 migrations with two naming eras (numbered `005_…` → timestamped `20260704…`). Recent migrations encode person-specific data fixes (`20260718171115_enforce_guddu_busy_identity.sql`, `map_kamlakar_busy_sales_to_direct`). Data patches don't belong in schema migrations — they can't be replayed on a fresh environment and they leak operational one-offs into the schema history. Adopt a convention: schema changes = migrations; data fixes = a `supabase/data-fixes/` folder of run-once scripts, or admin tooling. Also: four RPCs have 3–4 competing `CREATE OR REPLACE` definitions across migrations (perf audit §2) — a single "current definition" reference file per RPC (or a `supabase/functions.sql` snapshot) would make drift visible.

---

## 4. Findings — data flow & duplication

### 4.1 One domain, many uncoordinated fetch paths

The same `orders`/`order_items` data is fetched by at least 8 hooks (`useOrders`, `useClaimableOrders`, `useOrderDetail`, `useBillingDeskOrders`, `usePickerCompletedOrders`, `usePickerDailyStats`, `usePickerLoad`, `useSalesPendingRecovery`) plus inline queries in pages (`ReviewPage`, `CompactQueuePage`) and lib mutations. Each has its own select shape, its own string-literal query key, its own staleTime, and its own invalidation list. Consequences:

- **Cache duplication:** the same order rows live in memory under `['orders']`, `['claimable-orders']`, `['order', id]`, `['billing-desk-…']` simultaneously, in different shapes.
- **Invalidation sprawl:** 223 `invalidateQueries` calls; a mutation must remember every key that might hold stale copies (e.g. `useBillSheetEdits` invalidates 3+ keys per mutation). Missing one = stale UI; over-invalidating = redundant refetch bursts.
- **Payload waste:** ~10 `.select('*')` sites on broad tables (perf audit §5) because there is no shared column list per view.

**Target architecture** (incremental, not a rewrite):

```
src/data/
  keys.ts          — single query-key factory (orderKeys.list(filters), orderKeys.detail(id), …)
  orders.ts        — the ONLY module that runs supabase.from('orders'); named selects
                     (ORDER_LIST_COLS, ORDER_DETAIL_COLS); fetchers + mutation helpers
  items.ts, customers.ts, pending.ts, …
```

Hooks become thin wrappers over `src/data/*`; invalidation goes through key-factory helpers (`invalidateOrder(qc, id)`), so a mutation names an *event*, not a list of caches. Migrate one domain at a time — orders first, since it is the worst offender.

### 4.2 Four billing surfaces, four queue implementations

`/billing` (DashboardPage), `/billing/queue` (LiveQueuePage + LiveQueue/ 1,163-line OrderSheetView), `/billing/compact` (CompactQueuePage, 1,046 lines), `/billing/desk` (BillingDeskPage + 22 files) are all live routes over the same queue, with independently implemented claim/approve/reject flows. `completeBilling` exists both as `src/lib/billing/completeBilling.ts` *and* inline in `ReviewPage.tsx:506`. Approvals do per-line REST updates in two places (`liveQueueDraft.ts:81`, `LiveQueuePage.tsx:307` — flagged in perf audit §5 as needing a set-based RPC).

Decide which surfaces are actually used by operators (check with the team), sunset the rest, and extract the shared verbs — claim, release, approve, reject, resolve-flag — into `src/data/billing.ts` used by whichever surfaces survive.

### 4.3 Client-side storage is four parallel systems

1. React Query cache (30 min gc) — server state
2. IndexedDB via `src/lib/idb.ts` — items catalog watermark sync (`useItems`), customers, transports, locationwise stock, offline picks (1,018-line `offlinePicks.ts`), offline sales orders (599 lines)
3. `localStorage` — 11 files, ad-hoc (auth/session, drafts via `cartDraftStorage`, flags)
4. `crossTabSync.ts` — separate broadcast layer

Each new offline feature re-invents persistence, versioning, and conflict handling. Worth consolidating behind one `src/lib/storage/` module with a declared schema/version per store — especially before the Busy outbox work (strategy doc §6) adds yet another queue.

### 4.4 Fetch-pressure hot paths (from the perf audit — needs execution)

Priorities confirmed by the audit's §7, in order:

1. `get_billing_queue_snapshot` called every 5s per mounted queue view; its SQL groups **all** `order_items` before filtering orders.
2. Queue/list hooks stack realtime invalidation **plus** 5s/2s keep-alive polling, with several unfiltered `orders` subscriptions.
3. ERP item deltas (`apply_erp_items_delta`) fan out per-row triggers (`updated_at` + pending-recovery recompute + notifications).
4. Every active client runs a 30s `items` delta poll; cold clients pull the full catalog in 1,000-row pages.
5. Pending-recovery screens poll `pending_items` (select \*) every 30s with client-side salesperson filtering.

The audit already contains the diagnostic SQL (§6) and confirm/refute criteria (§8). **Run it against production before changing anything** — then fix in measured order. Likely shapes of the fixes: make the snapshot RPC filter orders before aggregating lines; drop keep-alive polls to ≥30s where a filtered realtime subscription exists (trust the circuit-breaker fallback to re-enable faster polling); make `items` delta polling visibility-gated and slower (strategy doc suggests 6h catalog staleness); move salesperson filtering server-side; batch trigger work via statement-level triggers or a debounced queue.

---

## 5. Findings — platform & process

### 5.1 No CI, no unified test runner (highest priority)

- No `.github/workflows/` (deploys are Vercel push-to-main).
- 41 test files, but only ~17 have package.json entries, each a separate `node --import tsx` script. Nothing runs them all; nothing runs them automatically. A quarter of the suite can silently rot.
- `npm run build` (tsc + vite) and `npm run lint` exist but nothing enforces them pre-merge.

Fix is cheap: adopt **vitest** (native to the Vite toolchain — existing `node:assert`-style tests need little or no change), one `npm test` running all 41 files, and a GitHub Actions workflow: typecheck + lint + test + build on every push/PR. One day of work; converts the excellent-but-idle test culture into an actual regression net.

### 5.2 Auth is still MVP-grade while the app runs real operations

Per `ENGINEERING_STRATEGY_SUMMARY.md` §5: shared access code + client-side role selection; RLS not the primary enforcement layer. The app now handles receivables, pricing, and user management — the gap between data sensitivity and auth strength is widening. Recent migrations (`restrict_push_subscription_sync_to_authenticated`, phone auth, PIN reset edge functions) show movement; the plan should finish it: one Supabase Auth account per staff member, role in a profile table, RLS on financially-sensitive tables first (`customer receivables`, `sales_targets`, `users`), then the rest.

### 5.3 Config sprawl

35 `import.meta.env.VITE_*` reads scattered across files, plus a `VITE_GEMINI_API_KEY` read in client code (verify this key is safe to expose in the browser bundle; if not, proxy through an edge function). Centralize into one `src/lib/env.ts` with parse-once validation, so a missing/misspelled flag fails loudly at boot instead of silently enabling a legacy code path.

---

## 6. Execution plan

### Phase 0 — Guardrails & hygiene (≈1 week, do first)

| # | Action | Effort | Payoff |
|---|---|---|---|
| 0.1 | Add vitest + single `npm test` covering all 41 test files | 0.5–1 d | Whole suite runs; new tests are free |
| 0.2 | GitHub Actions: typecheck, lint, test, build on PR/push | 0.5 d | Nothing broken lands on main/Vercel |
| 0.3 | Bundle-size budget in CI (fail if `index-*.js` > 320 KB or any new chunk > 1.5 MB) | 0.5 d | Locks in current bundle discipline |
| 0.4 | Delete root junk (`output/`, `.codex_tmp/`, `tmp/`, `analyze.js`), gitignore, strip 23 `console.log`s | 0.5 d | Hygiene |
| 0.5 | Fold `usePickerPushNotifications` alias; remove dead `work_claims` subscription | 0.5 d | Less dead surface |

### Phase 1 — Measure, then fix the confirmed DB hot paths (≈1–2 weeks)

| # | Action |
|---|---|
| 1.1 | Run `PERFORMANCE_AUDIT_FINDINGS.md` §6 SQL against production; record results in `audits/` |
| 1.2 | Fix the top confirmed offenders from §4.4 in measured order (snapshot RPC shape, polling intervals, trigger fan-out, `select('*')` narrowing, server-side salesperson filtering) |
| 1.3 | Re-run the SQL; write before/after numbers into the audit doc. Success target: ≥50% drop in total DB exec time from queue/poll paths |

### Phase 2 — Kill parallel implementations (≈2 weeks, interleave with features)

| # | Action |
|---|---|
| 2.1 | For each env flag (`VITE_BILLING_QUEUE_EVENTS`, `VITE_PICKER_V`, `VITE_PICK_MRP_SPLIT`, `VITE_PICK_TRANSITION_MODE`), decide the winner with the team; delete the losing path. `useClaimableOrders` should shrink dramatically |
| 2.2 | Confirm with operators which billing surfaces are used; sunset unused routes among Dashboard/LiveQueue/CompactQueue/Desk |
| 2.3 | Single `completeBilling`/approve path; replace both per-line `order_items` update loops with one set-based RPC |
| 2.4 | Centralize env reads in `src/lib/env.ts`; verify the Gemini key exposure |

### Phase 3 — Shared data layer (≈3–4 weeks, one domain at a time)

| # | Action |
|---|---|
| 3.1 | Create `src/data/keys.ts` (query-key factory) + `src/data/orders.ts`; migrate the 14 `orders` call sites; replace ad-hoc invalidations with event-style helpers |
| 3.2 | Repeat for `items`, `customers`, `pending_items`; named column lists replace `select('*')` |
| 3.3 | Split `src/types/index.ts` by domain with re-exports (one sitting, mechanical) |
| 3.4 | Consolidate IDB/localStorage/crossTab into `src/lib/storage/` with versioned stores — *before* building the Busy outbox on top |

### Phase 4 — Structural decomposition & platform (ongoing)

| # | Action |
|---|---|
| 4.1 | Standing rule: touching a >1,500-line file requires extracting the touched region first. Priority targets by churn×size: `PickPage`, `NewOrderPage`, `CartPage`, `PickFlowPanel` |
| 4.2 | Split `AuthContext` into session, impersonation, and profile-backfill modules |
| 4.3 | Real auth: Supabase Auth per staff member + RLS, financially-sensitive tables first (strategy doc §5) |
| 4.4 | Migration hygiene: data fixes out of schema migrations; current-definition snapshots for multiply-redefined RPCs |
| 4.5 | Busy ERP outbox worker per strategy doc §6–7 — contract first, on top of the unified storage layer |

### What NOT to do

- No framework moves (Vite fits — strategy doc §3), no state-management rewrite (React Query + thin contexts is right; Zustand is barely used and can stay niche), no big-bang refactor of the god pages, no `order_items` partitioning yet (~1.5M rows over 2 years is fine with good indexes — revisit only if Phase 1 measurements say otherwise).

---

## 7. Success metrics

| Metric | Now | Target (3 months) |
|---|---|---|
| CI on every PR | none | typecheck + lint + all tests + build + bundle budget |
| Test files running automatically | 0 of 41 | 41 of 41, `npm test` |
| DB exec time from queue/poll paths | unmeasured | measured, then −50% |
| Files > 1,500 lines | 8 | ≤ 5, none growing |
| Modules calling `supabase.from('orders')` | 14 | 1 (`src/data/orders.ts`) |
| Divergent-path env flags | 6 | ≤ 2 |
| Billing queue implementations | 4 | ≤ 2 (deliberate) |
| `console.log` in src | 23 | 0 (lint-enforced) |
| RLS on sensitive tables | partial | receivables, targets, users enforced |

---

## 8. Risks

- **Consolidation vs. shipping tension.** Phases 2–3 compete with feature work. Mitigation: each step is independently shippable; interleave one consolidation PR per feature cycle rather than pausing delivery.
- **Sunsetting the wrong billing surface.** Operators may quietly depend on a "legacy" screen. Mitigation: add lightweight route-visit logging for two weeks before removing anything.
- **RLS rollout breaking flows.** Enabling RLS on tables the anon-key client writes today can hard-break the app. Mitigation: per-table rollout with a dry-run policy audit; keep the shared-code path working until every role is migrated.
- **Trigger changes on `items`/`pending_items`.** Pending-recovery notifications are user-facing; debouncing must not drop them. Mitigation: keep the existing per-row path behind a flag until the batched path is verified in production.
