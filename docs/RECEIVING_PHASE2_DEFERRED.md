# Receiving — Phase 2 status

Phase 2 (MRP bin layers, break putaway, picker shelf, FIFO consumption) is **implemented** in app + migration `065_bin_inventory_layers.sql`.

## Shipped in Phase 2

- **`bin_inventory_layers`** — MRP batch rows per BIN/SKU (quantities in eaches); merge rule on `(bin_id, sku_busy_code, mrp_per_ea, lot_no, receiving_job_line_id)`.
- **`bin_inventory` rollup** — `loose_ea_qty` sums layers for that slot; `inner_packs` forced to `0` for layer-driven slots (legacy rows unchanged until touched).
- **`bin_layer_pick_events`** — audit when picks consume layers; supports FIFO skip + `override_reason`.
- **Receiving RPCs** — `receiving_resolve_lp_scan`, `receiving_putaway_inner_whole`, `receiving_putaway_to_bin_bulk`, `receiving_putaway_to_bin_each_scan`; `receiving_apply_inner_break` now requires **MRP/ea** and sets `receiving_putaway_ea_remaining`.
- **Picker RPCs** — `wms_get_bin_picker_shelf`, `wms_consume_bin_layer_for_pick` (FIFO default, optional preferred layer + override).
- **Putaway UI** — scan-first wizard on `ReceivingJobDetailPage` (`PutawayScanWizard`).
- **Pick UI** — shelf card after rack verify; FIFO batch list; tap batch to prefer non-head layer (reason required via bottom sheet).
- **MRP gate** — putaway RPCs error until `mrp_per_ea` is set (Verification section).

## Still deferred (Phase 3+)

### Challan / cost

- Auto **cost per each** from challan line value ÷ total eaches when the document has **per-SKU line amounts**.
- When the challan is a **single total** across SKUs, require manual purchase entry or allocation rules — not implemented.
- Optional fields on `receiving_job_lines` or linked **supplier_challan_lines** for declared value, tax, and match status.

### Purchase & PO verification

- First-class **`purchase_orders`**, **`purchase_order_lines`**, and optional **GRN** linkage to `receiving_jobs` / lines.
- Phase 2 still uses **`po_verification_status`** + note on the line for human checklist — not a three-way match.

### Other

- **Cycle count UI** reconciling per-layer counts (cycle count can keep using aggregate `bin_inventory` until then).
- **Master LPN `pack_qty` correction** after sort mismatch (reprint/correction workflow).
- **Pick undo** restoring consumed layer stock (not implemented).

## Migration reference

- Phase 1 split prints: `064_receiving_split_gate_sort_labels.sql`.
- Phase 2 bin layers + putaway + picker shelf: `065_bin_inventory_layers.sql`.
