import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import webpush from 'npm:web-push@3.6.7';

type OrderPriority = 'normal' | 'urgent';

interface PickerPushRequest {
  eventType: 'order_ready_to_pick';
  orderId: number;
  orderNumber: string;
  customerName: string;
  priority: OrderPriority;
  approvedAt: string | null;
}

interface PushSubscriptionRow {
  id: number;
  endpoint: string;
  p256dh: string;
  auth: string;
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

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (
    !supabaseUrl ||
    !supabaseServiceRoleKey ||
    !vapidSubject ||
    !vapidPublicKey ||
    !vapidPrivateKey
  ) {
    return json(500, {
      error: 'Push notification secrets are not configured',
    });
  }

  try {
    const payload = (await req.json()) as Partial<PickerPushRequest>;

    if (
      payload.eventType !== 'order_ready_to_pick' ||
      typeof payload.orderId !== 'number' ||
      typeof payload.orderNumber !== 'string' ||
      typeof payload.customerName !== 'string' ||
      (payload.priority !== 'normal' && payload.priority !== 'urgent')
    ) {
      return json(400, { error: 'Invalid notification payload' });
    }

    const admin = createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const cutoffIso = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    const { data: subscriptions, error: subscriptionError } = await admin
      .from('push_subscriptions')
      .select('id, endpoint, p256dh, auth')
      .eq('role', 'picking')
      .eq('enabled', true)
      .gte('last_seen_at', cutoffIso);

    if (subscriptionError) {
      throw subscriptionError;
    }

    const rows = (subscriptions ?? []) as PushSubscriptionRow[];
    const title =
      payload.priority === 'urgent'
        ? `Urgent pick: ${payload.orderNumber}`
        : `Ready to pick: ${payload.orderNumber}`;
    const body =
      payload.priority === 'urgent'
        ? `${payload.customerName} needs attention in the warehouse.`
        : `${payload.customerName} is ready for picking.`;

    let sentCount = 0;
    let failedCount = 0;

    for (const row of rows) {
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
            type: payload.eventType,
            title,
            body,
            orderId: payload.orderId,
            orderNumber: payload.orderNumber,
            customerName: payload.customerName,
            priority: payload.priority,
            approvedAt: payload.approvedAt ?? null,
            url: `/picking?claimOrderId=${payload.orderId}`,
            tag: `pick-order-${payload.orderId}`,
          }),
        );
        sentCount += 1;
      } catch (error) {
        failedCount += 1;
        const statusCode =
          typeof error === 'object' &&
          error !== null &&
          'statusCode' in error &&
          typeof error.statusCode === 'number'
            ? error.statusCode
            : null;

        if (statusCode === 404 || statusCode === 410) {
          await admin
            .from('push_subscriptions')
            .update({ enabled: false, updated_at: new Date().toISOString() })
            .eq('id', row.id);
        }
      }
    }

    const { error: eventError } = await admin.from('notification_events').insert({
      event_type: payload.eventType,
      order_id: payload.orderId,
      payload,
      target_role: 'picking',
      sent_count: sentCount,
      failed_count: failedCount,
    });

    if (eventError) {
      console.error('Failed to log notification event', eventError);
    }

    return json(200, {
      success: true,
      sentCount,
      failedCount,
    });
  } catch (error) {
    console.error('send-picker-push error:', error);
    return json(500, { error: 'Failed to send picker notifications' });
  }
});
