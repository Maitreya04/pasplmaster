-- Remove specific test orders (Deepak Auto Part) and all dependent rows.
-- Run pre-checks first; then BEGIN … COMMIT when satisfied.
--
-- Order numbers:
--   PA-260602-0038, PA-260602-0035, PA-260602-0016, PA-260602-0011

-- PRE-CHECK
SELECT id, order_number, workflow_status, customer_name, total_value, item_count
FROM public.orders
WHERE order_number IN (
  'PA-260602-0038',
  'PA-260602-0035',
  'PA-260602-0016',
  'PA-260602-0011'
)
ORDER BY order_number;

SELECT sr.status, count(*) AS cnt, sum(sr.qty_reserved) AS qty
FROM public.stock_reservations sr
JOIN public.orders o ON o.id = sr.order_id
WHERE o.order_number IN (
  'PA-260602-0038',
  'PA-260602-0035',
  'PA-260602-0016',
  'PA-260602-0011'
)
GROUP BY sr.status
ORDER BY sr.status;

SELECT count(*) AS pending_items
FROM public.pending_items pi
JOIN public.orders o ON o.id = pi.order_id
WHERE o.order_number IN (
  'PA-260602-0038',
  'PA-260602-0035',
  'PA-260602-0016',
  'PA-260602-0011'
);

-- DELETE (destructive)
BEGIN;

DELETE FROM public.user_notifications
WHERE order_id IN (
  SELECT id FROM public.orders
  WHERE order_number IN (
    'PA-260602-0038',
    'PA-260602-0035',
    'PA-260602-0016',
    'PA-260602-0011'
  )
);

DELETE FROM public.notification_events
WHERE order_id IN (
  SELECT id FROM public.orders
  WHERE order_number IN (
    'PA-260602-0038',
    'PA-260602-0035',
    'PA-260602-0016',
    'PA-260602-0011'
  )
);

DELETE FROM public.orders
WHERE order_number IN (
  'PA-260602-0038',
  'PA-260602-0035',
  'PA-260602-0016',
  'PA-260602-0011'
);

COMMIT;

-- POST-CHECK (should return 0 rows)
SELECT order_number FROM public.orders
WHERE order_number IN (
  'PA-260602-0038',
  'PA-260602-0035',
  'PA-260602-0016',
  'PA-260602-0011'
);
