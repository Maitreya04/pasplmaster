-- Preserve the four-decimal lakh allocations used by the FY 2026-27 target
-- workbook. At the previous two-decimal scale, rounding each product group
-- caused salesperson totals to drift from the workbook's control totals.
ALTER TABLE public.sales_targets
  ALTER COLUMN annual_target_lakhs TYPE NUMERIC(14,4)
  USING annual_target_lakhs::NUMERIC(14,4);
