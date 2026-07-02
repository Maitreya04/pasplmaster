# Busy Finalise Bill Paste

Automates **finalise billing** entry into Busy 21 from PASPL Master clipboard data.

Early `busy_entry` copy (pre-pick) is unchanged — this flow is for **review / finalise** only.

## Operator flow

1. In **PASPL**: resolve all flags on the order → click **Copy final bill**
2. In **Busy**: open **Modify Sales Voucher** — set party, date, series, transport manually
3. Place the cursor on the **first empty Item cell**
4. Press **Ctrl+Alt+B** (AutoHotkey script on the Busy PC)
5. Review voucher totals and line amounts → **F2 Save**

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

## Install AutoHotkey script (Busy PC)

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
- [ ] Esc abort works mid-run

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| Item not found in Busy | `item_name` ≠ Busy master string | Fix catalog name in items table; re-submit order or edit line name at source |
| Wrong batch / MRP rejected | MRP column ≠ physical label | Confirm label MRP at pick; use “Bill at label” in PASPL review |
| Price lands in unit column | Old clipboard format (3 columns) | Re-copy from PASPL after update — pcs rows need blank unit column |
| Script types into wrong window | Busy not focused | Click Item cell in voucher before Ctrl+Alt+B |
| Dialog needs extra Tab | Busy config differs | Adjust script Tab/Enter sequence after one manual observation |

## Code references (PASPL)

- Paste builder: [`src/lib/billing/finalBillCopy.ts`](../src/lib/billing/finalBillCopy.ts)
- Finalise UI: [`src/components/billing/BillingOrderStageBody.tsx`](../src/components/billing/BillingOrderStageBody.tsx)
- Tests: `npm run test:final-bill-copy`

## Future path (not in scope)

- **BDEP / Sales Order + F11 pull** — see [`BUSY_DB_INTEGRATION.md`](BUSY_DB_INTEGRATION.md)
- Dedicated `items.busy_paste_name` column if live testing shows name drift from Busy master
