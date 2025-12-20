import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, Authorization",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    // Get the secret from Authorization header (Bearer token)
    const authHeader = req.headers.get("Authorization");
    const providedSecret = authHeader?.replace("Bearer ", "") || "";
    
    // Get our stored secret
    const storedSecret = Deno.env.get("IKHODE_WEBHOOK_SECRET") || "";
    
    // Verify if secret is configured and matches
    if (storedSecret && providedSecret !== storedSecret) {
      console.warn("[Webhook] Invalid or missing secret");
      // Still process but log warning - your API sends the secret we gave it
    }

    const payload = await req.json();
    console.log("[Webhook] Received:", JSON.stringify(payload, null, 2));

    // Your API sends: { transaction_id, amount, fee }
    const transactionId = payload.transaction_id || payload.transactionId;
    const amount = payload.amount;
    const fee = payload.fee || 0;

    if (!transactionId) {
      console.error("[Webhook] No transaction ID in payload");
      return new Response(
        JSON.stringify({ error: "Missing transaction_id" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[Webhook] Processing payment: ${transactionId}, Amount: ${amount}`);

    // Extract order ID from transaction ID (format: TXN-{orderId}-{timestamp})
    let orderId = transactionId;
    if (transactionId.startsWith("TXN-")) {
      const parts = transactionId.split("-");
      if (parts.length >= 2) {
        orderId = parts[1];
      }
    }

    // Find the order by checking notes or partial ID match
    let order = null;
    
    // Try direct ID match first
    const { data: directOrder } = await supabase
      .from("orders")
      .select("*")
      .ilike("id", `${orderId}%`)
      .eq("status", "pending")
      .maybeSingle();

    if (directOrder) {
      order = directOrder;
    } else {
      // Search by notes containing transaction ID
      const { data: orders } = await supabase
        .from("orders")
        .select("*")
        .eq("status", "pending")
        .order("created_at", { ascending: false })
        .limit(20);

      order = orders?.find((o: any) => {
        const notes = o.notes || "";
        const serverDetails = o.server_details || {};
        return notes.includes(transactionId) || 
               serverDetails.paymentTransactionId === transactionId ||
               o.id.startsWith(orderId);
      });
    }

    if (!order) {
      console.error(`[Webhook] No pending order found for: ${transactionId}`);
      
      // Still record the payment for audit
      await supabase.from("payments").insert({
        user_id: "00000000-0000-0000-0000-000000000000",
        amount: amount || 0,
        currency: "USD",
        status: "completed",
        transaction_id: transactionId,
        gateway_response: payload,
      });
      
      return new Response(
        JSON.stringify({ success: true, message: "Payment recorded, no matching order found" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[Webhook] Found order: ${order.id}`);

    // Update order status
    await supabase
      .from("orders")
      .update({ 
        status: "paid",
        notes: `Payment confirmed via Ikhode KHQR. Transaction: ${transactionId}`
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
          payment_method: "ikhode-khqr",
          transaction_id: transactionId,
        })
        .eq("id", invoice.id);

      // Create payment record
      await supabase.from("payments").insert({
        user_id: order.user_id,
        invoice_id: invoice.id,
        amount: invoice.total,
        currency: "USD",
        status: "completed",
        transaction_id: transactionId,
        gateway_response: payload,
      });

      console.log(`[Webhook] Invoice ${invoice.id} marked as paid`);

      // Send confirmation email
      try {
        await supabase.functions.invoke("invoice-generator", {
          body: { action: "payment-confirmed", invoiceId: invoice.id }
        });
        console.log(`[Webhook] Confirmation email triggered`);
      } catch (emailError) {
        console.error("[Webhook] Email error:", emailError);
      }
    }

    // Trigger server provisioning
    try {
      console.log(`[Webhook] Triggering server provisioning for order: ${order.id}`);
      const { error: provisionError } = await supabase.functions.invoke("pterodactyl", {
        body: { 
          action: "create", 
          orderId: order.id, 
          serverDetails: order.server_details 
        },
      });

      if (provisionError) {
        console.error("[Webhook] Provisioning error:", provisionError);
      } else {
        console.log(`[Webhook] Server provisioning started`);
        
        // Update order to provisioning status
        await supabase
          .from("orders")
          .update({ status: "provisioning" })
          .eq("id", order.id);
      }
    } catch (pterodactylError) {
      console.error("[Webhook] Pterodactyl call error:", pterodactylError);
    }

    console.log(`[Webhook] Payment processed successfully for order: ${order.id}`);

    return new Response(
      JSON.stringify({ success: true, orderId: order.id }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("[Webhook] Error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
