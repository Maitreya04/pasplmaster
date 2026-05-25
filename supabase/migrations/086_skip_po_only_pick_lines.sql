-- PO-only order lines should not sit in the warehouse pick queue as "remaining".
-- Mirrors applyWarehousePickSkipForPoOnlyLine / pickableOrderItems client logic.

UPDATE public.order_items oi
SET state = 'picked'
FROM public.orders o
WHERE oi.order_id = o.id
  AND o.workflow_status IN ('approved', 'picking')
  AND COALESCE(o.fulfillment_path, 'warehouse_pick') = 'warehouse_pick'
  AND oi.state NOT IN ('picked', 'flagged', 'overridden')
  AND public.order_item_pick_quantity_target(
    oi.qty_requested,
    oi.qty_shippable,
    oi.qty_po,
    oi.qty_approved
  ) = 0;
