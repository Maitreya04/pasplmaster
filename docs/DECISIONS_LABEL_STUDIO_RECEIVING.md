# Label Studio / Receiving — pinned decisions

Source: full context alignment plan. Do not confuse with Cursor plan edits.

## D1 — Label instances

**Extend `license_plates`** with nullable `receiving_*` columns for job linkage, lot, tier, receiving state machine, invalidation-on-reprint. Avoid a parallel `receiving_label_instances` table unless LPN picker flow conflicts (mitigate by null `receiving_job_line_id` for legacy LPNs).

## D2 — `sell_unit` vs `items.selling_unit`

- **`items.selling_unit`** (`piece` | `packet` | `box`) — UoM display preference for picking/onboarding (see migration `050_uom_hierarchy_mapper.sql`).
- **`item_pack_definitions.sell_unit`** (`EACH` | `PACK` | `BOTH`) — PASPL-owned; controls whether each labels can generate on inner break and pick preference rules (future).

## D3 — Overflow locations

Treat any `bin_id` matching normalized `OVF-*` as overflow; validation optional Phase 2.

## D4 — Each labels

Identical ITEM QR stickers per SKU/line/lot (not serialized per piece). May print at **receiving** when `each_labels_count > 0` on the job line (label-plan flow), or after **inner_break** in putaway for remainder pieces.

## D5 / D6 — Serials and scan identity

- **Operator-facing QR (large):** `PASPL-PACK:{busy}:{inner|outer}` — same as Label Studio; used for pick, count, and receiving putaway.
- **ITEM strip:** `alias1` (else `alias`) — same as Label Studio pack strip.
- **WMS instance:** `license_plates.lpn_code` — globally unique for inner packs; master codes may be job-sequence-local (`M-…`). Printed as text for trace; putaway may also resolve by PASPL-PACK when one open inner exists on the job line.
- Receiving print must not use LPN-only QR as the only scannable symbol if pick/count training is on PASPL-PACK.

## D7 — STAGING bin (un-binned SKUs)

- Reserve **`STG-*`** `bin_id` prefix (mirrors `OVF-*` overflow).
- Seed **`STG-DEFAULT`** as default putaway when `items.rack_no` is unset.
- Picker availability for un-binned SKUs remains **ERP**; floor scan confirms carton via PASPL-PACK or ITEM.
- Bin onboarding may **promote** layers from STAGING to a real bin via `wms_apply_bin_layer_delta`.

## UNMAPPED + trigger

- **INVOICE** (Phase 2): block submit until Barcode Mapper has mapping (`supplier_code_status = MAPPED`).
- **MANUAL_ARRIVAL** / **PO** (Phase 1 PO stub): allow UNMAPPED; label shows `SUPPLIER CODE: UNMAPPED`.

## Gate vs sort label timing (Phase 1 receiving UI)

- **Gate**: `receiving_print_master_labels` creates **outer** `license_plates` only (`master_labels_printed_at`).
- **Sort**: after ratio save, `receiving_print_inner_labels` creates **inner** plates (`inner_labels_printed_at`, `labels_printed_at` set when inners complete).
- Deferred inventory / MRP layers: see [`docs/RECEIVING_PHASE2_DEFERRED.md`](./RECEIVING_PHASE2_DEFERRED.md).

## Reprint

Before printing replacement inner label, set `license_plates.invalidated_at` on the superseded row; new row links `reprint_supersedes_lp_id` (or store in metadata).
