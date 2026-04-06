# Smart search & customer intelligence

Apply migration [`012_smart_search_intelligence.sql`](../supabase/migrations/012_smart_search_intelligence.sql) in Supabase.

## Automatic refresh

- After each successful checkout, the app calls `refresh_customer_frequency()` so the **customer_item_frequency** materialized view stays current.

## One-time / periodic jobs (SQL)

Run in Supabase SQL editor when you want data for co-occurrence, reorder predictions, and learned shortcuts:

```sql
SELECT public.rebuild_item_cooccurrence();
SELECT public.refresh_reorder_predictions();
SELECT public.refresh_salesperson_search_patterns();
```

- **rebuild_item_cooccurrence** — can be slow on large history; run off-peak or schedule.
- **refresh_salesperson_search_patterns** — requires rows in `search_events` (from reps using New Order).

## Routes

- **Sales home** — “Due for reorder soon” when `reorder_predictions` has rows for your customers (`customers.salesman` = logged-in name).
- **Search intelligence** — `/sales/intelligence` — suggestion vs search counts from `search_events`.
