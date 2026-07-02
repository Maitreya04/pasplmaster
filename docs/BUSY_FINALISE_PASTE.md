# Busy Finalise Bill Paste

Moves **finalise billing** lines into Busy 21 from PASPL Master clipboard data.

Early `busy_entry` copy (pre-pick) is unchanged — this flow is for **review / finalise** only.

## Preferred flow: Busy native paste

1. In **PASPL**: resolve all flags on the order → click **Copy final bill**
2. In **Busy**: open **Modify Sales Voucher** — set party, date, series, transport manually
3. Place the cursor on the **first empty Item cell** in the item grid
4. Try Busy's native grid paste:
   - first try **Ctrl+V**
   - if Busy exposes a local paste menu on your screen, use that option instead
5. Review item, qty, unit, MRP/batch, line amounts → **F2 Save**

No AutoHotkey is needed if Busy accepts the clipboard table directly.

### One-time Busy setup / pilot

Run this once with a small 2-line test bill:

1. Confirm the cursor is in the item grid, not the party/header area.
2. Paste with the first column mapped to **Item Name**.
3. Confirm columns land as **Item Name → Qty → Unit → MRP**.
4. For pcs rows, the Unit column is intentionally blank so the MRP still lands in the fourth column.
5. If Busy asks for a paste/import layout, save the layout as **PASPL Final Bill** with these four columns.
6. If F12 opens a copy/duplicate screen instead of paste, do not use it for this flow. BUSY's public shortcut list describes F12 as copy/duplicate and F11 as pick from orders/challan, so paste behavior may be screen-specific.

If this pilot works, the daily flow is simply:

1. PASPL **Copy final bill**
2. Busy voucher item grid **Ctrl+V** or saved **PASPL Final Bill** paste layout
3. Review → **F2 Save**

## Clipboard format

PASPL copies tab-separated lines (Excel-style):

```
ItemName	Qty	Unit	MRP
```

- **ItemName** — exact frozen catalog name from the order (`item_name`), must match Busy item master
- **Qty** — billable quantity after short picks / partials
- **Unit** — blank for default pcs; `Kit` or `Set` when sales selected a unit
- **MRP** — integer ₹ for Busy **Item Price & Discount** / MRP-wise batch dialog

Example (pcs with blank unit column):

```
USHA2 HONDA ACTIVA 125CC NC 0.25	2		504
```

Example (explicit Set unit):

```
TVS JUPITER RING SET	1	Set	912
```

## MRP resolution in PASPL

The MRP column is chosen in this order:

1. FOC lines → `0`
2. Picker-confirmed label MRP (`confirmed_mrp`)
3. Billing accepted price (`accept_price` / manual override)
4. Stock MRP at pick time (`scan_result.suggestedMrpAtPick`)
5. Fallback → quoted bill rate

If PASPL shows **“MRP from quoted rate only”**, verify the batch MRP in Busy after paste.

## Fallback: AutoHotkey script (Busy PC)

Use this only if Busy cannot paste the clipboard table natively.

1. Install [AutoHotkey v1.1](https://www.autohotkey.com/) on the billing workstation
2. Copy [`scripts/busy-finalise-paste.ahk`](../scripts/busy-finalise-paste.ahk) to the PC (e.g. Desktop)
3. Double-click to run — tray icon appears
4. Optional: add a shortcut to `%AppData%\Microsoft\Windows\Start Menu\Programs\Startup` for login auto-start

### Hotkeys

| Key | Action |
|-----|--------|
| **Ctrl+Alt+B** | Paste all lines from clipboard |
| **Esc** | Stop after current line |

## Tuning delays

Busy 21 response time varies by machine load. If lines skip fields or dialogs close too early:

1. Open `busy-finalise-paste.ahk`
2. Increase `SetKeyDelay` and `Sleep` values (try +50 ms steps)
3. Re-run the script and test on one real voucher

Pilot checklist (3–5 bills with billing operator):

- [ ] Every item name resolves in Busy (no “item not found”)
- [ ] MRP dialog selects the correct batch
- [ ] Set/Kit units land in the unit column
- [ ] Totals match PASPL review table
- [ ] Native paste works without AutoHotkey, or AutoHotkey fallback abort works with Esc

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| Item not found in Busy | `item_name` ≠ Busy master string | Fix catalog name in items table; re-submit order or edit line name at source |
| Wrong batch / MRP rejected | MRP column ≠ physical label | Confirm label MRP at pick; use “Bill at label” in PASPL review |
| Price lands in unit column | Old clipboard format (3 columns) | Re-copy from PASPL after update — pcs rows need blank unit column |
| F12 duplicates the voucher | F12 is Busy copy/duplicate on many screens | Use Ctrl+V or the screen's paste/import option instead |
| Busy asks for column mapping | Paste layout not saved yet | Save layout as `PASPL Final Bill`: Item Name, Qty, Unit, MRP |
| Script types into wrong window | Busy not focused | Click Item cell in voucher before Ctrl+Alt+B |
| Dialog needs extra Tab | Busy config differs | Adjust script Tab/Enter sequence after one manual observation |

## Code references (PASPL)

- Paste builder: [`src/lib/billing/finalBillCopy.ts`](../src/lib/billing/finalBillCopy.ts)
- Finalise UI: [`src/components/billing/BillingOrderStageBody.tsx`](../src/components/billing/BillingOrderStageBody.tsx)
- Tests: `npm run test:final-bill-copy`

## Future path (not in scope)

- **BDEP / Sales Order + F11 pull** — see [`BUSY_DB_INTEGRATION.md`](BUSY_DB_INTEGRATION.md)
- Dedicated `items.busy_paste_name` column if live testing shows name drift from Busy master
