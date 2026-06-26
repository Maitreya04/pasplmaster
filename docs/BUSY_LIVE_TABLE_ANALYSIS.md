# Busy Live Tables Analysis

**Analysis date:** 2026-06-17  
**Supabase project:** `pasplmaster`  
**Tables analyzed:** `public.customers`, `public.customersos`, `public.ledger`, `public.sales`

> Note: the table the team called `customeros` is named `customersos` in Supabase.

## Executive Summary

The Busy synced tables are live and useful. They can turn PASPL Master from only an order workflow app into a customer intelligence, credit control, collections, reorder, sales performance, and purchase planning system.

The four core live tables cover:

- `customers`: Busy customer master, credit terms, geography, salesperson assignment.
- `customersos`: customer outstanding / receivable references.
- `ledger`: party ledger voucher rows.
- `sales`: line-level invoice/sales history.

Most valuable app uses:

1. Customer 360 for sales and billing.
2. Credit warnings and account-hold decisions before order approval.
3. Salesperson collections workflow.
4. WhatsApp ledger/outstanding sharing.
5. Repeat order and reorder suggestions.
6. Salesperson, customer, product-group, and SKU performance dashboards.
7. Purchase planning based on real sales velocity.

## Live Sync Verification

Checked against live Supabase on 2026-06-17.

| Table | Current rows | Freshness signal |
|---|---:|---|
| `customers` | 3,314 | 81 rows updated today; latest `updated_at` was `2026-06-17 15:43 UTC`. |
| `customersos` | 8,080 | All 8,080 rows updated in the last 24h; latest report date `17-06-2026`. |
| `ledger` | 80,737 | Entire table from run date `17-06-2026`; contains 126 voucher rows dated `2026-06-17`. |
| `sales` | 234,920 | Latest voucher date `2026-06-17`; that day has 552 sales lines across 113 vouchers. |

`sales` does not have an `updated_at` column, so freshness is inferred from voucher dates and database table activity.

For voucher date `17-06-2026`, `sales` showed:

- Net sales amount: `INR 17,34,063.73`
- Taxable sales amount: `INR 14,64,035.77`
- 113 vouchers / bills
- 552 sales line rows
- 87 parties
- 395 items
- Total quantity: `4,859.4`

## Current Data Inventory

| Table | Purpose | Useful keys / fields |
|---|---|---|
| `customers` | Customer master from Busy | `busy_code`, `name`, `salesman`, `mobile`, `gstno`, `station`, `state`, `creditlimitamt`, `creditsalesdays` |
| `customersos` | Outstanding / receivable references | `party_code`, `party_name`, `sales_man`, `type`, `vch_bill_no`, `ref_amt`, `amount`, `days`, `report_dt` |
| `ledger` | Ledger statement rows | `"Party Name"`, `"Sales Man"`, `"Date"`, `"VchType"`, `"DocNo"`, `"Amount"`, `"ShortNar"`, `"RunDatetime"` |
| `sales` | Invoice line history | `"FYear"`, `"VchCode"`, `"VchDate"`, `billno`, `"Party"`, `"Itemname"`, `"ItemmainGrp"`, `"Qty"`, `"Price"`, `"Taxableamt"`, `"netAmount"`, `"Salesman"` |

Important relationship findings:

- `customersos.party_code` maps cleanly to `customers.busy_code`.
- `customers.name` matches the older app customer table names, so migration/enrichment is feasible.
- `sales."Itemname"` mostly matches `items.name`, so historical sales can drive SKU intelligence.
- Customer joins should prefer `busy_code`; name matching should be fallback only.

## Table Findings

### `customers`

What it gives us:

- Customer identity: `busy_code`, `name`.
- Sales ownership: `salesman`.
- Contact: `mobile`, `contact`, `email`.
- GST: `gstno`.
- Geography: `country`, `state`, `station`, `pincode`, `address1` to `address4`.
- Segmentation: `grp1`, `grp2`, `grp3`.
- Credit policy: `creditlimitamt`, `creditsalesdays`.
- Sync/activity: `is_active`, `created_at`, `updated_at`.

Useful in app:

- Customer search and customer profile.
- My Beat filtering by salesperson, station, city/region.
- Credit context before order creation.
- GST/contact/address verification.
- WhatsApp contact and statement sharing.

Watch-outs:

- The current app still has older references to `customers1`; plan a safe bridge/migration.
- Some geography labels need normalization.
- Credit limit appears sparse, so validate before enforcing hard blocks.

### `customersos`

What it gives us:

- Open outstanding by party.
- Aging via `days`.
- Original amount via `ref_amt`.
- Current outstanding via `amount`.
- Document reference via `vch_bill_no`.
- Salesperson ownership via `sales_man`.

Useful in app:

- Customer outstanding badge.
- Credit warning on order submit.
- Billing approval credit checkpoint.
- Sales collections dashboard.
- Party-wise aging buckets.
- WhatsApp outstanding summary.
- Visit planning: prioritize overdue parties.

Watch-outs:

- Confirm whether it intentionally only includes older outstanding rows.
- Negative amounts should be treated as credits/adjustments.
- Dates are text; normalize them before frontend use.

### `ledger`

What it gives us:

- Full voucher movement for each customer.
- Sales, receipt, opening, journal, credit note, payment and purchase entries.
- Narration through `"ShortNar"`.
- Run freshness through `"RunDatetime"`.

Useful in app:

- Customer ledger statement screen.
- Last payment date.
- Last sale date.
- Payment history before sales visit.
- Dispute context for billing and sales.
- Account hold decisions with evidence.

Watch-outs:

- Column names contain spaces and capital letters.
- `"Amount"` is text and should be parsed in SQL views/RPCs.
- Sign convention must be confirmed before showing debit/credit labels.
- Some ledger rows can be post-dated.

### `sales`

What it gives us:

- Invoice line-level history.
- Customer buying history.
- SKU and product-group velocity.
- Salesperson performance.
- Pricing and discount context.
- Material center / branch signal.

Useful in app:

- Repeat last order.
- Customer top SKUs.
- Dormant SKU prompts.
- Frequently bought together.
- Salesperson achievement dashboard.
- Product-group sales dashboard.
- SKU velocity for purchase planning.
- Slow/fast moving item analysis.
- Customer segmentation by value, frequency, recency.

Watch-outs:

- No `updated_at`, so add a sync timestamp column or separate sync audit table.
- Numeric fields like `"Qty"` and `"netAmount"` are text.
- Date field `"VchDate"` is text.
- `"ITEMSRNO"` does not look like a reliable SKU master key; validate before using it.
- Negative quantities likely represent returns/adjustments.

## Recommended App-Facing Data Layer

Do not build screens directly on raw Busy table columns. Create normalized views or materialized views.

Recommended views:

- `busy_customers_v`
  - normalized customer master with `customer_busy_code`, `name`, `salesman`, `mobile`, `gstin`, `station`, `state`, `credit_limit`, `credit_days`.
- `busy_customer_outstanding_v`
  - one row per customer with total outstanding, aging buckets, oldest due days, invoice count.
- `busy_ledger_entries_v`
  - parsed ledger date, parsed numeric amount, normalized voucher type.
- `busy_sales_lines_v`
  - parsed voucher date, quantity, price, taxable amount, net amount, return flag.
- `busy_customer_sales_summary_mv`
  - customer revenue, invoice count, last sale date, top items, top groups.
- `busy_item_velocity_mv`
  - SKU monthly velocity and customer count.
- `busy_salesperson_performance_mv`
  - salesperson revenue, vouchers, active customers, overdue exposure.

## Suggested Build Sequence

1. Add normalized SQL views for `customers`, `customersos`, `ledger`, and `sales`.
2. Add `busy_code` bridge into existing customer/order flows.
3. Build Customer 360:
   - profile
   - outstanding
   - ledger summary
   - last sale/payment
   - top SKUs
4. Replace placeholder "Share ledger on WhatsApp" with a real generated statement.
5. Add billing credit warning before approval.
6. Add sales reorder suggestions from historical sales.
7. Add admin sync health dashboard.

## Security Note

Supabase advisor previously reported Row Level Security disabled on these public finance/customer tables and several operational tables. Because the frontend uses Supabase client libraries, raw finance tables should not be broadly exposed.

Recommended direction:

- Keep raw Busy tables service-role/write-only where possible.
- Expose only controlled views/RPCs to the browser.
- Add RLS policies per role: sales, billing, admin, sync worker.
- Treat ledger/outstanding data as sensitive.

## Bottom Line

The Busy synced data is live and valuable. The fastest high-impact path is:

1. Normalize the raw Busy tables.
2. Use `customers.busy_code` as the customer spine.
3. Build Customer 360 and credit checks first.
4. Then build reorder intelligence and sales dashboards from `sales`.

