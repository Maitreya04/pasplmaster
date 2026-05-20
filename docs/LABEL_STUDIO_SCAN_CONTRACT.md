# Label Studio and warehouse scan contract

This document is the operational contract for PASPL-printed labels and how scanners resolve them during picking (`PickPage`) and verification (`Pick Scan Lab`). It aligns with [`docs/MANUFACTURER_BARCODE_MAPPING_FINDINGS.md`](./MANUFACTURER_BARCODE_MAPPING_FINDINGS.md) for OEM barcode storage in `item_barcodes`. Receiving job flows (`/admin/receiving`) follow pinned decisions in [`docs/DECISIONS_LABEL_STUDIO_RECEIVING.md`](./DECISIONS_LABEL_STUDIO_RECEIVING.md).

## Adopted default (internal-first)

**Primary symbol for PASPL-printed bin or rack labels:**

- Operators scan the **ITEM** QR printed by Label Studio. That QR encodes the **pick code**: `alias1` if set, otherwise `alias` (Busy catalog fields).

**Why:**

- Matches what Label Studio renders today (`ITEM` strip on the pack strip and rack presets).
- No extra per-SKU printing configuration required.

**BIN / rack preset rule:** Printed BIN labels intentionally show **location + SKU + forward pick qty (FPQ)** from `item_pack_definitions.bin_forward_pick_qty` only — never live quantities. Live stock remains in **`bin_inventory`** and updates via warehouse events (cycle count, receiving `bin_stock` scans, picks).

## Receiving jobs — envelope and pack identity

Receiving jobs expose a human-readable **`PJ-XXXX`** `job_public_id` and an **`ENV-PJ-XXXX`** envelope / cover-sheet code (`envelope_code`) for quick lookup and QR cover sheets. Operational detail: scanners that only read **JOB**/`ENV` payloads identify the logistics batch; SKU identity still comes from **ITEM**/`PASPL-PACK` tiers or validated OEM mappings.

Pack strips on masters and inners use **`PASPL-PACK:{busy}:{inner|outer}`** as the **primary scannable QR** (same string as Label Studio). Receiving batch-print stickers also include an **ITEM** strip (`alias1` or `alias` pick code). **`license_plates.lpn_code`** is stored for WMS traceability and may appear as human-readable text on the sticker; it is not the operator-facing scan target for pick/count.

## Unified payload contract (receiving + picking)

| Payload | Meaning | Operator scans for |
|---------|---------|-------------------|
| `PASPL-PACK:{busy}:inner\|outer` | One physical inner or master carton of SKU | Pick, cycle count, receiving putaway (when implemented), carton check |
| ITEM = raw `alias1` or `alias` | Catalog pick identity | Pick, cycle count, putaway each-scan |
| BIN JSON `{type:BIN,rack,busy_code,sku}` | Shelf slot + expected SKU | Pick rack gate, cycle count slot, putaway bin confirm |
| LPN `LP-…` / `PASPL-LPN:…` | WMS carton instance (DB row) | Putaway inner resolve; optional secondary |
| OEM / mapped barcode | Manufacturer key → `item_barcodes` | Pick, putaway each, after Barcode Mapping |

**Identity source:** `items` (alias1, alias, busy_code) + `item_pack_definitions` (EA per inner/outer) + `item_barcodes` (OEM).

**Quantity on shelf:** `bin_inventory_layers` (EA, MRP, lot) when putaway or promotion has run; **ERP** (`items.stock_qty` / `stock_locationwise`) for sell-side availability when not yet binned.

**Un-binned stock:** default putaway destination **`STG-DEFAULT`** (`STG-*` prefix, same convention as `OVF-*` overflow). Bin onboarding can promote layers from STAGING to a real rack bin.

Parser entry point: `src/lib/scanner/qrPayload.ts` (`classifyScanPayload`, `parsePackPickPayload`, `parseRackPayload`).

## Each-tier labels — identical ITEM QR payloads

**Label-plan receiving:** operator sets **piece label count** on the job line; bulk print repeats the same ITEM QR **N times** (not serialized).

**Putaway break:** each-label sheets may also generate after **`inner_break`** for remainder on that inner LPN.

If `item_pack_definitions.sell_unit === 'PACK'`, omit each-tier generation altogether.

See `receive_mode === 'loose'`: skips pack tiers and posts quantity via `submit_bin_count` into the chosen BIN instead of carton labels.

## Secondary symbols (still valid during picking)

- **PASPL-PACK `{busy}:{inner|outer}`** QR on inner/master blocks — resolves pack quantity scans.
- **OEM carton barcodes** (e.g. Varroc SAP-style `K…` payloads after parsing in `parseManufacturerBarcode`) — resolve when keyed in **`item_barcodes`** via Barcode Mapping, even when the sticker text differs from `alias1`/alias.

## Logistics / courier barcodes — non-identity

Shipping labels, aggregator parcel IDs, carton routing stickers, generic 3PL / transporter stamps, etc. MUST **never** be stored in `item_barcodes` as product identity unless the payload is genuinely a supplier part / OEM key that Mapping has explicitly documented. Operators treat unexplained logistics scans as **no SKU match**, not ambiguous multi-match — add or correct mappings only via Barcode Mapping when the barcode is verified OEM.

## Varroc SAP (OEM-first path)

Use **Barcode Mapping** (`/admin/barcode-mapping`) to map Varroc OEM scan keys → Busy `sku_busy_code`. That path is distinct from reading the PASPL-printed ITEM QR.

- **If Ops must physically scan SAP on the PASPL-printed sticker** — the ITEM QR must encode the **same normalized key** scanners will read (typically by setting `alias1` to that SAP-derived key or a future warehouse-QR-encoding option).

- **Recommended for mixed operations:** Train **bins** = scan PASPL ITEM QR; train **receiving / carton check** = scan OEM code after mapping exists in `item_barcodes`.

## Supplier resolution at print time (receiving)

`busy_code` lines resolve supplier display codes via **`item_barcodes`** with manufacturer tie-break and visible **`UNMAPPED`** / **`MULTIPLE`** statuses. **`INVOICE`-triggered** jobs must block until status is cleanly **`MAPPED`** (Phase 2 UI); **`MANUAL_ARRIVAL`** may proceed with **`UNMAPPED`** showing on labels.

## Verification checklist (before rollout)

1. Print a pack strip from Label Studio for one SKU after choosing brand/group filters.
2. Open **Pick Scan Lab** (`/admin/pick-scan-lab`): use **Verify**, set target qty, tap **Test Scan** for that product.
3. Scan **ITEM**, then **inner** and **master** QRs — expect `matchesPickItem` and sane quantity deltas.
4. For Varroc-heavy SKUs without SAP in `alias1`, scan an **OEM sample** once to confirm `item_barcodes` resolves to the intended SKU before relying on carton scans on the floor.
5. For receiving: confirm a **PJ/ENV** job prints **master + inner only** after ratio confirmation; breaking an inner pack yields a **repeatable each sheet** where every cell matches (no unique piece serial).

## Implementation references

- Label QR payloads & BIN FPQ rendering: `src/pages/admin/LabelStudioPage.tsx`
- Receiving wizard + gate/sort label prints: `src/pages/admin/receiving/ReceivingJobDetailPage.tsx`; RPCs `receiving_print_master_labels` / `receiving_print_inner_labels` (migration `064_receiving_split_gate_sort_labels.sql`)
- Supplier resolve (`UNMAPPED` / `MAPPED`): `src/lib/labelStudio/resolveSupplier.ts`
- Scan resolution order: `src/lib/scanner/resolvePickedScan.ts`, `src/stores/itemScanIndex.ts`
- OEM parsing (Varroc paths): `src/lib/scanner/barcodeParser.ts`
