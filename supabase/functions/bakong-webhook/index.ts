import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BAKONG_WEBHOOK_SECRET = Deno.env.get("BAKONG_WEBHOOK_SECRET");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

// Constant-time string comparison to prevent timing attacks
function secureCompare(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

// Convert ArrayBuffer to hex string
function arrayBufferToHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

// Verify webhook signature using HMAC-SHA256
async function verifySignature(payload: string, signature: string, secret: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  
  const signatureBuffer = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(payload)
  );
  
  const expectedSignature = arrayBufferToHex(signatureBuffer);
  return secureCompare(expectedSignature, signature.toLowerCase());
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

  try {
    // Read raw body for signature verification
    const rawBody = await req.text();
    console.log("Received Bakong webhook request");

    // Get signature from header
    const signature = req.headers.get("x-bakong-signature");
    
    // Verify webhook signature - REQUIRED for security
    if (!BAKONG_WEBHOOK_SECRET) {
      console.error("BAKONG_WEBHOOK_SECRET not configured");
      return new Response(
        JSON.stringify({ error: "Webhook secret not configured" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (!signature) {
      console.error("Missing webhook signature");
      return new Response(
        JSON.stringify({ error: "Missing signature" }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const isValidSignature = await verifySignature(rawBody, signature, BAKONG_WEBHOOK_SECRET);
    if (!isValidSignature) {
      console.error("Invalid webhook signature - potential forged request");
      return new Response(
        JSON.stringify({ error: "Invalid signature" }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    console.log("Webhook signature verified successfully");

    // Parse payload after signature verification
    const payload = JSON.parse(rawBody);
    console.log("Received Bakong webhook:", JSON.stringify(payload));

    const { transactionId, status, amount, currency, reference, timestamp } = payload;

    if (!transactionId) {
      throw new Error("Missing transactionId in webhook payload");
    }

    // Optional: Check timestamp to prevent replay attacks (within 5 minutes)
    if (timestamp) {
      const webhookTime = new Date(timestamp).getTime();
      const now = Date.now();
      const fiveMinutes = 5 * 60 * 1000;
      
      if (Math.abs(now - webhookTime) > fiveMinutes) {
        console.error("Webhook timestamp too old - potential replay attack");
        return new Response(
          JSON.stringify({ error: "Webhook expired" }),
          {
            status: 401,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }
    }

    // Find the order by transaction ID
    const { data: order, error: orderError } = await supabase
      .from("orders")
      .select("*")
      .eq("id", transactionId)
      .single();

    if (orderError || !order) {
      console.error("Order not found:", transactionId);
      throw new Error("Order not found");
    }

    // Update payment record
    const { error: paymentError } = await supabase
      .from("payments")
      .update({
        status: status === "SUCCESS" ? "completed" : "failed",
        transaction_id: reference || transactionId,
        gateway_response: payload,
      })
      .eq("transaction_id", transactionId);

    if (paymentError) {
      console.error("Error updating payment:", paymentError);
    }

    if (status === "SUCCESS") {
      // Update invoice status
      const { error: invoiceError } = await supabase
        .from("invoices")
        .update({ 
          status: "paid",
          paid_at: new Date().toISOString(),
          payment_method: "bakong",
          transaction_id: reference || transactionId,
        })
        .eq("order_id", transactionId);

      if (invoiceError) {
        console.error("Error updating invoice:", invoiceError);
      }

      console.log("Payment successful, processing order:", transactionId);
      console.log("Order status:", order.status);

      // Handle based on order status
      if (order.status === "suspended") {
        // Unsuspend and renew the service
        console.log("Order is suspended, triggering renewal/unsuspension");
        
        try {
          const renewResponse = await fetch(
            `${SUPABASE_URL}/functions/v1/renewal-reminder`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
              },
              body: JSON.stringify({
                action: "renew",
                orderId: transactionId,
                paymentId: reference || transactionId,
              }),
            }
          );

          const renewResult = await renewResponse.json();
          console.log("Renewal/unsuspension result:", renewResult);
        } catch (renewError) {
          console.error("Error triggering renewal:", renewError);
        }
      } else if (order.status === "active" && order.server_id) {
        // Renew active service (extend due date)
        console.log("Renewing active service");
        
        try {
          const renewResponse = await fetch(
            `${SUPABASE_URL}/functions/v1/renewal-reminder`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
              },
              body: JSON.stringify({
                action: "renew",
                orderId: transactionId,
                paymentId: reference || transactionId,
              }),
            }
          );

          const renewResult = await renewResponse.json();
          console.log("Renewal result:", renewResult);
        } catch (renewError) {
          console.error("Error triggering renewal:", renewError);
        }
      } else if (order.status === "pending" || order.status === "paid") {
        // New order - trigger server provisioning
        console.log("New order, triggering server provisioning");
        
        // Update order status
        await supabase
          .from("orders")
          .update({ status: "paid" })
          .eq("id", transactionId);

        try {
          const pterodactylResponse = await fetch(
            `${SUPABASE_URL}/functions/v1/pterodactyl`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
              },
              body: JSON.stringify({
                action: "create",
                orderId: transactionId,
                serverDetails: order.server_details,
              }),
            }
          );

          const pterodactylResult = await pterodactylResponse.json();
          console.log("Pterodactyl provisioning result:", pterodactylResult);
        } catch (provisionError) {
          console.error("Error triggering server provisioning:", provisionError);
        }
      }
    }

    return new Response(
      JSON.stringify({ success: true, message: "Webhook processed" }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error: any) {
    console.error("Webhook error:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
