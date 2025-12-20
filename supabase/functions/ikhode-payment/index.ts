import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get Ikhode API config from payment_gateways
    const { data: gateway, error: gatewayError } = await supabase
      .from("payment_gateways")
      .select("config, enabled")
      .eq("slug", "ikhode-bakong")
      .maybeSingle();

    if (gatewayError) {
      console.error("Error fetching gateway config:", gatewayError);
      return new Response(
        JSON.stringify({ error: "Failed to fetch payment gateway config" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!gateway) {
      return new Response(
        JSON.stringify({ error: "Ikhode Payment gateway not configured. Please add it in admin settings." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!gateway.enabled) {
      return new Response(
        JSON.stringify({ error: "Ikhode Payment gateway is disabled" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const config = gateway.config as { 
      apiUrl: string; 
      wsPort?: number;
      webhookSecret?: string;
    };
    
    const apiUrl = config.apiUrl?.replace(/\/$/, ""); // Remove trailing slash

    if (!apiUrl) {
      return new Response(
        JSON.stringify({ error: "Ikhode Payment API URL not configured" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const body = await req.json();
    const { action, ...params } = body;

    console.log(`Ikhode Payment action: ${action}`, params);

    switch (action) {
      case "generate-khqr": {
        const { amount, orderId, email, username, invoiceId } = params;

        // Build the callback URL for the webhook
        const callbackUrl = `${supabaseUrl}/functions/v1/ikhode-webhook`;
        const webhookSecret = config.webhookSecret || Deno.env.get("IKHODE_WEBHOOK_SECRET") || "";

        // Generate a transaction ID
        const transactionId = `TXN-${orderId.slice(0, 8)}-${Date.now()}`;

        console.log(`Generating KHQR for amount: ${amount}, transactionId: ${transactionId}`);
        console.log(`Calling API: ${apiUrl}/generate-khqr`);

        const response = await fetch(`${apiUrl}/generate-khqr`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            amount: Number(amount),
            transactionId,
            email: email || "",
            username: username || "",
            callbackUrl,
            secret: webhookSecret,
          }),
        });

        if (!response.ok) {
          const errorText = await response.text();
          console.error("Ikhode API error:", response.status, errorText);
          throw new Error(`API error: ${response.status} - ${errorText}`);
        }

        const data = await response.json();
        console.log("KHQR generated successfully:", { transactionId, hasQrCode: !!data.qrCodeData });

        // Store the transaction reference in the order
        await supabase
          .from("orders")
          .update({ 
            notes: `Transaction ID: ${transactionId}`,
            server_details: {
              ...((await supabase.from("orders").select("server_details").eq("id", orderId).single()).data?.server_details || {}),
              paymentTransactionId: transactionId,
            }
          })
          .eq("id", orderId);

        return new Response(JSON.stringify({
          qrCodeData: data.qrCodeData,
          transactionId,
          amount,
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "check-status": {
        const { transactionId, orderId } = params;
        
        // Check payment status in our database
        const { data: order } = await supabase
          .from("orders")
          .select("status, notes")
          .eq("id", orderId || transactionId)
          .maybeSingle();

        return new Response(
          JSON.stringify({ 
            status: order?.status || "pending",
            transactionId: transactionId || orderId,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case "get-config": {
        // Build WebSocket URL from API URL
        const wsPort = config.wsPort || 8080;
        let wsUrl = "";
        
        if (apiUrl) {
          try {
            const url = new URL(apiUrl);
            const wsProtocol = url.protocol === "https:" ? "wss:" : "ws:";
            wsUrl = `${wsProtocol}//${url.hostname}:${wsPort}`;
          } catch (e) {
            console.error("Error parsing API URL for WebSocket:", e);
          }
        }

        return new Response(
          JSON.stringify({
            apiUrl,
            wsUrl,
            wsEnabled: !!wsUrl,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      default:
        return new Response(
          JSON.stringify({ error: `Unknown action: ${action}` }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    }
  } catch (error: any) {
    console.error("Ikhode Payment error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
