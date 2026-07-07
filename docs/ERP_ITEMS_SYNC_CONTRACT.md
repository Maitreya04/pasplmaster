# ERP Items Sync Contract

Busy/ERP is the source of truth for synced item catalog identity. In Supabase,
`public.items.busy_code` is the durable ERP key and `public.items.name` remains
unique for app search/display.

Stock quantities are a separate sync concern. Do not use the catalog RPC to
update stock. Continue sending stock through the existing stock sync RPCs:

- `public.apply_stock_locationwise_delta(...)` for flat location stock rows
- `public.apply_erp_items_delta(...)` for item/price/stock deltas keyed by
  `busy_code`

Do not raw-insert into `public.items`.

Use:

```sql
select public.upsert_erp_items_catalog(
  $json_rows::jsonb,
  'busy_python_worker',
  jsonb_build_object('batch_id', $batch_id)
);
```

Accepted row keys include:

- `busy_code`, `busyCode`, `BusyCode`, `item_code`, `itemCode`, or `code`
- `name`, `item_name`, `itemName`, `Itemname`, `item_description`, or `description`
- Optional: `alias`, `alias1`, `parent_group`, `main_group`, `item_category`,
  `gst_percent`, `hsn_code`, `sales_price`, `mrp`, `rack_no`, `selling_unit`,
  `is_active`

If `stock_qty`, `stockQty`, or `stock` is accidentally included in this catalog
payload, the RPC ignores it and records that in `erp_item_catalog_sync_runs.extra`.

REST/RPC example:

```python
import requests

response = requests.post(
    f"{SUPABASE_URL}/rest/v1/rpc/upsert_erp_items_catalog",
    headers={
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
        "Content-Type": "application/json",
    },
    json={
        "p_rows": rows,
        "p_source": "busy_python_worker",
        "p_extra": {"batch_id": batch_id},
    },
    timeout=30,
)
response.raise_for_status()
print(response.json())
```

Raw PostgREST table upsert is acceptable only if the worker sends complete
catalog rows and uses the conflict key:

```http
POST /rest/v1/items?on_conflict=busy_code
Prefer: resolution=merge-duplicates
```

The RPC is preferred because it validates rows, claims legacy name-only rows,
avoids no-op updates, records audit counts in `erp_item_catalog_sync_runs`, and
skips unsafe name conflicts instead of breaking the sync.
