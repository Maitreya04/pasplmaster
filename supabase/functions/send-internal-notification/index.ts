import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import webpush from 'npm:web-push@3.6.7';

type OrderPriority = 'normal' | 'urgent';

type InternalRequest =
  | {
      eventType: 'order_ready_to_pick';
      orderId: number;
      orderNumber: string;
      customerName: string;
      priority: OrderPriority;
      approvedAt: string | null;
      targetUserId?: number;
    }
  | {
      eventType: 'item_flagged_by_picker';
      orderId: number;
      orderNumber: string;
      customerName: string;
      itemName: string;
      flagReason: string;
      pickerName: string | null;
      orderItemId: number;
    }
  | {
      eventType: 'order_update_for_sales';
      orderId: number;
      orderNumber: string;
      customerName: string;
      salespersonName: string;
      messageBody: string;
      billingCustomerUpdateId?: number;
    }
  | {
      eventType: 'pick_complete_reminder';
      kind: 'all_done' | 'stalled';
      orderId: number;
      orderNumber: string;
      customerName: string;
      priority: OrderPriority;
      targetUserId: number;
      linesDone: number;
      linesTotal: number;
      linesRemaining: number;
    };

interface PushSubscriptionRow {
  id: number;
  endpoint: string;
  p256dh: string;
  auth: string;
}

const SALES_NAME_ALIASES: Record<string, string> = {
  rajuji: 'raju',
  asadkhan: 'asad',
  manishsharma: 'manish',
  hardeepsingh: 'hardeep',
  anandawasthi: 'awasthi',
};

async function getOrderSalespersonTarget(
  admin: SupabaseClient,
  orderId: number,
): Promise<{ userId: number | null; salespersonName: string | null }> {
  const { data, error } = await admin
    .from('orders')
    .select('salesperson_user_id, salesperson_name')
    .eq('id', orderId)
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  const row = (data as {
    salesperson_user_id?: number | null;
    salesperson_name?: string | null;
  } | null) ?? null;
  return {
    userId:
      typeof row?.salesperson_user_id === 'number' && Number.isFinite(row.salesperson_user_id)
        ? row.salesperson_user_id
        : null,
    salespersonName:
      typeof row?.salesperson_name === 'string' && row.salesperson_name.trim().length > 0
        ? row.salesperson_name
        : null,
  };
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const supabaseUrl = Deno.env.get('SUPABASE_URL');
const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const vapidSubject = Deno.env.get('PUSH_VAPID_SUBJECT');
const vapidPublicKey = Deno.env.get('PUSH_VAPID_PUBLIC_KEY');
const vapidPrivateKey = Deno.env.get('PUSH_VAPID_PRIVATE_KEY');

if (
  supabaseUrl &&
  supabaseServiceRoleKey &&
  vapidSubject &&
  vapidPublicKey &&
  vapidPrivateKey
) {
  webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
}

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

const CUTOFF_MS = 30 * 24 * 60 * 60 * 1000;
const PICK_REMINDER_COOLDOWN_MS = 10 * 60 * 1000;

function pushBodyPreview(text: string, max = 220): string {
  const t = text.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

async function fetchActiveUserIds(
  admin: SupabaseClient,
  role: 'sales' | 'billing' | 'picking',
): Promise<number[]> {
  const { data, error } = await admin
    .from('users')
    .select('id')
    .eq('role', role)
    .eq('is_active', true);
  if (error) throw error;
  return (data ?? []).map((r: { id: number }) => r.id);
}

async function resolveSalesUserIds(
  admin: SupabaseClient,
  salespersonName: string,
): Promise<number[]> {
  const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');
  const needleRaw = salespersonName.trim();
  const needleBase = normalize(needleRaw);
  const needle = SALES_NAME_ALIASES[needleBase] ?? needleBase;
  if (!needle) return [];

  const { data, error } = await admin
    .from('users')
    .select('id, full_name, station_label')
    .eq('role', 'sales')
    .eq('is_active', true);
  if (error) throw error;
  const list = data ?? [];
  const exact = list.filter((u: { full_name?: string | null; station_label?: string | null }) => {
    const full = typeof u.full_name === 'string' ? normalize(u.full_name.trim()) : '';
    const station = typeof u.station_label === 'string' ? normalize(u.station_label.trim()) : '';
    return full === needle || station === needle;
  });
  if (exact.length > 0) {
    return exact.map((u: { id: number }) => u.id);
  }
  const fuzzy = list.filter((u: { full_name?: string | null; station_label?: string | null }) => {
    const full = typeof u.full_name === 'string' ? normalize(u.full_name.trim()) : '';
    const station = typeof u.station_label === 'string' ? normalize(u.station_label.trim()) : '';
    return (
      full.includes(needle) ||
      needle.includes(full) ||
      station.includes(needle) ||
      needle.includes(station)
    );
  });
  if (fuzzy.length > 0) {
    return fuzzy.map((u: { id: number }) => u.id);
  }
  console.warn(
    `send-internal-notification: no active sales user match for salesperson_name="${needleRaw}"`,
  );
  return [];
}

async function insertUserNotifications(
  admin: SupabaseClient,
  rows: Array<{
    user_id: number;
    title: string;
    body: string;
    type: string;
    order_id: number | null;
    payload: Record<string, unknown>;
  }>,
): Promise<void> {
  if (rows.length === 0) return;
  const { error } = await admin.from('user_notifications').insert(rows);
  if (error) throw error;
}

async function fetchPushSubscriptions(
  admin: SupabaseClient,
  cutoffIso: string,
  opts: { role: string } | { userIds: number[] },
): Promise<PushSubscriptionRow[]> {
  let q = admin
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth')
    .eq('enabled', true)
    .gte('last_seen_at', cutoffIso);

  if ('role' in opts) {
    q = q.eq('role', opts.role);
  } else {
    if (opts.userIds.length === 0) return [];
    q = q.in('user_id', opts.userIds);
  }

  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as PushSubscriptionRow[];
}

async function sendWebPushes(
  admin: SupabaseClient,
  subscriptions: PushSubscriptionRow[],
  message: {
    title: string;
    body: string;
    url: string;
    tag: string;
    payload: Record<string, unknown>;
  },
): Promise<{ sentCount: number; failedCount: number }> {
  let sentCount = 0;
  let failedCount = 0;

  for (const row of subscriptions) {
    try {
      await webpush.sendNotification(
        {
          endpoint: row.endpoint,
          keys: {
            p256dh: row.p256dh,
            auth: row.auth,
          },
        },
        JSON.stringify({
          type: message.payload.eventType ?? 'internal',
          title: message.title,
          body: message.body,
          url: message.url,
          tag: message.tag,
          ...message.payload,
        }),
      );
      sentCount += 1;
    } catch (error) {
      failedCount += 1;
      const statusCode =
        typeof error === 'object' &&
        error !== null &&
        'statusCode' in error &&
        typeof (error as { statusCode: unknown }).statusCode === 'number'
          ? (error as { statusCode: number }).statusCode
          : null;

      if (statusCode === 404 || statusCode === 410) {
        await admin
          .from('push_subscriptions')
          .update({ enabled: false, updated_at: new Date().toISOString() })
          .eq('id', row.id);
      }
    }
  }

  return { sentCount, failedCount };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (!supabaseUrl || !supabaseServiceRoleKey) {
    return json(500, { error: 'Supabase is not configured' });
  }

  const pushConfigured = !!(vapidSubject && vapidPublicKey && vapidPrivateKey);

  try {
    const raw = (await req.json()) as Record<string, unknown>;
    const eventType = raw.eventType as string | undefined;

    const admin = createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const cutoffIso = new Date(Date.now() - CUTOFF_MS).toISOString();

    if (eventType === 'order_ready_to_pick') {
      const payload = raw as Partial<InternalRequest>;
      if (
        typeof payload.orderId !== 'number' ||
        typeof payload.orderNumber !== 'string' ||
        typeof payload.customerName !== 'string' ||
        (payload.priority !== 'normal' && payload.priority !== 'urgent')
      ) {
        return json(400, { error: 'Invalid order_ready_to_pick payload' });
      }

      const targetUserId =
        typeof payload.targetUserId === 'number' && Number.isFinite(payload.targetUserId)
          ? payload.targetUserId
          : null;

      const isAssigned = targetUserId != null;

      const { data: orderRow, error: orderError } = await admin
        .from('orders')
        .select('workflow_status')
        .eq('id', payload.orderId)
        .maybeSingle();
      if (orderError) throw orderError;
      if (!orderRow) {
        return json(400, { error: 'Order not found' });
      }

      const workflowStatus = orderRow.workflow_status as string;
      if (isAssigned) {
        if (workflowStatus !== 'approved' && workflowStatus !== 'picking') {
          return json(200, {
            success: true,
            skipped: true,
            reason: 'pick_no_longer_open',
            workflow_status: workflowStatus,
          });
        }
      } else if (workflowStatus !== 'approved') {
        return json(200, {
          success: true,
          skipped: true,
          reason: 'not_in_pick_queue',
          workflow_status: workflowStatus,
        });
      }

      let pickingIds: number[];

      if (isAssigned) {
        const { data: targetUser, error: targetUserError } = await admin
          .from('users')
          .select('id')
          .eq('id', targetUserId)
          .eq('role', 'picking')
          .eq('is_active', true)
          .maybeSingle();
        if (targetUserError) throw targetUserError;
        if (!targetUser) {
          return json(400, { error: 'targetUserId is not an active picker' });
        }
        pickingIds = [targetUserId];
      } else {
        pickingIds = await fetchActiveUserIds(admin, 'picking');
        if (pickingIds.length === 0) {
          return json(200, { success: true, sentCount: 0, failedCount: 0, inboxCount: 0 });
        }
      }

      const title = isAssigned
        ? payload.priority === 'urgent'
          ? `Urgent — you're assigned: ${payload.orderNumber}`
          : `You're assigned: ${payload.orderNumber}`
        : payload.priority === 'urgent'
          ? `Urgent — ready to pick: ${payload.orderNumber}`
          : `Ready to pick: ${payload.orderNumber}`;
      const body = isAssigned
        ? payload.priority === 'urgent'
          ? `${payload.customerName} — tap to review your pick list.`
          : `${payload.customerName} is on your pick list — review before you start.`
        : payload.priority === 'urgent'
          ? `${payload.customerName} — review and start from the queue.`
          : `${payload.customerName} is in the pick queue.`;
      const deepLink = `/picking/preview/${payload.orderId}?source=${isAssigned ? 'assigned' : 'pool'}`;
      await insertUserNotifications(
        admin,
        pickingIds.map((user_id) => ({
          user_id,
          title,
          body,
          type: 'order_ready_to_pick',
          order_id: payload.orderId,
          payload: {
            eventType: 'order_ready_to_pick',
            orderNumber: payload.orderNumber,
            customerName: payload.customerName,
            priority: payload.priority,
            deep_link: deepLink,
            assigned: isAssigned,
          },
        })),
      );

      let sentCount = 0;
      let failedCount = 0;
      if (pushConfigured) {
        const subs = await fetchPushSubscriptions(
          admin,
          cutoffIso,
          isAssigned ? { userIds: pickingIds } : { role: 'picking' },
        );
        const r = await sendWebPushes(admin, subs, {
          title,
          body,
          url: deepLink,
          tag: `pick-order-${payload.orderId}`,
          payload: {
            eventType: 'order_ready_to_pick',
            orderId: payload.orderId,
            orderNumber: payload.orderNumber,
            customerName: payload.customerName,
            priority: payload.priority,
            approvedAt: payload.approvedAt ?? null,
          },
        });
        sentCount = r.sentCount;
        failedCount = r.failedCount;
      }

      await admin.from('notification_events').insert({
        event_type: 'order_ready_to_pick',
        order_id: payload.orderId,
        payload: raw,
        target_role: 'picking',
        sent_count: sentCount,
        failed_count: failedCount,
      });

      return json(200, { success: true, sentCount, failedCount, inboxCount: pickingIds.length });
    }

    if (eventType === 'pick_complete_reminder') {
      const payload = raw as Partial<Extract<InternalRequest, { eventType: 'pick_complete_reminder' }>>;
      if (
        typeof payload.orderId !== 'number' ||
        typeof payload.orderNumber !== 'string' ||
        typeof payload.customerName !== 'string' ||
        (payload.priority !== 'normal' && payload.priority !== 'urgent') ||
        typeof payload.targetUserId !== 'number' ||
        (payload.kind !== 'all_done' && payload.kind !== 'stalled') ||
        typeof payload.linesDone !== 'number' ||
        typeof payload.linesTotal !== 'number' ||
        typeof payload.linesRemaining !== 'number'
      ) {
        return json(400, { error: 'Invalid pick_complete_reminder payload' });
      }

      const { data: orderRow, error: orderError } = await admin
        .from('orders')
        .select('workflow_status')
        .eq('id', payload.orderId)
        .maybeSingle();
      if (orderError) throw orderError;
      if (!orderRow || orderRow.workflow_status !== 'picking') {
        return json(200, { success: true, skipped: true, reason: 'not_picking' });
      }

      const cooldownIso = new Date(Date.now() - PICK_REMINDER_COOLDOWN_MS).toISOString();
      const { data: recentReminders, error: recentError } = await admin
        .from('notification_events')
        .select('id')
        .eq('order_id', payload.orderId)
        .eq('event_type', 'pick_complete_reminder')
        .gte('created_at', cooldownIso)
        .limit(1);
      if (recentError) throw recentError;
      if ((recentReminders ?? []).length > 0) {
        return json(200, { success: true, skipped: true, reason: 'cooldown' });
      }

      const { data: targetUser, error: targetUserError } = await admin
        .from('users')
        .select('id')
        .eq('id', payload.targetUserId)
        .eq('role', 'picking')
        .eq('is_active', true)
        .maybeSingle();
      if (targetUserError) throw targetUserError;
      if (!targetUser) {
        return json(400, { error: 'targetUserId is not an active picker' });
      }

      const deepLink = `/picking?focusOrderId=${payload.orderId}`;
      const title = 'Did you complete this pick?';
      const body = `${payload.orderNumber} · ${payload.customerName}`;

      await insertUserNotifications(
        admin,
        [
          {
            user_id: payload.targetUserId,
            title,
            body,
            type: 'pick_complete_reminder',
            order_id: payload.orderId,
            payload: {
              eventType: 'pick_complete_reminder',
              kind: payload.kind,
              orderNumber: payload.orderNumber,
              customerName: payload.customerName,
              priority: payload.priority,
              deep_link: deepLink,
              linesDone: payload.linesDone,
              linesTotal: payload.linesTotal,
              linesRemaining: payload.linesRemaining,
            },
          },
        ],
      );

      let sentCount = 0;
      let failedCount = 0;
      if (pushConfigured) {
        const subs = await fetchPushSubscriptions(admin, cutoffIso, {
          userIds: [payload.targetUserId],
        });
        const r = await sendWebPushes(admin, subs, {
          title,
          body,
          url: deepLink,
          tag: `pick-reminder-${payload.orderId}`,
          payload: {
            eventType: 'pick_complete_reminder',
            kind: payload.kind,
            orderId: payload.orderId,
            orderNumber: payload.orderNumber,
            customerName: payload.customerName,
            priority: payload.priority,
          },
        });
        sentCount = r.sentCount;
        failedCount = r.failedCount;
      }

      await admin.from('notification_events').insert({
        event_type: 'pick_complete_reminder',
        order_id: payload.orderId,
        payload: raw,
        target_role: 'picking',
        sent_count: sentCount,
        failed_count: failedCount,
      });

      return json(200, { success: true, sentCount, failedCount, inboxCount: 1 });
    }

    if (eventType === 'item_flagged_by_picker') {
      const payload = raw as Partial<InternalRequest>;
      if (
        typeof payload.orderId !== 'number' ||
        typeof payload.orderNumber !== 'string' ||
        typeof payload.customerName !== 'string' ||
        typeof payload.itemName !== 'string' ||
        typeof payload.flagReason !== 'string' ||
        typeof payload.orderItemId !== 'number'
      ) {
        return json(400, { error: 'Invalid item_flagged_by_picker payload' });
      }

      const title = `Flag: ${payload.orderNumber}`;
      const body = `${payload.itemName} — ${payload.flagReason}`;

      const billingIds = await fetchActiveUserIds(admin, 'billing');
      const billingDeepLink = `/billing/review/${payload.orderId}`;
      await insertUserNotifications(
        admin,
        billingIds.map((user_id) => ({
          user_id,
          title,
          body,
          type: 'item_flagged_by_picker',
          order_id: payload.orderId,
          payload: {
            eventType: 'item_flagged_by_picker',
            orderNumber: payload.orderNumber,
            customerName: payload.customerName,
            itemName: payload.itemName,
            flagReason: payload.flagReason,
            pickerName: payload.pickerName ?? null,
            orderItemId: payload.orderItemId,
            deep_link: billingDeepLink,
          },
        })),
      );

      // Also notify sales (billing is typically desktop-only).
      const salesTarget = await getOrderSalespersonTarget(admin, payload.orderId);
      const salesIds = salesTarget.userId
        ? [salesTarget.userId]
        : salesTarget.salespersonName
          ? await resolveSalesUserIds(admin, salesTarget.salespersonName)
          : await fetchActiveUserIds(admin, 'sales');
      const salesDeepLink = `/sales/orders`;
      await insertUserNotifications(
        admin,
        salesIds.map((user_id) => ({
          user_id,
          title,
          body,
          type: 'item_flagged_by_picker',
          order_id: payload.orderId,
          payload: {
            eventType: 'item_flagged_by_picker',
            orderNumber: payload.orderNumber,
            customerName: payload.customerName,
            itemName: payload.itemName,
            flagReason: payload.flagReason,
            pickerName: payload.pickerName ?? null,
            orderItemId: payload.orderItemId,
            salespersonName: salesTarget.salespersonName,
            deep_link: salesDeepLink,
          },
        })),
      );

      let sentCount = 0;
      let failedCount = 0;
      if (pushConfigured) {
        const billingSubs = await fetchPushSubscriptions(admin, cutoffIso, { role: 'billing' });
        const billingResult = await sendWebPushes(admin, billingSubs, {
          title,
          body: pushBodyPreview(body),
          url: billingDeepLink,
          tag: `flag-${payload.orderId}-${payload.orderItemId}`,
          payload: {
            eventType: 'item_flagged_by_picker',
            orderId: payload.orderId,
            orderNumber: payload.orderNumber,
            orderItemId: payload.orderItemId,
          },
        });
        sentCount += billingResult.sentCount;
        failedCount += billingResult.failedCount;

        const salesSubs = await fetchPushSubscriptions(admin, cutoffIso, { userIds: salesIds });
        const salesResult = await sendWebPushes(admin, salesSubs, {
          title,
          body: pushBodyPreview(body),
          url: salesDeepLink,
          tag: `flag-sales-${payload.orderId}-${payload.orderItemId}`,
          payload: {
            eventType: 'item_flagged_by_picker',
            orderId: payload.orderId,
            orderNumber: payload.orderNumber,
            orderItemId: payload.orderItemId,
          },
        });
        sentCount += salesResult.sentCount;
        failedCount += salesResult.failedCount;
      }

      await admin.from('notification_events').insert({
        event_type: 'item_flagged_by_picker',
        order_id: payload.orderId,
        payload: raw,
        target_role: 'broadcast',
        sent_count: sentCount,
        failed_count: failedCount,
      });

      return json(200, {
        success: true,
        sentCount,
        failedCount,
        inboxCount: billingIds.length + salesIds.length,
      });
    }

    if (eventType === 'order_update_for_sales') {
      const payload = raw as Partial<InternalRequest>;
      if (
        typeof payload.orderId !== 'number' ||
        typeof payload.orderNumber !== 'string' ||
        typeof payload.customerName !== 'string' ||
        typeof payload.salespersonName !== 'string' ||
        typeof payload.messageBody !== 'string'
      ) {
        return json(400, { error: 'Invalid order_update_for_sales payload' });
      }

      const title = `Order update · ${payload.customerName}`;
      const body = payload.messageBody.trim();
      const salesTarget = await getOrderSalespersonTarget(admin, payload.orderId);
      const resolvedSalespersonName = salesTarget.salespersonName ?? payload.salespersonName;
      const salesIds = salesTarget.userId
        ? [salesTarget.userId]
        : await resolveSalesUserIds(admin, resolvedSalespersonName);
      const deepLink = `/sales/orders`;
      await insertUserNotifications(
        admin,
        salesIds.map((user_id) => ({
          user_id,
          title,
          body,
          type: 'order_update_for_sales',
          order_id: payload.orderId,
          payload: {
            eventType: 'order_update_for_sales',
            orderNumber: payload.orderNumber,
            customerName: payload.customerName,
            salespersonName: resolvedSalespersonName,
            deep_link: deepLink,
            messageBody: body,
            billingCustomerUpdateId:
              typeof payload.billingCustomerUpdateId === 'number'
                ? payload.billingCustomerUpdateId
                : null,
          },
        })),
      );

      let sentCount = 0;
      let failedCount = 0;
      if (pushConfigured && salesIds.length > 0) {
        const subs = await fetchPushSubscriptions(admin, cutoffIso, { userIds: salesIds });
        const r = await sendWebPushes(admin, subs, {
          title,
          body: pushBodyPreview(body),
          url: deepLink,
          tag: `sales-order-${payload.orderId}`,
          payload: {
            eventType: 'order_update_for_sales',
            orderId: payload.orderId,
            orderNumber: payload.orderNumber,
          },
        });
        sentCount = r.sentCount;
        failedCount = r.failedCount;
      }

      await admin.from('notification_events').insert({
        event_type: 'order_update_for_sales',
        order_id: payload.orderId,
        payload: raw,
        target_role: 'sales',
        sent_count: sentCount,
        failed_count: failedCount,
      });

      return json(200, { success: true, sentCount, failedCount, inboxCount: salesIds.length });
    }

    return json(400, { error: 'Unknown or missing eventType' });
  } catch (error) {
    console.error('send-internal-notification error:', error);
    return json(500, { error: 'Failed to send internal notifications' });
  }
});
