import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Helper function to verify authentication
async function getAuthenticatedUser(req: Request, supabase: any): Promise<{ userId: string; email: string } | null> {
  const authHeader = req.headers.get("authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return null;
  }

  const token = authHeader.replace("Bearer ", "");
  
  try {
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) {
      console.log("[Ikhode] Auth error:", error?.message);
      return null;
    }
    return { userId: user.id, email: user.email || "" };
  } catch (error) {
    console.error("[Ikhode] Auth verification failed:", error);
    return null;
  }
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    
    // Use anon key for auth verification, service role for database operations
    const supabaseAuth = createClient(supabaseUrl, supabaseAnonKey);
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

    // Config matches PHP extension: node_api_url, websocket_url, webhook_secret, custom_webhook_url
    const config = gateway.config as { 
      node_api_url: string; 
      websocket_url: string;
      webhook_secret: string;
      custom_webhook_url?: string;
    };
    
    const apiUrl = config.node_api_url?.replace(/\/$/, "");
    const wsUrl = config.websocket_url;
    const webhookSecret = config.webhook_secret || "";
    const customWebhookUrl = config.custom_webhook_url || "";

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
        // SECURITY: Require authentication for payment generation
        const authUser = await getAuthenticatedUser(req, supabaseAuth);
        if (!authUser) {
          console.log("[Ikhode] Unauthorized attempt to generate KHQR");
          return new Response(
            JSON.stringify({ error: "Authentication required to generate payment" }),
            { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // Matches PHP extension pay() method
        const { amount, invoiceId, email, username } = params;

        // SECURITY: Verify the invoice belongs to the authenticated user
        const { data: invoice, error: invoiceError } = await supabase
          .from("invoices")
          .select("id, user_id, total, status")
          .eq("id", invoiceId)
          .maybeSingle();

        if (invoiceError || !invoice) {
          console.log("[Ikhode] Invoice not found:", invoiceId);
          return new Response(
            JSON.stringify({ error: "Invoice not found" }),
            { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        if (invoice.user_id !== authUser.userId) {
          console.log("[Ikhode] User attempting to pay for another user's invoice");
          return new Response(
            JSON.stringify({ error: "You can only pay for your own invoices" }),
            { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        if (invoice.status === "paid") {
          return new Response(
            JSON.stringify({ error: "This invoice has already been paid" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // SECURITY: Validate amount matches invoice total
        if (Number(amount) !== Number(invoice.total)) {
          console.log(`[Ikhode] Amount mismatch: requested ${amount}, invoice total ${invoice.total}`);
          return new Response(
            JSON.stringify({ error: "Payment amount does not match invoice total" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // Build callback URL - use custom URL if configured, otherwise default
        // Default format: /functions/v1/ikhode-webhook/{invoiceId}
        const defaultCallbackUrl = `${supabaseUrl}/functions/v1/ikhode-webhook/${invoiceId}`;
        const callbackUrl = customWebhookUrl 
          ? customWebhookUrl.replace("{invoice_id}", invoiceId)
          : defaultCallbackUrl;

        // KHQR billNumber has max 25 characters - shorten the UUID
        // Format: INV-{first8chars}-{timestamp_last6}
        const shortTransactionId = `INV-${invoiceId.slice(0, 8)}-${Date.now().toString().slice(-6)}`;

        console.log(`[Ikhode] Generating KHQR for authenticated user ${authUser.userId}:`);
        console.log(`  - Amount: ${amount}`);
        console.log(`  - Invoice ID: ${invoiceId}`);
        console.log(`  - Short Transaction ID: ${shortTransactionId}`);
        console.log(`  - Callback URL: ${callbackUrl}`);

        // Call Node.js API exactly like PHP extension does
        // PHP: Http::post("{$apiUrl}/generate-khqr", [...])
        const response = await fetch(`${apiUrl}/generate-khqr`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            amount: Number(amount),
            transactionId: shortTransactionId, // Shortened to fit KHQR billNumber limit (25 chars)
            email: email || authUser.email,
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

        console.log(`[Ikhode] KHQR generated successfully for user ${authUser.userId}`);

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
        // SECURITY: Require authentication for status check
        const authUser = await getAuthenticatedUser(req, supabaseAuth);
        if (!authUser) {
          return new Response(
            JSON.stringify({ error: "Authentication required" }),
            { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const { invoiceId } = params;
        
        // Check invoice status - only allow users to check their own invoices
        const { data: invoice } = await supabase
          .from("invoices")
          .select("status, user_id")
          .eq("id", invoiceId)
          .maybeSingle();

        if (!invoice) {
          return new Response(
            JSON.stringify({ error: "Invoice not found" }),
            { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        if (invoice.user_id !== authUser.userId) {
          return new Response(
            JSON.stringify({ error: "You can only check your own invoices" }),
            { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        return new Response(
          JSON.stringify({ 
            status: invoice?.status === "paid" ? "paid" : "pending",
            invoiceId,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case "get-config": {
        // This is a public endpoint - no auth required
        // Only returns non-sensitive config info
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
