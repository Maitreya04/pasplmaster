-- Orphaned active picking claims (order already left pick queue) inflate picker load counts.

UPDATE public.work_claims wc
SET status = CASE
      WHEN o.workflow_status IN ('completed', 'flagged') THEN 'completed'
      ELSE 'released'
    END,
    completed_at = CASE
      WHEN o.workflow_status IN ('completed', 'flagged')
        THEN COALESCE(wc.completed_at, now())
      ELSE wc.completed_at
    END,
    released_at = COALESCE(wc.released_at, now())
FROM public.orders o
WHERE wc.order_id = o.id
  AND wc.stage = 'picking'
  AND wc.status = 'active'
  AND o.workflow_status NOT IN ('approved', 'picking');

CREATE OR REPLACE FUNCTION public.close_picking_claims_on_order_exit()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.workflow_status IS DISTINCT FROM OLD.workflow_status
     AND NEW.workflow_status NOT IN ('approved', 'picking') THEN
    UPDATE public.work_claims
    SET status = CASE
          WHEN OLD.workflow_status = 'picking'
               AND NEW.workflow_status IN ('completed', 'flagged')
            THEN 'completed'
          ELSE 'released'
        END,
        completed_at = CASE
          WHEN OLD.workflow_status = 'picking'
               AND NEW.workflow_status IN ('completed', 'flagged')
            THEN COALESCE(completed_at, now())
          ELSE completed_at
        END,
        released_at = COALESCE(released_at, now())
    WHERE order_id = NEW.id
      AND stage = 'picking'
      AND status = 'active';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_close_picking_claims_on_order_exit ON public.orders;

CREATE TRIGGER trg_close_picking_claims_on_order_exit
  AFTER UPDATE OF workflow_status ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.close_picking_claims_on_order_exit();

COMMENT ON FUNCTION public.close_picking_claims_on_order_exit() IS
  'Release active picking claims when an order leaves the approved/picking queue.';
