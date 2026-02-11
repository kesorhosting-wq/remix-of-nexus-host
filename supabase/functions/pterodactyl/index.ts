import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Use environment variables for Pterodactyl credentials
const PTERODACTYL_API_URL = Deno.env.get("PTERODACTYL_API_URL");
const PTERODACTYL_API_KEY = Deno.env.get("PTERODACTYL_API_KEY");

// ============= Helper: Better Error Parsing =============

async function handlePteroResponse(response: Response, context: string) {
  if (!response.ok) {
    const errorText = await response.text();
    console.error(`[Pterodactyl Error] ${context}: ${response.status} ${response.statusText}`);
    console.error(`[Pterodactyl Body] ${errorText}`);

    try {
      const errorJson = JSON.parse(errorText);
      if (errorJson.errors && Array.isArray(errorJson.errors)) {
        const messages = errorJson.errors.map((e: any) => e.detail || e.code).join("; ");
        throw new Error(`${context} failed: ${messages}`);
      }
    } catch (e) {
      // ignore JSON parse error
    }
    throw new Error(`${context} failed: ${errorText || response.statusText}`);
  }
  // Handle 204 No Content (common in Ptero API for deletes/actions)
  if (response.status === 204) return { success: true };
  return response.json();
}

// ============= Authorization Helpers =============

interface AuthResult {
  user: { id: string; email?: string };
  isAdmin: boolean;
}

async function getAuthUser(req: Request): Promise<AuthResult | null> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return null;

  const token = authHeader.replace("Bearer ", "");
  const anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const { data: { user }, error } = await anonClient.auth.getUser(token);
  
  if (error || !user) {
    console.log("Auth validation failed:", error?.message);
    return null;
  }

  const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const { data: isAdmin } = await serviceClient.rpc("has_role", {
    _user_id: user.id,
    _role: "admin",
  });

  return { user: { id: user.id, email: user.email }, isAdmin: !!isAdmin };
}

async function requireAdmin(req: Request): Promise<AuthResult> {
  const auth = await getAuthUser(req);
  if (!auth) throw new Error("Unauthorized: No valid authentication token");
  if (!auth.isAdmin) throw new Error("Forbidden: Admin access required");
  console.log(`Admin access granted for user: ${auth.user.id}`);
  return auth;
}

async function requireOrderOwner(req: Request, orderId: string): Promise<AuthResult> {
  const auth = await getAuthUser(req);
  if (!auth) throw new Error("Unauthorized: No valid authentication token");
  if (auth.isAdmin) return auth;
  
  const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const { data: order } = await serviceClient
    .from("orders")
    .select("user_id")
    .eq("id", orderId)
    .single();
  
  if (!order || order.user_id !== auth.user.id) {
    throw new Error("Forbidden: You don't own this order");
  }
  return auth;
}

// ============= Input Validation =============

const ALLOWED_ACTIONS = ["test", "get-panel-data", "create", "power", "suspend", "unsuspend", "terminate", "status", "reset-password", "sync-servers", "preview-sync"] as const;
const ALLOWED_POWER_SIGNALS = ["start", "stop", "restart", "kill"] as const;

function validateAction(action: unknown): typeof ALLOWED_ACTIONS[number] {
  if (typeof action !== "string" || !ALLOWED_ACTIONS.includes(action as any)) {
    throw new Error(`Invalid action. Must be one of: ${ALLOWED_ACTIONS.join(", ")}`);
  }
  return action as typeof ALLOWED_ACTIONS[number];
}

function validateUUID(value: unknown, fieldName: string): string {
  if (typeof value !== "string") throw new Error(`${fieldName} must be a string`);
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(value)) throw new Error(`${fieldName} must be a valid UUID`);
  return value;
}

function validateServerId(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 50) {
    throw new Error("serverId must be a non-empty string");
  }
  return value.replace(/[^a-zA-Z0-9-_]/g, ""); // Sanitize
}

function validateEmail(value: unknown): string {
  if (typeof value !== "string") throw new Error("email must be a string");
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(value) || value.length > 255) {
    throw new Error("Invalid email address");
  }
  return value;
}

function validatePowerSignal(value: unknown): string {
  if (typeof value !== "string" || !ALLOWED_POWER_SIGNALS.includes(value as any)) {
    throw new Error(`Invalid power signal. Must be one of: ${ALLOWED_POWER_SIGNALS.join(", ")}`);
  }
  return value;
}

// ============= Pterodactyl Config =============

function getPterodactylConfig() {
  if (!PTERODACTYL_API_URL || !PTERODACTYL_API_KEY) {
    throw new Error("Pterodactyl panel not configured. Please set PTERODACTYL_API_URL and PTERODACTYL_API_KEY secrets.");
  }
  
  let normalizedUrl = PTERODACTYL_API_URL.trim();
  while (normalizedUrl.endsWith('/')) {
    normalizedUrl = normalizedUrl.slice(0, -1);
  }
  if (normalizedUrl.endsWith('/api/application')) {
    normalizedUrl = normalizedUrl.replace(/\/api\/application$/, '');
  } else if (normalizedUrl.endsWith('/api')) {
    normalizedUrl = normalizedUrl.replace(/\/api$/, '');
  }
  
  return { apiUrl: normalizedUrl, apiKey: PTERODACTYL_API_KEY };
}

// ============= Main Handler =============

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    const body = await req.json();
    const action = validateAction(body.action);
    const { orderId, serverDetails, serverId, apiUrl: testApiUrl, apiKey: testApiKey } = body;

    console.log(`Executing Pterodactyl action: ${action}`);

    // ADMIN ONLY: Test connection
    if (action === "test") {
      await requireAdmin(req);
      if (typeof testApiKey !== "string" || testApiKey.length === 0) throw new Error("API key is required");
      return await handleTestConnection(testApiUrl, testApiKey, corsHeaders);
    }

    // ADMIN ONLY: Get panel data
    if (action === "get-panel-data") {
      await requireAdmin(req);
      const config = getPterodactylConfig();
      return await handleGetPanelData(config.apiUrl, config.apiKey, corsHeaders);
    }

    const config = getPterodactylConfig();
    const apiHeaders = {
      "Authorization": `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
      "Accept": "application/json",
    };

    switch (action) {
      case "create": {
        await requireAdmin(req);
        const validatedOrderId = validateUUID(orderId, "orderId");
        
        await supabase.from("orders").update({ 
          status: "provisioning",
          notes: "Server provisioning in progress..."
        }).eq("id", validatedOrderId);
        
        const createPromise = createServer(config.apiUrl, apiHeaders, validatedOrderId, serverDetails, supabase)
          .catch(async (err) => {
            console.error("Background server creation failed:", err);
            await supabase.from("orders").update({ 
              status: "failed",
              notes: `Server creation failed: ${err.message}`
            }).eq("id", validatedOrderId);
          });
        
        // @ts-ignore
        const runtime = (globalThis as any).EdgeRuntime;
        if (runtime?.waitUntil) {
          runtime.waitUntil(createPromise);
          return new Response(JSON.stringify({ success: true, message: "Provisioning started" }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        
        const result = await createPromise;
        return new Response(JSON.stringify(result), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      case "power": {
        const validatedServerId = validateServerId(serverId);
        const validatedSignal = validatePowerSignal(body.signal);
        
        // Look up by identifier (serverId)
        const { data: order } = await supabase.from("orders").select("id, user_id").eq("server_id", validatedServerId).single();
        if (order) await requireOrderOwner(req, order.id);
        else await requireAdmin(req);
        
        const result = await sendPowerSignal(config.apiUrl, config.apiKey, validatedServerId, validatedSignal);
        return new Response(JSON.stringify(result), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      case "suspend": {
        await requireAdmin(req);
        const validatedOrderId = validateUUID(body.orderId, "orderId");
        const result = await suspendServer(config.apiUrl, apiHeaders, validatedOrderId);
        await supabase.from("orders").update({ status: "suspended" }).eq("id", validatedOrderId);
        return new Response(JSON.stringify(result), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      case "unsuspend": {
        await requireAdmin(req);
        const validatedOrderId = validateUUID(body.orderId, "orderId");
        const result = await unsuspendServer(config.apiUrl, apiHeaders, validatedOrderId);
        await supabase.from("orders").update({ status: "active" }).eq("id", validatedOrderId);
        return new Response(JSON.stringify(result), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      case "terminate": {
        await requireAdmin(req);
        const validatedOrderId = validateUUID(body.orderId, "orderId");
        const result = await terminateServer(config.apiUrl, apiHeaders, validatedOrderId);
        await supabase.from("orders").update({ status: "terminated", server_id: null }).eq("id", validatedOrderId);
        return new Response(JSON.stringify(result), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      case "status": {
        const validatedServerId = validateServerId(serverId);
        const result = await getServerStatus(config.apiUrl, apiHeaders, validatedServerId);
        return new Response(JSON.stringify(result), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      default:
        throw new Error(`Unknown action: ${action}`);
    }
  } catch (error: any) {
    console.error("Pterodactyl API error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: error.message.includes("Forbidden") ? 403 : 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

// ============= Logic Implementation =============

async function createServer(apiUrl: string, headers: any, orderId: string, serverDetails: any, supabase: any) {
  console.log("Creating server for order:", orderId);

  const { data: order, error: orderError } = await supabase.from("orders").select("*").eq("id", orderId).single();
  if (orderError || !order) throw new Error("Order not found");
  if (order.server_id) return { success: true, serverId: order.server_id, skipped: true };

  // Get User Profile
  const { data: profile } = await supabase.from("profiles").select("email").eq("user_id", order.user_id).single();
  const userEmail = profile?.email;
  if (!userEmail) throw new Error("User email not found");

  const orderDetails = order.server_details || serverDetails || {};
  const item = orderDetails.items?.[0] || orderDetails;

  // Get Plan Config
  const { data: planConfig } = await supabase.from("game_plans").select("*").eq("plan_id", item.plan_id).maybeSingle();

  // 1. User Creation
  const pterodactylUser = await getOrCreateUser(apiUrl, headers, userEmail);

  // 2. Allocation
  const allocation = await findAvailableAllocation(apiUrl, headers, planConfig?.pterodactyl_node_id);

  // 3. Payload Construction
  const limits = {
    memory: parseSizeToMb(planConfig?.ram) || 1024,
    swap: 0,
    disk: parseSizeToMb(planConfig?.storage) || 10240,
    io: 500,
    cpu: parseCpuPercent(planConfig?.cpu) || 100
  };

  const payload = {
    name: item.server_name || `Server-${orderId.slice(0, 8)}`,
    user: pterodactylUser.id,
    external_id: orderId, // FIX: Linked for later management
    egg: Number(planConfig?.pterodactyl_egg_id || item.pterodactyl_egg_id || 1), // FIX: Number
    docker_image: planConfig?.pterodactyl_docker_image || "ghcr.io/pterodactyl/yolks:java_17",
    startup: planConfig?.pterodactyl_startup || "java -Xms128M -Xmx{{SERVER_MEMORY}}M -jar {{SERVER_JARFILE}}",
    environment: {
      SERVER_JARFILE: "server.jar",
      ...(planConfig?.pterodactyl_environment || {}),
    },
    limits: limits,
    feature_limits: { databases: 1, backups: 2, allocations: 1 },
    allocation: { default: allocation.id },
    start_on_completion: true // FIX: Auto-start
  };

  const response = await fetch(`${apiUrl}/api/application/servers`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });

  const serverData = await handlePteroResponse(response, "Create Server");
  const serverId = serverData.attributes.identifier;

  // Update Database
  await supabase.from("orders").update({
    server_id: serverId,
    status: "active",
    server_details: {
      ...orderDetails,
      pterodactyl_id: serverData.attributes.id,
      ip: allocation.ip,
      port: allocation.port
    }
  }).eq("id", orderId);

  return { success: true, serverId };
}

// ============= Supporting Functions =============

async function getOrCreateUser(apiUrl: string, headers: any, email: string) {
  const search = await fetch(`${apiUrl}/api/application/users?filter[email]=${encodeURIComponent(email)}`, { headers });
  const searchData = await search.json();
  if (searchData.data?.length > 0) return { id: searchData.data[0].attributes.id };

  const username = email.split("@")[0].replace(/[^a-z0-9]/gi, '') + Math.floor(Math.random() * 9999);
  const res = await fetch(`${apiUrl}/api/application/users`, {
    method: "POST",
    headers,
    body: JSON.stringify({ email, username, first_name: "Client", last_name: "User", password: Math.random().toString(36).slice(-12) })
  });
  const data = await handlePteroResponse(res, "Create User");
  return { id: data.attributes.id };
}

async function findAvailableAllocation(apiUrl: string, headers: any, nodeId?: number) {
  const nodesRes = await fetch(`${apiUrl}/api/application/nodes`, { headers });
  const nodesData = await nodesRes.json();
  const selectedNode = nodeId || nodesData.data[0]?.attributes.id;

  const allocRes = await fetch(`${apiUrl}/api/application/nodes/${selectedNode}/allocations`, { headers });
  const allocData = await allocRes.json();
  const available = allocData.data?.find((a: any) => !a.attributes.assigned);

  if (!available) throw new Error("No free allocations on selected node.");
  return { id: available.attributes.id, ip: available.attributes.ip, port: available.attributes.port };
}

// Management Logic using External ID
async function suspendServer(apiUrl: string, headers: any, orderId: string) {
  const server = await fetch(`${apiUrl}/api/application/servers/external/${orderId}`, { headers });
  const data = await handlePteroResponse(server, "Find Server");
  const res = await fetch(`${apiUrl}/api/application/servers/${data.attributes.id}/suspend`, { method: "POST", headers });
  return await handlePteroResponse(res, "Suspend Server");
}

async function unsuspendServer(apiUrl: string, headers: any, orderId: string) {
  const server = await fetch(`${apiUrl}/api/application/servers/external/${orderId}`, { headers });
  const data = await handlePteroResponse(server, "Find Server");
  const res = await fetch(`${apiUrl}/api/application/servers/${data.attributes.id}/unsuspend`, { method: "POST", headers });
  return await handlePteroResponse(res, "Unsuspend Server");
}

async function terminateServer(apiUrl: string, headers: any, orderId: string) {
  const server = await fetch(`${apiUrl}/api/application/servers/external/${orderId}`, { headers });
  const data = await handlePteroResponse(server, "Find Server");
  const res = await fetch(`${apiUrl}/api/application/servers/${data.attributes.id}`, { method: "DELETE", headers });
  return { success: true };
}

async function sendPowerSignal(apiUrl: string, apiKey: string, serverId: string, signal: string) {
  const res = await fetch(`${apiUrl}/api/client/servers/${serverId}/power`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ signal })
  });
  return await handlePteroResponse(res, `Power ${signal}`);
}

async function getServerStatus(apiUrl: string, headers: any, serverId: string) {
  const res = await fetch(`${apiUrl}/api/client/servers/${serverId}/resources`, { headers });
  return await handlePteroResponse(res, "Get Status");
}

// Utility Parsers
function parseSizeToMb(val: any) {
  if (!val) return null;
  const num = parseFloat(String(val).replace(/[^0-9.]/g, ""));
  if (String(val).toLowerCase().includes("gb")) return num * 1024;
  return num;
}

function parseCpuPercent(val: any) {
  if (!val) return null;
  const num = parseFloat(String(val).replace(/[^0-9.]/g, ""));
  return String(val).toLowerCase().includes("core") ? num * 100 : num;
}

// Admin Helpers
async function handleTestConnection(apiUrl: string, apiKey: string, cors: any) {
  const headers = { "Authorization": `Bearer ${apiKey}`, "Accept": "application/json" };
  const res = await fetch(`${apiUrl}/api/application/nodes`, { headers });
  const data = await res.json();
  return new Response(JSON.stringify({ success: res.ok, nodes: data.meta?.pagination?.total || 0 }), { headers: cors });
}

async function handleGetPanelData(apiUrl: string, apiKey: string, cors: any) {
  const headers = { "Authorization": `Bearer ${apiKey}`, "Accept": "application/json" };
  const [nestsRes, nodesRes] = await Promise.all([
    fetch(`${apiUrl}/api/application/nests?include=eggs`, { headers }),
    fetch(`${apiUrl}/api/application/nodes`, { headers })
  ]);
  const nests = await nestsRes.json();
  const nodes = await nodesRes.json();
  return new Response(JSON.stringify({ nests: nests.data, nodes: nodes.data }), { headers: cors });
}
