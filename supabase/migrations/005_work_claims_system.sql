-- ============================================================
-- PASPL Master — Work Claims System
-- ============================================================
-- Adds:
--   1. users            — real identity for all team members
--   2. work_claims      — concurrency-safe order claiming
--   3. order_events     — full audit trail
--   4. orders.status → orders.workflow_status rename
--   5. RPC functions for server-owned workflow
-- ============================================================

-- ─── 1. users ───────────────────────────────────────────────
CREATE TABLE users (
  id BIGSERIAL PRIMARY KEY,
  full_name TEXT UNIQUE NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('sales','billing','picking','admin')),
  is_active BOOLEAN DEFAULT true,
  station_label TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_users_role ON users(role) WHERE is_active = true;

-- Seed: Sales team (matches SALES_NAMES in constants.ts)
INSERT INTO users (full_name, role) VALUES
  ('Satish', 'sales'),
  ('Hemant', 'sales'),
  ('Mankar', 'sales'),
  ('Raju Ji', 'sales'),
  ('Rehan Multani', 'sales'),
  ('Hardeep Singh', 'sales'),
  ('Deepak', 'sales'),
  ('Vinod', 'sales'),
  ('Sachin Rao', 'sales'),
  ('Anand Awasthi', 'sales'),
  ('Gourav Yadav', 'sales'),
  ('Mahendra Rajput', 'sales'),
  ('Manish Sharma', 'sales'),
  ('Shri Ram Sharma', 'sales'),
  ('Asad Khan', 'sales'),
  ('Direct', 'sales');

-- Seed: Picker team (matches PICKER_NAMES in constants.ts)
INSERT INTO users (full_name, role) VALUES
  ('Shankar', 'picking'),
  ('Dharmendra', 'picking'),
  ('Abhishek', 'picking'),
  ('Guddu', 'picking');

-- Seed: Billing team (placeholder names — update with real names)
INSERT INTO users (full_name, role, station_label) VALUES
  ('Billing 1', 'billing', 'Station 1'),
  ('Billing 2', 'billing', 'Station 2'),
  ('Billing 3', 'billing', 'Station 3'),
  ('Billing 4', 'billing', 'Station 4');

-- ─── 2. work_claims ─────────────────────────────────────────
CREATE TABLE work_claims (
  id BIGSERIAL PRIMARY KEY,
  order_id BIGINT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  stage TEXT NOT NULL CHECK (stage IN ('billing','picking')),
  claimed_by_user_id BIGINT NOT NULL REFERENCES users(id),
  claimed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  released_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','released','completed','expired')),
  claim_version INTEGER NOT NULL DEFAULT 1,

  -- THE KEY CONSTRAINT: at most ONE active claim per order+stage
  -- Even if two stations click simultaneously, Postgres guarantees only one wins
  CONSTRAINT unique_active_claim_per_stage
    EXCLUDE USING btree (order_id WITH =, stage WITH =)
    WHERE (status = 'active')
);

CREATE INDEX idx_work_claims_order ON work_claims(order_id);
CREATE INDEX idx_work_claims_active ON work_claims(status) WHERE status = 'active';
CREATE INDEX idx_work_claims_user ON work_claims(claimed_by_user_id) WHERE status = 'active';
CREATE INDEX idx_work_claims_heartbeat ON work_claims(last_heartbeat_at) WHERE status = 'active';

-- ─── 3. order_events ────────────────────────────────────────
CREATE TABLE order_events (
  id BIGSERIAL PRIMARY KEY,
  order_id BIGINT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  actor_user_id BIGINT REFERENCES users(id),
  stage TEXT,
  payload JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_order_events_order ON order_events(order_id);
CREATE INDEX idx_order_events_type ON order_events(event_type);
CREATE INDEX idx_order_events_created ON order_events(created_at DESC);

-- ─── 4. Rename orders.status → orders.workflow_status ───────
ALTER TABLE orders RENAME COLUMN status TO workflow_status;

-- Recreate the index with new column name
DROP INDEX IF EXISTS idx_orders_status;
CREATE INDEX idx_orders_workflow_status ON orders(workflow_status);

-- ─── 5. Enable Realtime on new tables ───────────────────────
ALTER PUBLICATION supabase_realtime ADD TABLE work_claims;
ALTER PUBLICATION supabase_realtime ADD TABLE order_events;


-- ============================================================
-- RPC FUNCTIONS
-- ============================================================

-- ─── claim_order ────────────────────────────────────────────
-- Atomically claim an order for a stage (billing or picking).
-- Returns JSON: { success, claim_id, claim_version } or
--               { success: false, reason, claimed_by, claimed_at }
CREATE OR REPLACE FUNCTION claim_order(
  p_order_id BIGINT,
  p_stage TEXT,
  p_user_id BIGINT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_order RECORD;
  v_existing RECORD;
  v_claim_id BIGINT;
  v_user_name TEXT;
  v_claimer_name TEXT;
  v_stale_threshold INTERVAL := INTERVAL '3 minutes';
BEGIN
  -- Validate inputs
  IF p_stage NOT IN ('billing', 'picking') THEN
    RETURN jsonb_build_object('success', false, 'reason', 'Invalid stage');
  END IF;

  -- Lock the order row to prevent concurrent modifications
  SELECT id, workflow_status INTO v_order
  FROM orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'reason', 'Order not found');
  END IF;

  -- Get the claiming user's name
  SELECT full_name INTO v_user_name FROM users WHERE id = p_user_id AND is_active = true;
  IF v_user_name IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'User not found or inactive');
  END IF;

  -- Check for existing active claim on this order+stage
  SELECT wc.id, wc.claimed_by_user_id, wc.claimed_at, wc.last_heartbeat_at, wc.status,
         u.full_name AS claimer_name
  INTO v_existing
  FROM work_claims wc
  JOIN users u ON u.id = wc.claimed_by_user_id
  WHERE wc.order_id = p_order_id
    AND wc.stage = p_stage
    AND wc.status = 'active';

  IF FOUND THEN
    -- Check if same user is reclaiming (e.g. page refresh)
    IF v_existing.claimed_by_user_id = p_user_id THEN
      -- Return existing claim
      RETURN jsonb_build_object(
        'success', true,
        'claim_id', v_existing.id,
        'claim_version', 1,
        'reclaimed', true
      );
    END IF;

    -- Check if stale (heartbeat expired)
    IF (now() - v_existing.last_heartbeat_at) > v_stale_threshold THEN
      -- Expire the stale claim
      UPDATE work_claims
      SET status = 'expired',
          released_at = now()
      WHERE id = v_existing.id;

      -- Log the expiry
      INSERT INTO order_events (order_id, event_type, actor_user_id, stage, payload)
      VALUES (p_order_id, 'claim_expired', p_user_id, p_stage,
              jsonb_build_object(
                'expired_claim_id', v_existing.id,
                'expired_user', v_existing.claimer_name,
                'reason', 'heartbeat_timeout'
              ));

      -- Log the takeover
      INSERT INTO order_events (order_id, event_type, actor_user_id, stage, payload)
      VALUES (p_order_id, 'claim_takeover', p_user_id, p_stage,
              jsonb_build_object(
                'previous_owner', v_existing.claimer_name,
                'new_owner', v_user_name
              ));
    ELSE
      -- Claim is still fresh — reject
      RETURN jsonb_build_object(
        'success', false,
        'reason', 'already_claimed',
        'claimed_by', v_existing.claimer_name,
        'claimed_at', v_existing.claimed_at,
        'last_heartbeat_at', v_existing.last_heartbeat_at
      );
    END IF;
  END IF;

  -- Create the new claim
  INSERT INTO work_claims (order_id, stage, claimed_by_user_id)
  VALUES (p_order_id, p_stage, p_user_id)
  RETURNING id INTO v_claim_id;

  -- Log the claim event
  INSERT INTO order_events (order_id, event_type, actor_user_id, stage)
  VALUES (p_order_id,
          CASE p_stage WHEN 'billing' THEN 'billing_claimed' ELSE 'picking_claimed' END,
          p_user_id,
          p_stage);

  -- If picking stage, update the order status and picker name (legacy compat)
  IF p_stage = 'picking' THEN
    UPDATE orders
    SET workflow_status = 'picking',
        picker_name = v_user_name,
        picked_at = COALESCE(picked_at, now())
    WHERE id = p_order_id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'claim_id', v_claim_id,
    'claim_version', 1
  );
END;
$$;


-- ─── heartbeat_claim ────────────────────────────────────────
-- Update heartbeat timestamp. Called every ~25 seconds from frontend.
CREATE OR REPLACE FUNCTION heartbeat_claim(
  p_claim_id BIGINT,
  p_user_id BIGINT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE work_claims
  SET last_heartbeat_at = now()
  WHERE id = p_claim_id
    AND claimed_by_user_id = p_user_id
    AND status = 'active';

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'reason', 'Claim not found or not active');
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$$;


-- ─── release_claim ──────────────────────────────────────────
-- Release an active claim (user navigating away, giving up).
CREATE OR REPLACE FUNCTION release_claim(
  p_claim_id BIGINT,
  p_user_id BIGINT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_claim RECORD;
  v_user_name TEXT;
BEGIN
  -- Find and lock the claim
  SELECT wc.id, wc.order_id, wc.stage, wc.claimed_by_user_id
  INTO v_claim
  FROM work_claims wc
  WHERE wc.id = p_claim_id
    AND wc.claimed_by_user_id = p_user_id
    AND wc.status = 'active'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'reason', 'Claim not found or not active');
  END IF;

  SELECT full_name INTO v_user_name FROM users WHERE id = p_user_id;

  -- Release the claim
  UPDATE work_claims
  SET status = 'released',
      released_at = now()
  WHERE id = p_claim_id;

  -- Log the event
  INSERT INTO order_events (order_id, event_type, actor_user_id, stage)
  VALUES (v_claim.order_id,
          CASE v_claim.stage WHEN 'billing' THEN 'billing_released' ELSE 'picking_released' END,
          p_user_id,
          v_claim.stage);

  -- If picking, revert order status
  IF v_claim.stage = 'picking' THEN
    UPDATE orders
    SET workflow_status = 'approved',
        picker_name = NULL
    WHERE id = v_claim.order_id
      AND workflow_status = 'picking';
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$$;


-- ─── complete_billing ───────────────────────────────────────
-- Complete the billing stage for an order.
CREATE OR REPLACE FUNCTION complete_billing(
  p_order_id BIGINT,
  p_claim_id BIGINT,
  p_user_id BIGINT,
  p_is_resolving_flags BOOLEAN DEFAULT false
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_claim RECORD;
  v_user_name TEXT;
BEGIN
  -- Verify the claim
  SELECT id, order_id, stage, claimed_by_user_id
  INTO v_claim
  FROM work_claims
  WHERE id = p_claim_id
    AND order_id = p_order_id
    AND stage = 'billing'
    AND claimed_by_user_id = p_user_id
    AND status = 'active'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'reason', 'No active billing claim found');
  END IF;

  SELECT full_name INTO v_user_name FROM users WHERE id = p_user_id;

  -- Complete the claim
  UPDATE work_claims
  SET status = 'completed',
      completed_at = now()
  WHERE id = p_claim_id;

  -- Update the order
  IF p_is_resolving_flags THEN
    UPDATE orders
    SET workflow_status = 'completed',
        reviewer_name = v_user_name,
        priority = 'normal'
    WHERE id = p_order_id;

    INSERT INTO order_events (order_id, event_type, actor_user_id, stage, payload)
    VALUES (p_order_id, 'billing_flags_resolved', p_user_id, 'billing',
            jsonb_build_object('reviewer', v_user_name));
  ELSE
    UPDATE orders
    SET workflow_status = 'approved',
        reviewer_name = v_user_name,
        approved_at = COALESCE(approved_at, now())
    WHERE id = p_order_id;

    INSERT INTO order_events (order_id, event_type, actor_user_id, stage, payload)
    VALUES (p_order_id, 'billing_approved', p_user_id, 'billing',
            jsonb_build_object('reviewer', v_user_name));
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$$;


-- ─── complete_picking ───────────────────────────────────────
-- Complete the picking stage for an order.
CREATE OR REPLACE FUNCTION complete_picking(
  p_order_id BIGINT,
  p_claim_id BIGINT,
  p_user_id BIGINT,
  p_has_flags BOOLEAN DEFAULT false
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_claim RECORD;
  v_user_name TEXT;
BEGIN
  -- Verify the claim
  SELECT id, order_id, stage, claimed_by_user_id
  INTO v_claim
  FROM work_claims
  WHERE id = p_claim_id
    AND order_id = p_order_id
    AND stage = 'picking'
    AND claimed_by_user_id = p_user_id
    AND status = 'active'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'reason', 'No active picking claim found');
  END IF;

  SELECT full_name INTO v_user_name FROM users WHERE id = p_user_id;

  -- Complete the claim
  UPDATE work_claims
  SET status = 'completed',
      completed_at = now()
  WHERE id = p_claim_id;

  -- Update the order
  IF p_has_flags THEN
    UPDATE orders
    SET workflow_status = 'flagged'
    WHERE id = p_order_id;
  ELSE
    UPDATE orders
    SET workflow_status = 'completed',
        completed_at = COALESCE(completed_at, now()),
        priority = 'normal'
    WHERE id = p_order_id;
  END IF;

  -- Log the event
  INSERT INTO order_events (order_id, event_type, actor_user_id, stage, payload)
  VALUES (p_order_id, 'picking_completed', p_user_id, 'picking',
          jsonb_build_object('picker', v_user_name, 'has_flags', p_has_flags));

  RETURN jsonb_build_object('success', true);
END;
$$;


-- ─── expire_stale_claims ────────────────────────────────────
-- Expire any claims that have not received a heartbeat in 3 minutes.
-- Can be called by a cron job, edge function, or lazily from claim_order.
CREATE OR REPLACE FUNCTION expire_stale_claims()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_expired_count INTEGER := 0;
  v_claim RECORD;
  v_stale_threshold INTERVAL := INTERVAL '3 minutes';
BEGIN
  FOR v_claim IN
    SELECT wc.id, wc.order_id, wc.stage, wc.claimed_by_user_id, u.full_name
    FROM work_claims wc
    JOIN users u ON u.id = wc.claimed_by_user_id
    WHERE wc.status = 'active'
      AND (now() - wc.last_heartbeat_at) > v_stale_threshold
  LOOP
    -- Expire the claim
    UPDATE work_claims
    SET status = 'expired',
        released_at = now()
    WHERE id = v_claim.id;

    -- Log the event
    INSERT INTO order_events (order_id, event_type, stage, payload)
    VALUES (v_claim.order_id, 'claim_expired', v_claim.stage,
            jsonb_build_object(
              'expired_claim_id', v_claim.id,
              'expired_user', v_claim.full_name,
              'reason', 'heartbeat_timeout'
            ));

    -- If picking, revert order status
    IF v_claim.stage = 'picking' THEN
      UPDATE orders
      SET workflow_status = 'approved',
          picker_name = NULL
      WHERE id = v_claim.order_id
        AND workflow_status = 'picking';
    END IF;

    v_expired_count := v_expired_count + 1;
  END LOOP;

  RETURN jsonb_build_object('expired_count', v_expired_count);
END;
$$;
