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

    // Get Ikhode API URL from payment_gateways
    const { data: gateway, error: gatewayError } = await supabase
      .from("payment_gateways")
      .select("config, enabled")
      .eq("slug", "ikhode-bakong")
      .single();

    if (gatewayError || !gateway) {
      console.error("Ikhode gateway not configured:", gatewayError);
      return new Response(
        JSON.stringify({ error: "Ikhode Payment API not configured" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!gateway.enabled) {
      return new Response(
        JSON.stringify({ error: "Ikhode Payment API is disabled" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const config = gateway.config as { apiUrl: string; wsEnabled: boolean };
    const apiUrl = config.apiUrl;

    if (!apiUrl) {
      return new Response(
        JSON.stringify({ error: "Ikhode Payment API URL not set" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const body = await req.json();
    const { action, ...params } = body;

    console.log(`Ikhode Payment action: ${action}`, params);

    switch (action) {
      case "generate-khqr": {
        const { accountId, merchantName, merchantCity, amount, currency, transactionId } = params;

        const response = await fetch(`${apiUrl}/api/v1/generate-khqr`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            accountId,
            merchantName,
            merchantCity,
            amount,
            currency: currency || "USD",
            transactionId,
          }),
        });

        if (!response.ok) {
          const errorText = await response.text();
          console.error("Ikhode API error:", errorText);
          throw new Error(`API error: ${response.status}`);
        }

        const data = await response.json();
        console.log("KHQR generated:", data);

        return new Response(JSON.stringify(data), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "get-banks": {
        const response = await fetch(`${apiUrl}/api/v1/banks`);
        
        if (!response.ok) {
          throw new Error(`API error: ${response.status}`);
        }

        const banks = await response.json();
        
        return new Response(JSON.stringify({ banks }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "check-status": {
        const { transactionId } = params;
        
        // Check payment status - the Ikhode API may have different endpoints
        // For now, we check the order status in our database
        const { data: order } = await supabase
          .from("orders")
          .select("status")
          .eq("id", transactionId)
          .single();

        return new Response(
          JSON.stringify({ 
            status: order?.status || "pending",
            transactionId 
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case "get-config": {
        // Return the WebSocket URL and config for client-side connection
        return new Response(
          JSON.stringify({
            apiUrl,
            wsUrl: apiUrl.replace("http", "ws"),
            wsEnabled: config.wsEnabled,
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
