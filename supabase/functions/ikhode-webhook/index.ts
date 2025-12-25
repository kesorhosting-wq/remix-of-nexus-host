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
    // Extract invoice_id from URL path (matches PHP: /extensions/khqr/webhook/{invoice_id})
    const url = new URL(req.url);
    const pathParts = url.pathname.split("/");
    const invoiceIdFromPath = pathParts[pathParts.length - 1];
    
    console.log(`[Webhook] Received for Invoice #${invoiceIdFromPath}`);

    // 1. Get our stored secret from payment_gateways config
    const { data: gateway } = await supabase
      .from("payment_gateways")
      .select("config")
      .eq("slug", "ikhode-bakong")
      .maybeSingle();

    const expectedSecret = (gateway?.config as any)?.webhook_secret || "";

    // 2. Authorization Check (using Bearer token) - matches PHP
    const authHeader = req.headers.get("Authorization");
    const token = authHeader?.replace("Bearer ", "") || "";

    console.log(`[Webhook] Expected Secret: ${expectedSecret ? "[SET]" : "[NOT SET]"}`);
    console.log(`[Webhook] Received Token: ${token ? "[PROVIDED]" : "[MISSING]"}`);

    if (expectedSecret && token !== expectedSecret) {
      console.error("[Webhook] Unauthorized: Invalid secret key");
      return new Response(
        JSON.stringify({ status: "error", message: "Unauthorized: Invalid secret key." }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 3. Find the invoice
    let invoice = null;
    
    if (invoiceIdFromPath && invoiceIdFromPath !== "ikhode-webhook") {
      const { data } = await supabase
        .from("invoices")
        .select("*")
        .eq("id", invoiceIdFromPath)
        .maybeSingle();
      invoice = data;
    }

    // If not found by path, try to find by order_id matching invoiceId
    if (!invoice && invoiceIdFromPath) {
      const { data } = await supabase
        .from("invoices")
        .select("*")
        .eq("order_id", invoiceIdFromPath)
        .eq("status", "unpaid")
        .maybeSingle();
      invoice = data;
    }

    if (!invoice) {
      console.error(`[Webhook] Invoice not found: ${invoiceIdFromPath}`);
      return new Response(
        JSON.stringify({ status: "error", message: "Invoice not found or could not be resolved." }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[Webhook] Found Invoice: ${invoice.id}, Status: ${invoice.status}`);

    // 4. Already Paid Check - matches PHP
    if (invoice.status === "paid") {
      console.log(`[Webhook] Invoice already paid`);
      return new Response(
        JSON.stringify({ status: "success", message: "Invoice already paid." }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 5. Process Data from Node.js API
    // Node.js sends: { transaction_id, amount, fee }
    const payload = await req.json();
    console.log("[Webhook] Payload:", JSON.stringify(payload, null, 2));

    const transactionId = payload.transaction_id || payload.transactionId || "N/A";
    const amount = payload.amount || invoice.total;
    const fee = payload.fee || 0;

    console.log(`[Webhook] Processing payment - Amount: ${amount}, Tx ID: ${transactionId}, Fee: ${fee}`);

    // 6. Add Payment (equivalent to PHP ExtensionHelper::addPayment)
    try {
      // Update invoice to paid
      await supabase
        .from("invoices")
        .update({
          status: "paid",
          paid_at: new Date().toISOString(),
          payment_method: "KHQR Gateway",
          transaction_id: transactionId,
        })
        .eq("id", invoice.id);

      // Create payment record
      await supabase.from("payments").insert({
        user_id: invoice.user_id,
        invoice_id: invoice.id,
        amount: amount,
        currency: "USD",
        status: "completed",
        transaction_id: transactionId,
        gateway_response: payload,
      });

      console.log(`[Webhook] Payment successfully added for Invoice #${invoice.id}`);

      // 7. Handle order - either renew (if suspended/active) or provision (if pending/paid)
      if (invoice.order_id) {
        try {
          const { data: order } = await supabase
            .from("orders")
            .select("*")
            .eq("id", invoice.order_id)
            .single();

          if (order) {
            console.log(`[Webhook] Order status: ${order.status}`);
            
            // If server is suspended, unsuspend and renew the service
            if (order.status === "suspended") {
              console.log(`[Webhook] Order is suspended, triggering renewal/unsuspension for order: ${order.id}`);
              
              try {
                const { error: renewError } = await supabase.functions.invoke("renewal-reminder", {
                  body: { 
                    action: "renew", 
                    orderId: order.id,
                    paymentId: transactionId
                  },
                });

                if (renewError) {
                  console.error("[Webhook] Renewal/unsuspension error:", renewError);
                } else {
                  console.log(`[Webhook] Server unsuspended and renewed successfully`);
                }
              } catch (renewErr) {
                console.error("[Webhook] Renewal call error:", renewErr);
              }
            } 
            // If order is active, just update next_due_date (renewal payment)
            else if (order.status === "active" && order.server_id) {
              console.log(`[Webhook] Renewing active order: ${order.id}`);
              
              try {
                const { error: renewError } = await supabase.functions.invoke("renewal-reminder", {
                  body: { 
                    action: "renew", 
                    orderId: order.id,
                    paymentId: transactionId
                  },
                });

                if (renewError) {
                  console.error("[Webhook] Renewal error:", renewError);
                } else {
                  console.log(`[Webhook] Service renewed successfully`);
                }
              } catch (renewErr) {
                console.error("[Webhook] Renewal call error:", renewErr);
              }
            }
            // If pending, trigger new server provisioning
            else if (order.status === "pending" || order.status === "paid") {
              console.log(`[Webhook] Triggering server provisioning for order: ${order.id}`);
              
              // Update order status first
              await supabase
                .from("orders")
                .update({ 
                  status: "paid",
                  notes: `Payment confirmed via KHQR Gateway. Transaction: ${transactionId}`
                })
                .eq("id", order.id);
              
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
              }
            }
          }
        } catch (orderError) {
          console.error("[Webhook] Order handling error:", orderError);
        }
      }

      // 8. Send confirmation email
      try {
        await supabase.functions.invoke("send-email", {
          body: { action: "payment-confirmation", invoiceId: invoice.id }
        });
        console.log(`[Webhook] Confirmation email triggered`);
      } catch (emailError) {
        console.error("[Webhook] Email error:", emailError);
      }

      // 9. Success response - matches PHP
      return new Response(
        JSON.stringify({ status: "success", message: "Payment recorded successfully." }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );

    } catch (paymentError: any) {
      // 10. Catch any failure - matches PHP
      console.error(`[Webhook] FATAL PAYMENT ERROR for Invoice #${invoice.id}:`, paymentError);
      return new Response(
        JSON.stringify({ status: "error", message: "Internal Server Error during payment processing." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

  } catch (error: any) {
    console.error("[Webhook] Error:", error);
    return new Response(
      JSON.stringify({ status: "error", message: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
