# Purchase and receiving integration

## Overview

- **Purchase orders** (`purchase_orders`, `purchase_order_lines`) hold supplier PO lines with `qty_ordered`, optional **sales demand hints** (`suggested_qty_from_demand` from open `order_items.qty_po`), and rollup **`qty_received`** after dock completion.
- **Supplier invoices** (`supplier_invoices`, `supplier_invoice_lines`) store OCR-reviewed PDF extraction and link lines to PO lines where matched.
- **Receiving jobs** gain optional `purchase_order_id` and `supplier_invoice_id`. RPCs seed loose expectation lines and set `triggered_by` to `PO` or `INVOICE`.

## Excel PO template

Detected as **Purchase order** when the sheet has **Part no** (or Busy code / Item code), **Description**, and **Qty** (or **ORDER** / Qty to buy / Order qty), and **no Sales Price** column (to avoid clashing with the price-list importer).

Supplier **Part no** values should live in **`items.alias`**, **`items.alias1`**, or (when the name is a single code token) **`items.name`**. Each matched row still needs a valid **`items.busy_code`**. Unmatched parts or items missing busy code show a warning in preview.

Catalog lookup paginates the full **`items`** table (PostgREST returns only 1000 rows per request by default).

If Excel **qty is 0**, creation uses aggregated open sales PO demand for that SKU when available.

## Invoice PDF OCR

### PO-linked invoice (existing PO)

1. Upload PDF on `/purchase/po/:id/invoice` (first **8 pages** rendered to JPEG).
2. **Gemini** (`VITE_GEMINI_API_KEY`) returns invoice header + lines: **qty to receive**, **supplier billing rate** (`rate_per_ea`, pre-GST — not MRP), plus `part_no` / `description`.
3. Lines auto-map to **`items.busy_code`** (numeric part), then **`items.alias`** / **`items.alias1`** (normalized + alphanumeric-only keys). Long OEM codes may **fuzzy-match** (≤2–3 edits) only when exactly one catalog row wins — verify when you see a yellow hint. Description tokens are tried if the part cell does not match.
4. User edits rows, fixes **busy_code** / **PO line id**, then **Save invoice draft**.
5. **Start receiving job** calls `create_receiving_job_from_invoice` → navigates to Admin → Receiving.

### Invoice-first (no PO yet)

1. From Purchase home, **New from Invoice PDF** → `/purchase/invoice/new`.
2. Enter **supplier name**, upload PDF, review OCR lines, set **busy code** on every line.
3. **Save and create PO** inserts `purchase_orders` with `source = invoice_pdf`, `status = sent`, matching PO lines, supplier invoice + lines (linked to PO lines), then **Start receiving job** as above.

## Warehouse entry (receiving hub)

- **`/admin/receiving`** — **Warehouse** hub lists **sent POs without a receiving job** and **in-progress jobs**.
- **Truck at dock — start receiving** on a PO card calls `create_receiving_job_from_purchase_order` → `/admin/receiving/:id?step=truck`.
- Job detail uses a **stepper**: Truck arrives → Count + labels (GRN) → MRP check → Putaway (`?step=` in URL).
- **Dock confirm:** `receiving_confirm_dock_arrival` sets `receiving_jobs.dock_arrived_at` (migration `071`).

## Receiving behaviour

- **GRN line UI:** master cartons (0 allowed) → collapsible inner packs → piece stickers; counts are **warehouse-entered**, not derived from PO.
- **Receive mode** is derived: `master > 0` → structured; else inner_only; bulk-only → loose.
- **Stickers:** PASPL-PACK + ITEM QRs match pick floor; see [`LABEL_STUDIO_SCAN_CONTRACT.md`](./LABEL_STUDIO_SCAN_CONTRACT.md).
- **Un-binned SKUs:** putaway defaults to `STG-DEFAULT`; picking uses ERP availability and scan-confirms carton QR.
- Invoice/PO jobs seed **structured** lines (per-SKU gate + sort). `po_qty_expected_ea` holds ordered/billed qty for reference only; operators confirm `total_ea` via ratio, not from PO.
- **`purchase_order_line_id`** on `receiving_job_lines` links rollup: `receiving_try_roll_up_po_for_job_line` increments `purchase_order_lines.qty_received` once putaway is complete (pack lines) or loose ratio + BIN is saved.
- **INVOICE** jobs block master/inner label printing until supplier barcode is **MAPPED** (`shouldBlockJobOnUnmapped`).
- Job **`receive_status`** (SHORT/MATCHED/OVER) compares summed invoice `qty_billed` to summed receiving line `total_ea` when `supplier_invoice_id` is set.

## Migrations

- `066_purchase_orders.sql` — purchase + invoice tables, receiving FKs, RPCs, rollup helpers.
- `067_purchase_source_invoice_pdf.sql` — allow `purchase_orders.source = invoice_pdf`.
- `068_staging_bin_and_pack_scan.sql` — PASPL-PACK putaway resolve, `wms_promote_staging_layer`.
- `071_receiving_dock_workflow.sql` — `dock_arrived_at`, `dock_note`, `receiving_confirm_dock_arrival`.
