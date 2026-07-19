-- High-confidence Busy display-name aliases confirmed against the app roster.
INSERT INTO public.salesperson_source_aliases(salesperson_user_id, source_name)
SELECT u.id, aliases.source_name
FROM (VALUES
  ('Awasthi', 'Anand Awasthi'),
  ('Raju', 'Raju Ji'),
  ('Manish', 'Manish Sharma'),
  ('Pankaj', 'Pankaj Meena'),
  ('Asad', 'Asad Khan'),
  ('Hardeep', 'Hardeep Singh')
) AS aliases(app_name, source_name)
JOIN public.users u ON u.role = 'sales' AND u.full_name = aliases.app_name
ON CONFLICT (normalized_source_name) DO NOTHING;

DO $$
DECLARE
  v_fy RECORD;
BEGIN
  FOR v_fy IN SELECT * FROM public.financial_years ORDER BY starts_on LOOP
    PERFORM public.refresh_sales_achievement_daily(v_fy.starts_on, v_fy.ends_on, 'mapping');
  END LOOP;
END;
$$;
