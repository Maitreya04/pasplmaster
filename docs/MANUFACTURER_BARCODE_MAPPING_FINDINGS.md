# Manufacturer Barcode Mapping Findings

Generated: 2026-05-14, Asia/Kolkata.

This report documents how manufacturer barcode mappings currently work in PASPL Master, where they are stored, how they are verified during picking, and the current live production mapping snapshot read from Supabase.

## Executive Summary

- Storage table: `public.item_barcodes`.
- Current live rows: 80 barcode rows.
- Current live SKU coverage: 76 mapped SKUs out of 11,785 active SKUs, or 0.6%.
- Current live unmapped SKUs: 11,709 active SKUs.
- Current live rack coverage: 588 tracked racks/bins, 6 complete, 11 in progress, 571 not started.
- Current rule: one `barcode_key` can map to only one SKU, but one SKU can have multiple manufacturer barcodes.
- Current runtime lookup order: `alias1` -> `alias` -> PASPL item code -> manufacturer `item_barcodes`.
- Current conflict rows: 0 rows have `had_conflict = true`.
- Runtime normalized key collisions: 0 collisions found across the current 80 rows after app-side scan normalization.

## Where It Is Stored

Manufacturer barcode mappings are stored in Supabase table `public.item_barcodes`, originally introduced in `supabase/migrations/029_item_barcodes.sql`.

Main columns:

| Column | Meaning |
|---|---|
| `barcode_key` | The canonical key the system looks up after parsing the manufacturer scan. Unique at the database level. |
| `barcode_raw` | The original scanned/manual barcode payload. |
| `sku_busy_code` | Busy SKU code mapped to this barcode. |
| `match_strategy` | Parser strategy used to derive `barcode_key`, such as `exact` or `slash_separated`. |
| `mapped_by_user_id`, `mapped_by_name` | User attribution where available. |
| `mapped_at` | Timestamp when the row was saved/updated. |
| `bin_id` | Bin/rack context used during mapping. |
| `manufacturer` | Derived from selected SKU `mainGroup` or `parentGroup` in the UI. |
| `had_conflict`, `conflict_note` | Set when a barcode is force-overridden from one SKU to another. |

Relevant implementation:

- Table and initial RPC: `supabase/migrations/029_item_barcodes.sql`.
- Current multi-barcode-per-SKU rule: `supabase/migrations/032_allow_multiple_barcodes_per_sku.sql`.
- Client RPC wrapper: `src/lib/barcodeMapping.ts`.
- Live scanner index: `src/stores/itemScanIndex.ts`.

## Current Database Rules

The database enforces uniqueness on the stored `barcode_key`. If the same key is saved again for the same SKU, the RPC returns `already_mapped`. If the same key is saved for a different SKU, the RPC returns `conflict` unless `force = true`.

Migration `032_allow_multiple_barcodes_per_sku.sql` changed the behavior from one barcode per SKU to multiple barcodes per SKU. The current intended invariant is:

- One barcode key -> one SKU.
- One SKU -> many barcode keys allowed.

This matters for batches, manufacturers, and package-size variants.

## Mapping Creation Pipeline

The UI lives at Admin/Picking Barcode Mapping:

- Admin route: `/admin/barcode-mapping`
- Picking route: `/picking/barcode-mapping`

There are two supported flows:

1. Bin first
   - Scan/enter rack/bin QR.
   - Load SKU candidates from `bin_inventory`.
   - If no WMS bin rows exist, fall back to `items.rack_no`.
   - Choose SKU if multiple are present.
   - Scan or manually enter manufacturer barcode.
   - Parse barcode and save mapping.

2. Scan first
   - Scan or type manufacturer barcode.
   - Parser extracts a likely part key.
   - UI auto-suggests a SKU via scan index or search.
   - User confirms SKU.
   - Save mapping.

On save, `src/pages/admin/BarcodeMappingPage.tsx` sends:

- `barcodeRaw = pendingBarcode.raw`
- `barcodeKey = pendingBarcode.key`
- `matchStrategy = pendingBarcode.strategy`
- `skuBusyCode = selectedSku.skuBusyCode`
- `binId = currentBinId`
- `manufacturer = selectedSku.mainGroup ?? selectedSku.parentGroup`
- user attribution

The save call goes through `saveBarcodeMapping()` in `src/lib/barcodeMapping.ts`, which calls Supabase RPC `save_barcode_mapping`.

After successful save, the page invalidates coverage queries and patches the in-memory scan index with `patchBarcodeMappingEntry()` so the same browser session can immediately verify the newly mapped barcode.

## Barcode Parsing / Normalization

Manufacturer scans are parsed by `parseManufacturerBarcode()` in `src/lib/scanner/barcodeParser.ts`.

Supported parser behavior:

| Strategy | What it handles |
|---|---|
| `exact` | Plain code with no transformation. |
| `slash_separated` | Payloads like `2125599K01/SEAL INNER/56.00/1.000 N/40169330`; stores the first slash segment as the key. |
| `structured_field` | Multi-line or labeled payloads with fields like `PART NUMBER`, `ITEM CODE`, `MATERIAL CODE`, `SKU`, `CAT NO`. |
| `prefix_hyphen` | Codes with serial/batch suffix after a hyphen, e.g. `1310C03801-17102231402`. |
| `prefix_space` | Codes with serial/batch suffix after a space. |
| `manual` | Allowed by DB constraint/RPC, but not currently dominant in live data. |

Scan lookup normalization is separate: `normalizeScanCode()` uppercases and strips everything except `A-Z` and `0-9`. This is used both for SKU aliases and stored barcode keys in the live scanner index.

## Verification Pipeline

During picking, `LiveQrScanner` decodes camera input and classifies it through `classifyScanPayload()`.

Verification flow:

1. Camera decodes a QR/barcode value using the browser `BarcodeDetector` path where available, or the WASM worker fallback.
2. `classifyScanPayload()` separates rack, pack, LPN, and SKU/manufacturer payloads.
3. Manufacturer/SKU payloads are expanded into normalized lookup candidates with `collectQrLookupCandidates()`.
4. `resolveScannedCatalogItem()` checks candidates against:
   - `alias1Map`
   - `aliasMap`
   - `itemCodeMap`
   - `barcodeMappingMap`
5. If the resolved item id matches the expected pick item id, the scan is accepted.
6. If it resolves to a different item, the UI rejects it with a mismatch message and retries.

The important point: `item_barcodes` is loaded into an in-memory `barcodeMappingMap` at scanner startup. Each DB `barcode_key` is normalized with `normalizeScanCode()` before entering that map.

## Current Live Coverage

| Metric | Value |
|---|---:|
| Total active SKUs | 11,785 |
| Mapped SKUs | 76 |
| Unmapped SKUs | 11,709 |
| SKU coverage | 0.6% |
| Barcode rows | 80 |
| Distinct mapped SKUs | 76 |
| Racks/bins tracked | 588 |
| Racks complete | 6 |
| Racks in progress | 11 |
| Racks not started | 571 |
| Rows with conflict override | 0 |
| Runtime normalized key collisions | 0 |

## Current Live Distribution

By manufacturer:

| Manufacturer | Rows |
|---|---:|
| VARROC | 74 |
| TAFE | 5 |
| USHA | 1 |

By match strategy:

| Strategy | Rows |
|---|---:|
| `exact` | 77 |
| `slash_separated` | 3 |

SKUs with multiple barcode rows:

| Busy SKU | Item | Barcode row count |
|---:|---|---:|
| 13382 | TE OIL SEAL STEERING SEAL INNER | 2 |
| 50912 | VE STRTER MOTOR RE 350 CC GREY SS | 2 |
| 50934 | VE STRTER MOTOR I SMART 110/SPLENDER 110 | 2 |
| 58012 | TE NUT DRIVING PINION LOCK | 2 |

## Data Quality Notes

1. There are 3 legacy-style rows where the key stores the full raw payload instead of the newer canonical part key:
   - `2125599K01/SEAL INNER/56.00/1.000 N/40169330`
   - `http://vrst.in/bt/$,[a@!EASM7W!K3531369000001`
   - `1310C03801/NUT - DRIVING PINION L/209.00/1.000 N/73181600`

2. These legacy rows are not immediately broken because lookup candidates include both parsed candidates and the original raw value. However, they are less clean than the current canonical strategy and can create duplicate rows for the same physical barcode family.

3. Current live data has no runtime-normalized key collisions. That is good because the scanner lookup map is normalized more aggressively than the database unique constraint.

4. The database unique constraint is on raw `barcode_key`, not the runtime-normalized key. A future migration or RPC guard could prevent normalized collisions at storage time.

5. Coverage is still very early: 0.6% of active SKUs mapped.

## Full Current Mapping Table

| # | Barcode key | Busy SKU | Item | Mfr | Bin | Strategy | Mapped at IST | By |
|---:|---|---:|---|---|---|---|---|---|
| 1 | EC7TFO | 50609 | VE R R WITH CAPACITOR XCED 125 | VARROC | GGR-12C | exact | 14/05/2026, 12:59 | Abhishek |
| 2 | E8BYBN | 50550 | VE R R DC WITH CAPACITOR DSVR 125 ST | VARROC | GGR-12C | exact | 14/05/2026, 12:58 | Abhishek |
| 3 | ED9PRE | 50548 | VE R R WITH CAPACITOR DSVR 100M 125M | VARROC | GGR-12C | exact | 14/05/2026, 12:57 | Abhishek |
| 4 | K3440041000001 | 50598 | VE R R WITH CAPACITOR PLSR 135 XCED 135 | VARROC | GGR-12C | exact | 14/05/2026, 12:57 | Abhishek |
| 5 | BLBY3G | 50956 | VE CARBON BRUSH TERMINALS CBZEE SHN UNIC | VARROC | GGR-16D | exact | 14/05/2026, 12:55 | Dharmendra |
| 6 | K3540490000001 | 51010 | VE CARBON BRUSH TERMINAL PASION PRO BS6 | VARROC | GGR-17D | exact | 14/05/2026, 12:54 | Picker |
| 7 | K3440064000001 | 50591 | VE R R PLTN 100 CC SS | VARROC | GGR-11C | exact | 14/05/2026, 12:52 | Picker |
| 8 | 08279325 | 50573 | VE R R PLSR 180 ES KS K2 | VARROC | GGR-11C | exact | 14/05/2026, 12:52 | Picker |
| 9 | ED9RUP | 50574 | VE R R WITH CAPACITOR PLSR UG4 DC | VARROC | GGR-11C | exact | 14/05/2026, 12:51 | Picker |
| 10 | E4LPC6 | 50526 | VE R R SUZKI AXCESS 125CC SVISH | VARROC | GGR-11D | exact | 14/05/2026, 12:50 | Abhishek |
| 11 | E5Z84N | 48195 | VE R R WITH CAPACITOR DIS.100/PLATINA UG | VARROC | GGR-11C | exact | 14/05/2026, 12:50 | Picker |
| 12 | ED9PUZ | 50549 | VE R R AC DC WITH CAPACITOR DSVR 100 4G | VARROC | GGR-11D | exact | 14/05/2026, 12:49 | Abhishek |
| 13 | ED9S25 | 50590 | VE R R PLTN 100 NEW | VARROC | GGR-11D | exact | 14/05/2026, 12:49 | Abhishek |
| 14 | CYMT6R | 50539 | VE R R BOXR CT | VARROC | GGR-11D | exact | 14/05/2026, 12:48 | Abhishek |
| 15 | 0159310538922405 | 51041 | VE FLYWHEEL BSC XCED125 135CC WITH GOLI | VARROC | GGR-7F | exact | 14/05/2026, 12:48 | Picker |
| 16 | K3530898000001 | 50600 | VE R R STR CITI 5 PIN | VARROC | GGR-11D | exact | 14/05/2026, 12:48 | Abhishek |
| 17 | 0143570097027006 | 51000 | VE FLYWHEEL BSC PLSR 150 180 WITH GOLI K | VARROC | GGR-7F | exact | 14/05/2026, 12:47 | Picker |
| 18 | ED9PM4 | 50541 | VE R R C 100 | VARROC | GGR-11D | exact | 14/05/2026, 12:47 | Abhishek |
| 19 | K3530899000001 | 50606 | VE R R VCTR 5 PIN | VARROC | GGR-11D | exact | 14/05/2026, 12:47 | Abhishek |
| 20 | 0152249147833949 | 50552 | VE R R 3 PHASE RE 350 CC THNDER BIRD | VARROC | GGR-5B | exact | 14/05/2026, 12:45 | Picker |
| 21 | 0157129911814822 | 50551 | VE R R SINGLE PHASE RE 350 CC ELCTRA | VARROC | GGR-5B | exact | 14/05/2026, 12:44 | Picker |
| 22 | AKZK54 | 50554 | VE R R 3 PHASE RE 350 CC ELCTRA CLASIC | VARROC | GGR-5B | exact | 14/05/2026, 12:44 | Picker |
| 23 | E3B512 | 50556 | VE R R RE 350 CC | VARROC | GGR-5B | exact | 14/05/2026, 12:43 | Picker |
| 24 | K3531476000001 | 50657 | VE RELAY STRTER TVX SCOTY ALL MODEL | VARROC | GGR-14F | exact | 14/05/2026, 12:43 | Dharmendra |
| 25 | E1ISQW | 50621 | VE RELAY STRTER TVX APACHI | VARROC | GGR-14F | exact | 14/05/2026, 12:43 | Dharmendra |
| 26 | AZ6BK4 | 50673 | VE RELAY SELF AUXILIARY BLUE R15 BS4 BS6 | VARROC | GGR-14F | exact | 14/05/2026, 12:42 | Dharmendra |
| 27 | K3533194000001 | 50610 | VE R R TVX XL 100 2015 TO 2020 BS3 BS4 | VARROC | GGR-11E | exact | 14/05/2026, 12:41 | Abhishek |
| 28 | E1B38G | 50928 | VE STRTER MOTOR PLSR 150 AS | VARROC | GGR-2G | exact | 14/05/2026, 12:40 | Picker |
| 29 | 0120796736401160 | 50927 | VE STRTER MOTOR PLSR 200 NS | VARROC | GGR-2G | exact | 14/05/2026, 12:40 | Picker |
| 30 | E4PSD7 | 50946 | VE STRTER MOTOR YAMHA F Z V1 V2 V3 F ZS | VARROC | GGR-2G | exact | 14/05/2026, 12:39 | Picker |
| 31 | E49UD2 | 50543 | VE R R CLBR 115 | VARROC | GGR-11E | exact | 14/05/2026, 12:37 | Abhishek |
| 32 | E3JZQB | 50643 | VE RELAY HEADLAMP BAJJ PLSR 4PIN | VARROC | GGR-14F | exact | 14/05/2026, 12:33 | Dharmendra |
| 33 | E6Z5NM | 50562 | VE R R JUPITOR WIGO PHENIX 125 ZIST VCTR | VARROC | GGR-11E | exact | 14/05/2026, 12:33 | Abhishek |
| 34 | 0155718437368869 | 50912 | VE STRTER MOTOR RE 350 CC GREY SS | VARROC | GGR-1G | exact | 14/05/2026, 12:33 | Picker |
| 35 | 0121158439532203 | 50939 | VE STRTER MOTOR SUZKI GIXER | VARROC | GGR-1G | exact | 14/05/2026, 12:32 | Picker |
| 36 | ABO1JX | 50622 | VE RELAY STRTER TVX APACHI OLD MODEL | VARROC | GGR-14F | exact | 14/05/2026, 12:31 | Dharmendra |
| 37 | BNIWV0 | 50604 | VE R R TVX VCTR GL | VARROC | GGR-11E | exact | 14/05/2026, 12:31 | Abhishek |
| 38 | K3530658000001 | 50668 | VE RELAY HORN 12V UNIVERSAL 4 PIN | VARROC | GGR-14F | exact | 14/05/2026, 12:30 | Dharmendra |
| 39 | E9814E | 50569 | VE R R NTRQ JUPITOR STR CITI BS4 O.E TYP | VARROC | GGR-11E | exact | 14/05/2026, 12:30 | Abhishek |
| 40 | E6JWXX | 50637 | VE RELAY FUEL PUMP HNDA ALL MODEL 1KVZ63 | VARROC | GGR-14F | exact | 14/05/2026, 12:30 | Dharmendra |
| 41 | D0NT1R | 50605 | VE R R TVX VCTR 4 PIN STR CITI | VARROC | GGR-11E | exact | 14/05/2026, 12:26 | Abhishek |
| 42 | D2IE0C | 50611 | VE R R XL 100 2015 TO 2020 BS3 BS4 AL CA | VARROC | GGR-11E | exact | 14/05/2026, 12:25 | Abhishek |
| 43 | K3531864000001 | 51002 | VE BRUSH BOX ASSY PLTN 100 CC SS | VARROC | GGR-16E | exact | 14/05/2026, 12:16 | Abhishek |
| 44 | K3532684000025 | 50981 | VE CARBON BRUSH TERMINAL JUPITOR LUKAS M | VARROC | GGR-16E | exact | 14/05/2026, 12:13 | Abhishek |
| 45 | E11NOV | 51004 | VE CARBON BRUSH TERMINAL PLTN DSVR | VARROC | GGR-16E | exact | 14/05/2026, 12:12 | Abhishek |
| 46 | KV450002380001 | 50980 | VE CARBON KIT JUPITOR LUKAS MAKE | VARROC | GGR-16E | exact | 14/05/2026, 12:12 | Abhishek |
| 47 | E6QUI7 | 50933 | VE STRTER MOTOR I-SMRT T TYPE BSVI | VARROC | GGR-2G | exact | 13/05/2026, 17:33 |  |
| 48 | E6T2NX | 50915 | VE STRTER MOTOR HAYAATE | VARROC | GGR-2G | exact | 13/05/2026, 17:32 |  |
| 49 | E7UI6F | 50914 | VE STRTER MOTOR YAMHA FASCINO REY | VARROC | GGR-2G | exact | 13/05/2026, 17:31 |  |
| 50 | BCM3MG | 50932 | VE STRTER MOTOR PASION PRO BS6 | VARROC | GGR-2G | exact | 13/05/2026, 17:30 |  |
| 51 | EB32LJ | 50918 | VE STRTER MOTOR AXCESS NM LATS | VARROC | GGR-2G | exact | 13/05/2026, 17:30 |  |
| 52 | E6OEXJ | 50940 | VE STRTER MOTOR TWSTER D YUGA NIO CD 110 | VARROC | GGR-2F | exact | 13/05/2026, 17:28 |  |
| 53 | K3450099000001 | 50905 | VE STRTER MOTOR BM150 C125 BSIV | VARROC | GGR-2F | exact | 13/05/2026, 17:28 |  |
| 54 | EDF58L | 50921 | VE STRTER MOTOR PLEASUR | VARROC | GGR-2E | exact | 13/05/2026, 17:26 |  |
| 55 | K3532778000001 | 50938 | VE STRTER MOTOR TVX STR CITI OLD MODEL | VARROC | GGR-2E | exact | 13/05/2026, 17:25 |  |
| 56 | D3HSK6 | 50901 | VE STRTER MOTOR AXCESS SVISH 125 | VARROC | GGR-2E | exact | 13/05/2026, 17:24 |  |
| 57 | CUHIY7 | 50931 | VE STRTER MOTOR PASION PRO I SMART HF DL | VARROC | GGR-2E | exact | 13/05/2026, 17:24 |  |
| 58 | ECXB0V | 50903 | VE STRTER MOTOR ACTVA | VARROC | GGR-2E | exact | 13/05/2026, 17:24 |  |
| 59 | ED1A50 | 50912 | VE STRTER MOTOR RE 350 CC GREY SS | VARROC | GGR-1G | exact | 13/05/2026, 17:22 |  |
| 60 | D35XKP | 50919 | VE STRTER MOTOR MAHINDR DRO RODIO FLYT | VARROC | GGR-1G | exact | 13/05/2026, 17:22 |  |
| 61 | E1VVNZ | 50941 | VE STRTER MOTOR UNICON 160 HONET 160 | VARROC | GGR-1F | exact | 13/05/2026, 17:18 |  |
| 62 | D329K3 | 50936 | VE STRTER MOTOR SPRT | VARROC | GGR-1F | exact | 13/05/2026, 17:18 |  |
| 63 | BPA26013DC8EA9FI | 40871 | USHA2 HH CD 100 RT NC 1.00 | USHA | GNR-20C | exact | 13/05/2026, 16:20 |  |
| 64 | E6O0FN | 50902 | VE STRTER MOTOR TVX APACHI 150 160 180 2 | VARROC | GGR-1F | exact | 13/05/2026, 16:08 |  |
| 65 | E8FVLD | 50925 | VE STRTER MOTOR GREY PLSR 220 | VARROC | GGR-1E | exact | 13/05/2026, 16:01 |  |
| 66 | E48WLF | 50935 | VE STRTER MOTOR DSVR 100 PLSR 135 XCED | VARROC | GGR-1E | exact | 13/05/2026, 16:01 |  |
| 67 | ED0HKW | 50923 | VE STARTER MOTOR PLSR 150 180 NEW | VARROC | GGR-1E | exact | 13/05/2026, 16:00 |  |
| 68 | E5TG7M | 50926 | VE STRTER MOTOR BLACK PLSR 200 220 | VARROC | GGR-1E | exact | 13/05/2026, 16:00 |  |
| 69 | BG6S19 | 50934 | VE STRTER MOTOR I SMART 110/SPLENDER 110 | VARROC | GGR-1E | exact | 13/05/2026, 15:59 |  |
| 70 | K3538039000001 | 50841 | VE INSULATOR FOR CARBURETOR KB4S | VARROC |  | exact | 13/05/2026, 15:34 |  |
| 71 | K3531579000001 | 51045 | VE CARBON BRUSH TERMINALS YAMHA F-Z SERI | VARROC | GGR-17D | exact | 13/05/2026, 15:25 |  |
| 72 | K3531892000001 | 49937 | VE HT IGNITION COIL COMPAQ AUTO4 APPE AU | VARROC |  | exact | 13/05/2026, 15:17 |  |
| 73 | E9ZVFN | 50944 | VE STRTER MOTOR TVX WIGO STAR CITI BSVI | VARROC | GGR-1E | exact | 13/05/2026, 13:13 |  |
| 74 | BGA2D4 | 50934 | VE STRTER MOTOR I SMART 110/SPLENDER 110 | VARROC | GGR-1E | exact | 13/05/2026, 12:49 |  |
| 75 | 1310C03801 | 58012 | TE NUT DRIVING PINION LOCK | TAFE |  | slash_separated | 13/05/2026, 11:43 |  |
| 76 | 2125599K01 | 13382 | TE OIL SEAL STEERING SEAL INNER | TAFE |  | slash_separated | 13/05/2026, 11:43 |  |
| 77 | 2130320S01 | 14393 | TE OIL SEAL CRANKSHAFT REAR END S3 1NO | TAFE |  | slash_separated | 13/05/2026, 11:43 |  |
| 78 | 2125599K01/SEAL INNER/56.00/1.000 N/40169330 | 13382 | TE OIL SEAL STEERING SEAL INNER | TAFE |  | exact | 13/05/2026, 11:10 |  |
| 79 | http://vrst.in/bt/$,[a@!EASM7W!K3531369000001 | 49969 | VE HT IGNITION COIL SPLD PRO NXGE P PRO | VARROC |  | exact | 13/05/2026, 11:06 |  |
| 80 | 1310C03801/NUT - DRIVING PINION L/209.00/1.000 N/73181600 | 58012 | TE NUT DRIVING PINION LOCK | TAFE |  | exact | 13/05/2026, 10:47 |  |

## Recommended Next Steps

1. Add a generated/runtime-normalized key column or RPC check to prevent future normalized collisions, because the scanner uses `normalizeScanCode()` while the database unique constraint only sees raw `barcode_key`.
2. Backfill the three legacy full-payload rows to canonical keys where safe, or mark them as legacy so they do not confuse coverage/mapping review.
3. Add a small admin export or diagnostics view for `item_barcodes` so this report can be generated from the app without ad hoc Supabase reads.
4. Prioritize rack-wise mapping by the highest unmapped rack counts, because 571 of 588 tracked racks have no mapping yet.
