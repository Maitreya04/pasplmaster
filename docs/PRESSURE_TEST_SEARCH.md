# Search pressure test — real-world order lines

Run: `npx tsx scripts/pressure-test-search.ts`  
Uses: `$HOME/Downloads/files/items_import_fixed.csv` (or pass path as first arg).

---

## Test queries (from sample order)

| # | Raw query | Normalized | Code? | Results | Top result / notes |
|---|-----------|------------|-------|---------|--------------------|
| 1 | Tank unit cd dlx | tank unit cd deluxe | No | 2 | **OK** — SJ TANK UNIT CD DLX, SJ TANK UNIT HERO IGNITOR/CD DLX. Both relevant. |
| 2 | Clutch cable pulsar 125 bs6 | clutch cable pulsar 125 bs6 | No | 20 | **Ranking** — Many hits but top results are ACC CABLE / STATOR, not clutch cable. Catalog has “SJ CLUTCH CABLE PULSAR AS 150” etc.; keyword layer treats all tokens equally so “clutch cable” doesn’t rank above “cable” + “125” + “bs6”. |
| 3 | RR unit spl old | rear unit splendor old | No | 0 | **Catalog wording** — Catalog uses “SHOCK” (e.g. BL.SHOCK SPLENDOR ABS REAR), not “unit”. User would need “rear shock spl” or “rr shock spl”. No shorthand added for unit→shock (would break “tank unit”). |
| 4 | RR sup spl HH33 varroc | rear suspension splendor hh33 varroc | No | 0 | **Catalog** — “sup” expanded to “suspension”. No items found with that exact combo; “HH33”/“varroc” may not appear in names. |
| 5 | Main handle cd dlx varroc | main handle cd deluxe varroc | No | 0 | **Catalog wording** — Catalog has “VE HANDLE BAR”, “H.B”, “CD DLX” in different products; no single item with “main handle” + “cd dlx” + “varroc”. |
| 6 | Main handle ct100 varroc | main handle ct100 varroc | No | 0 | Same as above; CT100 appears in cables/kits but not “main handle ct100” as one product. |
| 7 | Disk pas tvs raider front | disk pas tvs raider front | No | 0 | **Fixed** — Removed `pas→passion` so “disk pas” is no longer “disk passion”. Catalog has “ASK BRAKE PAD NA TVS APACHE” but no “TVS RAIDER” disc/brake pad; 0 results = product not in catalog. |
| 8 | Rear shocker passion pro red | rear shocker passion pro red | No | 1 | **OK** — SOM SHOCK HERO PASSION PRO RED RSA. Correct. |
| 9 | Self relay passion pro varroc | self relay passion pro varroc | No | 0 | **Catalog** — No “self relay” + “passion pro” + “varroc” in catalog; may be missing or different naming. |

---

## Changes made after pressure test

1. **Removed `pas → passion`**  
   “Disk pas” was normalized to “disk passion” and returned 0 results. In orders, “pas” often means “pad” (e.g. disk pad). Removed so “passion pro” is matched when user types “passion” in full; “disk pas” stays “disk pas” and can fuzzy-match to “pad” when that product exists.

2. **Added `sup → suspension`**  
   “RR sup spl” now normalizes to “rear suspension splendor” so items that use “suspension” in the name can match. Still 0 in this catalog for “HH33 varroc” style names.

---

## Summary

- **Works well:** Tank unit cd dlx, Rear shocker passion pro red; normalization (rr→rear, dlx→deluxe, spl→splendor) behaves as intended.
- **Ranking:** “Clutch cable pulsar 125 bs6” returns 20 results but clutch-cable items are not consistently on top; all keywords weighted equally. Possible follow-up: boost when multiple query words appear in order (e.g. “clutch cable” as phrase) or when match is in `name` vs alias.
- **Catalog coverage:** Several 0-result queries (main handle cd dlx/ct100 varroc, RR sup spl HH33 varroc, self relay passion pro varroc, disk pas tvs raider) are due to catalog naming or missing SKUs, not search bugs.
- **Shorthand:** No global `unit→shock` (would break “tank unit”). Users can type “rear shock spl” for shock-absorber items.
