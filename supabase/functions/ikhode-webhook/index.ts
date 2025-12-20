import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-webhook-signature",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const IKHODE_WEBHOOK_SECRET = Deno.env.get("IKHODE_WEBHOOK_SECRET");

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    const signature = req.headers.get("x-webhook-signature");
    const body = await req.text();
    const payload = JSON.parse(body);

    console.log("Ikhode webhook received:", JSON.stringify(payload, null, 2));

    // Verify signature if secret is configured
    if (IKHODE_WEBHOOK_SECRET && signature) {
      const isValid = await verifySignature(body, signature, IKHODE_WEBHOOK_SECRET);
      if (!isValid) {
        console.error("Invalid webhook signature");
        return new Response(
          JSON.stringify({ error: "Invalid signature" }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // Handle different event types
    const eventType = payload.type || payload.event || "payment_received";

    switch (eventType) {
      case "payment_received":
      case "payment.success":
      case "payment.completed": {
        await handlePaymentSuccess(supabase, payload);
        break;
      }

      case "payment.failed":
      case "payment_failed": {
        await handlePaymentFailed(supabase, payload);
        break;
      }

      case "payment.pending":
      case "payment_pending": {
        await handlePaymentPending(supabase, payload);
        break;
      }

      default:
        console.log(`Unknown event type: ${eventType}`);
    }

    return new Response(
      JSON.stringify({ success: true, received: true }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("Ikhode webhook error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

async function verifySignature(payload: string, signature: string, secret: string): Promise<boolean> {
  try {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign", "verify"]
    );

    const signatureBuffer = hexToArrayBuffer(signature);
    const payloadBuffer = encoder.encode(payload);

    return await crypto.subtle.verify("HMAC", key, signatureBuffer, payloadBuffer);
  } catch (error) {
    console.error("Signature verification error:", error);
    return false;
  }
}

function hexToArrayBuffer(hex: string): ArrayBuffer {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
  }
  return bytes.buffer;
}

async function handlePaymentSuccess(supabase: any, payload: any) {
  const transactionId = payload.transactionId || payload.transaction_id || payload.md || payload.orderId;
  const amount = payload.amount;
  const currency = payload.currency || "USD";
  const paymentMethod = payload.paymentMethod || payload.payment_method || "ikhode-khqr";

  console.log(`Processing successful payment: ${transactionId}, Amount: ${amount} ${currency}`);

  // Find order by transaction ID pattern (TXN-{orderId}-{timestamp})
  let orderId = transactionId;
  if (transactionId.startsWith("TXN-")) {
    const parts = transactionId.split("-");
    if (parts.length >= 2) {
      orderId = parts[1];
    }
  }

  // Try to find order
  const { data: order, error: orderError } = await supabase
    .from("orders")
    .select("*, invoices(*)")
    .or(`id.eq.${orderId},id.ilike.${orderId}%`)
    .eq("status", "pending")
    .maybeSingle();

  if (orderError || !order) {
    // Try finding by checking notes or server_details
    const { data: orders } = await supabase
      .from("orders")
      .select("*, invoices(*)")
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(10);

    // Find matching order
    const matchingOrder = orders?.find((o: any) => {
      const notes = o.notes || "";
      return notes.includes(transactionId) || o.id.startsWith(orderId);
    });

    if (!matchingOrder) {
      console.log(`No pending order found for transaction: ${transactionId}`);
      
      // Create a payment record anyway for tracking
      await supabase.from("payments").insert({
        user_id: payload.userId || "00000000-0000-0000-0000-000000000000",
        amount: amount || 0,
        currency,
        status: "completed",
        transaction_id: transactionId,
        gateway_response: payload,
      });
      
      return;
    }

    await processOrderPayment(supabase, matchingOrder, transactionId, paymentMethod, payload);
  } else {
    await processOrderPayment(supabase, order, transactionId, paymentMethod, payload);
  }
}

async function processOrderPayment(supabase: any, order: any, transactionId: string, paymentMethod: string, payload: any) {
  console.log(`Processing order payment: ${order.id}`);

  // Update order status
  await supabase
    .from("orders")
    .update({ 
      status: "paid",
      notes: `Payment received via ${paymentMethod}. Transaction: ${transactionId}`
    })
    .eq("id", order.id);

  // Find and update invoice
  const { data: invoice } = await supabase
    .from("invoices")
    .select("*")
    .eq("order_id", order.id)
    .eq("status", "unpaid")
    .maybeSingle();

  if (invoice) {
    await supabase
      .from("invoices")
      .update({
        status: "paid",
        paid_at: new Date().toISOString(),
        payment_method: paymentMethod,
        transaction_id: transactionId,
      })
      .eq("id", invoice.id);

    // Create payment record
    await supabase.from("payments").insert({
      user_id: order.user_id,
      invoice_id: invoice.id,
      amount: invoice.total,
      currency: payload.currency || "USD",
      status: "completed",
      transaction_id: transactionId,
      gateway_response: payload,
    });

    // Trigger invoice confirmation email
    try {
      await supabase.functions.invoke("invoice-generator", {
        body: { action: "payment-confirmed", invoiceId: invoice.id }
      });
    } catch (emailError) {
      console.error("Failed to send confirmation email:", emailError);
    }
  }

  // Trigger server provisioning
  try {
    const { error: provisionError } = await supabase.functions.invoke("pterodactyl", {
      body: { 
        action: "create", 
        orderId: order.id, 
        serverDetails: order.server_details 
      },
    });

    if (provisionError) {
      console.error("Server provisioning error:", provisionError);
    } else {
      console.log(`Server provisioning triggered for order: ${order.id}`);
    }
  } catch (pterodactylError) {
    console.error("Pterodactyl call error:", pterodactylError);
  }

  console.log(`Payment processed successfully for order: ${order.id}`);
}

async function handlePaymentFailed(supabase: any, payload: any) {
  const transactionId = payload.transactionId || payload.transaction_id;
  console.log(`Payment failed: ${transactionId}`);

  // Create failed payment record
  await supabase.from("payments").insert({
    user_id: payload.userId || "00000000-0000-0000-0000-000000000000",
    amount: payload.amount || 0,
    currency: payload.currency || "USD",
    status: "failed",
    transaction_id: transactionId,
    gateway_response: payload,
  });
}

async function handlePaymentPending(supabase: any, payload: any) {
  const transactionId = payload.transactionId || payload.transaction_id;
  console.log(`Payment pending: ${transactionId}`);

  // Create pending payment record
  await supabase.from("payments").insert({
    user_id: payload.userId || "00000000-0000-0000-0000-000000000000",
    amount: payload.amount || 0,
    currency: payload.currency || "USD",
    status: "pending",
    transaction_id: transactionId,
    gateway_response: payload,
  });
}
