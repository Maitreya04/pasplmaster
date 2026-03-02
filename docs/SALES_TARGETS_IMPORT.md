# Sales Targets Import — Analysis & Plan

## CSV Structure (Sales Plan 2025-26.csv)

### Layout
| Row | Content |
|-----|---------|
| 0 | Headers: `Item Group`, `SATISHJI`, (empty), `HEMANTJI`, (empty), ... `AWASTHIJI` |
| 1 | Years: (empty), `24-25`, `25-26`, `24-25`, `25-26`, ... (alternating per person) |
| 2+ | Data: product_group in col 0, targets in remaining cols |

### Column Mapping (25-26 only)
| Col | Person | Year |
|-----|--------|------|
| 0 | Item Group | — |
| 2 | Satish | 25-26 |
| 4 | Hemant | 25-26 |
| 6 | Mankar | 25-26 |
| 8 | Raju Ji | 25-26 |
| 10 | Rehan Multani | 25-26 |
| 12 | Guddu | 25-26 |
| 14 | Manish Sharma | 25-26 |
| 16 | Hardeep Singh | 25-26 |
| 18 | Mahendra Rajput (2W) | 25-26 |
| 20 | Deepak (2W) | 25-26 |
| 22 | Vinod (2W) | 25-26 |
| 24 | Anand Awasthi (2W) | 25-26 |

### Sections
- **4W (rows 2–31):** B.FAN MOTOR AASY., B.GASKETS, ... TOTAL 4W
- **2W (rows 34–66):** ASK BP, ASK BS, GAE, BELRISE, ... TOTAL 2W

### Special Values
- `" -  "` (dash with spaces) = placeholder for zero → skip
- `" 1.02 "` (spaces around number) → parse as 1.02
- Skip: TOTAL rows, empty product_group, null/zero

---

## Supabase Table

### Run in SQL Editor

```sql
CREATE TABLE IF NOT EXISTS public.sales_targets (
  id BIGSERIAL PRIMARY KEY,
  salesperson_name TEXT NOT NULL,
  product_group TEXT NOT NULL,
  year TEXT NOT NULL,
  annual_target_lakhs NUMERIC(12,2) NOT NULL DEFAULT 0,
  category TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(salesperson_name, product_group, year)
);

CREATE INDEX IF NOT EXISTS idx_sales_targets_salesperson ON public.sales_targets(salesperson_name);
CREATE INDEX IF NOT EXISTS idx_sales_targets_year ON public.sales_targets(year);
```

### Columns
| Column | Type | Notes |
|--------|------|-------|
| salesperson_name | TEXT | Satish, Hemant, Mankar, etc. |
| product_group | TEXT | B.FAN MOTOR AASY., ASK BS, etc. |
| year | TEXT | `2025-26` |
| annual_target_lakhs | NUMERIC(12,2) | Target in lakhs |
| category | TEXT | `null` = 4W, `2W` = 2-wheeler |

---

## Implementation Plan

1. **Supabase:** Run the SQL above to create `sales_targets`.
2. **parseNum:** Handle `" - "` and trim spaces.
3. **Single-sheet / CSV:** When no 4WF/2Wf sheet, parse first sheet as combined 4W+2W; assign `category = "2W"` for MAHENDRA, DEEPAK, VINOD, AWASTHIJI.
4. **Upload:** Add `.csv` to file accept; XLSX reads CSV as a single-sheet workbook.
