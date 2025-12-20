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

    // Get Ikhode API config from payment_gateways (matching PHP extension config names)
    const { data: gateway, error: gatewayError } = await supabase
      .from("payment_gateways")
      .select("config, enabled")
      .eq("slug", "ikhode-bakong")
      .maybeSingle();

    if (gatewayError) {
      console.error("[Ikhode] Error fetching gateway config:", gatewayError);
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

    // Config matches PHP extension: node_api_url, websocket_url, webhook_secret
    const config = gateway.config as { 
      node_api_url: string; 
      websocket_url: string;
      webhook_secret: string;
    };
    
    const apiUrl = config.node_api_url?.replace(/\/$/, "");
    const wsUrl = config.websocket_url;
    const webhookSecret = config.webhook_secret || "";

    if (!apiUrl) {
      return new Response(
        JSON.stringify({ error: "Node.js API URL not configured" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const body = await req.json();
    const { action, ...params } = body;

    console.log(`[Ikhode] Action: ${action}`, params);

    switch (action) {
      case "generate-khqr": {
        // Matches PHP extension pay() method
        const { amount, invoiceId, email, username } = params;

        // Build callback URL exactly like PHP: url('/extensions/khqr/webhook/' . $invoice->id)
        // But we use our edge function: /functions/v1/ikhode-webhook/{invoiceId}
        const callbackUrl = `${supabaseUrl}/functions/v1/ikhode-webhook/${invoiceId}`;

        // KHQR billNumber has max 25 characters - shorten the UUID
        // Format: INV-{first8chars}-{timestamp_last6}
        const shortTransactionId = `INV-${invoiceId.slice(0, 8)}-${Date.now().toString().slice(-6)}`;

        console.log(`[Ikhode] Generating KHQR (matching PHP extension):`);
        console.log(`  - Amount: ${amount}`);
        console.log(`  - Invoice ID: ${invoiceId}`);
        console.log(`  - Short Transaction ID: ${shortTransactionId}`);
        console.log(`  - Email: ${email}`);
        console.log(`  - Username: ${username}`);
        console.log(`  - Callback URL: ${callbackUrl}`);
        console.log(`  - API Endpoint: ${apiUrl}/generate-khqr`);

        // Call Node.js API exactly like PHP extension does
        // PHP: Http::post("{$apiUrl}/generate-khqr", [...])
        const response = await fetch(`${apiUrl}/generate-khqr`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            amount: Number(amount),
            transactionId: shortTransactionId, // Shortened to fit KHQR billNumber limit (25 chars)
            email: email || "",
            username: username || "",
            callbackUrl,
            secret: webhookSecret,
          }),
        });

        if (!response.ok) {
          const errorText = await response.text();
          console.error(`[Ikhode] API error ${response.status}:`, errorText);
          // Match PHP error handling
          let errorMessage = "Failed to contact payment API. Check Node.js logs.";
          try {
            const errorJson = JSON.parse(errorText);
            errorMessage = errorJson.error || errorMessage;
          } catch {}
          return new Response(
            JSON.stringify({ error: errorMessage }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const data = await response.json();
        const qrCodeData = data.qrCodeData;

        if (!qrCodeData) {
          // Match PHP: 'Node.js API did not return a QR Code image data.'
          return new Response(
            JSON.stringify({ error: "Node.js API did not return a QR Code image data." }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        console.log(`[Ikhode] KHQR generated successfully`);

        // Return data for the view (matches PHP returning view with qrCodeData, wsUrl)
        return new Response(JSON.stringify({
          qrCodeData,
          wsUrl,
          invoiceId,
          amount,
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "check-status": {
        const { invoiceId } = params;
        
        // Check invoice status in our database
        const { data: invoice } = await supabase
          .from("invoices")
          .select("status")
          .eq("id", invoiceId)
          .maybeSingle();

        return new Response(
          JSON.stringify({ 
            status: invoice?.status === "paid" ? "paid" : "pending",
            invoiceId,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case "get-config": {
        console.log(`[Ikhode] Config - API: ${apiUrl}, WS: ${wsUrl}`);

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
    console.error("[Ikhode] Error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
