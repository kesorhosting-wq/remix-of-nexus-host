import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Use environment variables for Pterodactyl credentials (more secure than database storage)
const PTERODACTYL_API_URL = Deno.env.get("PTERODACTYL_API_URL");
const PTERODACTYL_API_KEY = Deno.env.get("PTERODACTYL_API_KEY");

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

function validateUrl(value: unknown): string {
  if (typeof value !== "string") throw new Error("URL must be a string");
  try {
    new URL(value);
  } catch {
    throw new Error("Invalid URL format");
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
  
  console.log(`Pterodactyl API URL (normalized): ${normalizedUrl}`);
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

    console.log(`Pterodactyl action: ${action}`);

    // For test action, use provided credentials (admin testing before saving)
    // ADMIN ONLY: Test connection requires admin privileges
    if (action === "test") {
      await requireAdmin(req);
      const validatedUrl = validateUrl(testApiUrl);
      if (typeof testApiKey !== "string" || testApiKey.length === 0) {
        throw new Error("API key is required for testing");
      }
      return await handleTestConnection(validatedUrl, testApiKey, corsHeaders);
    }

    // ADMIN ONLY: Get panel data
    if (action === "get-panel-data") {
      await requireAdmin(req);
      const config = getPterodactylConfig();
      return await handleGetPanelData(config.apiUrl, config.apiKey, corsHeaders);
    }

    // Get config from environment variables for all other actions
    const config = getPterodactylConfig();
    const apiHeaders = {
      "Authorization": `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
      "Accept": "application/json",
    };

    switch (action) {
      case "create": {
        // ADMIN ONLY: Create server
        await requireAdmin(req);
        const validatedOrderId = validateUUID(orderId, "orderId");
        
        // Set status to provisioning immediately
        await supabase.from("orders").update({ 
          status: "provisioning",
          notes: "Server provisioning in progress..."
        }).eq("id", validatedOrderId);
        
        // Use background task for server creation to avoid timeout
        const createPromise = createServer(config.apiUrl, apiHeaders, validatedOrderId, serverDetails, supabase)
          .catch(async (err) => {
            console.error("Background server creation failed:", err);

            await appendProvisioningLog(supabase, validatedOrderId, {
              status: "failed",
              message: err.message || "Server creation failed",
              response: { message: err.message || "Server creation failed" },
            });
            
            // Update order status to failed
            await supabase.from("orders").update({ 
              status: "failed",
              notes: `Server creation failed: ${err.message}`
            }).eq("id", validatedOrderId);
            
            // Send provisioning failure email to admin
            try {
              console.log("Sending provisioning failure notification to admin...");
              await supabase.functions.invoke('send-email', {
                body: {
                  action: 'provisioning-failed',
                  orderId: validatedOrderId,
                  errorMessage: err.message,
                }
              });
              console.log("Provisioning failure email sent");
            } catch (emailErr) {
              console.error("Failed to send provisioning failure email:", emailErr);
            }
          });
        
        // @ts-ignore - EdgeRuntime is available in Supabase Edge Functions
        const runtime = (globalThis as any).EdgeRuntime;
        if (runtime?.waitUntil) {
          runtime.waitUntil(createPromise);
          return new Response(JSON.stringify({ 
            success: true, 
            message: "Server provisioning started",
            status: "provisioning"
          }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        
        const result = await createPromise;
        return new Response(JSON.stringify(result), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "power": {
        // USER: Power actions allowed for server owners
        const validatedServerId = validateServerId(serverId);
        const validatedSignal = validatePowerSignal(body.signal);
        
        // Find the order by server_id and verify ownership
        const { data: order } = await supabase
          .from("orders")
          .select("id, user_id")
          .eq("server_id", validatedServerId)
          .single();
        
        if (order) {
          await requireOrderOwner(req, order.id);
        } else {
          await requireAdmin(req); // If no order found, require admin
        }
        
        const result = await sendPowerSignal(config.apiUrl, config.apiKey, validatedServerId, validatedSignal);
        return new Response(JSON.stringify(result), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "suspend": {
        // ADMIN ONLY: Suspend server
        await requireAdmin(req);
        const validatedServerId = validateServerId(serverId);
        const result = await suspendServer(config.apiUrl, apiHeaders, validatedServerId);
        await supabase.from("orders").update({ status: "suspended" }).eq("server_id", validatedServerId);
        return new Response(JSON.stringify(result), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "unsuspend": {
        // ADMIN ONLY: Unsuspend server
        await requireAdmin(req);
        const validatedServerId = validateServerId(serverId);
        const result = await unsuspendServer(config.apiUrl, apiHeaders, validatedServerId);
        await supabase.from("orders").update({ status: "active" }).eq("server_id", validatedServerId);
        return new Response(JSON.stringify(result), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "terminate": {
        // ADMIN ONLY: Terminate server
        await requireAdmin(req);
        const validatedServerId = validateServerId(serverId);
        const result = await terminateServer(config.apiUrl, apiHeaders, validatedServerId);
        await supabase.from("orders").update({ status: "terminated", server_id: null }).eq("server_id", validatedServerId);
        return new Response(JSON.stringify(result), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "status": {
        // USER: Status check allowed for server owners
        const validatedServerId = validateServerId(serverId);
        
        const { data: order } = await supabase
          .from("orders")
          .select("id, user_id")
          .eq("server_id", validatedServerId)
          .single();
        
        if (order) {
          await requireOrderOwner(req, order.id);
        } else {
          await requireAdmin(req);
        }
        
        const result = await getServerStatus(config.apiUrl, apiHeaders, validatedServerId);
        return new Response(JSON.stringify(result), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "reset-password": {
        // ADMIN ONLY: Reset panel password
        await requireAdmin(req);
        const validatedEmail = validateEmail(body.email);
        const result = await resetUserPassword(config.apiUrl, apiHeaders, validatedEmail, supabase);
        return new Response(JSON.stringify(result), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "sync-servers": {
        // ADMIN ONLY: Sync all servers from Pterodactyl panel to orders with custom prices
        await requireAdmin(req);
        const serverPrices = body.serverPrices || {};
        const result = await syncServersFromPanel(config.apiUrl, apiHeaders, supabase, serverPrices);
        return new Response(JSON.stringify(result), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "preview-sync": {
        // ADMIN ONLY: Preview servers from Pterodactyl panel before syncing
        await requireAdmin(req);
        const result = await previewServersFromPanel(config.apiUrl, apiHeaders);
        return new Response(JSON.stringify(result), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      default:
        throw new Error(`Unknown action: ${action}`);
    }
  } catch (error: any) {
    console.error("Pterodactyl API error:", error);
    
    // Return appropriate HTTP status based on error type
    let status = 500;
    if (error.message.includes("Unauthorized")) status = 401;
    else if (error.message.includes("Forbidden")) status = 403;
    else if (error.message.includes("Invalid") || error.message.includes("must be")) status = 400;
    
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});

async function handleTestConnection(apiUrl: string, apiKey: string, corsHeaders: any) {
  try {
    const headers = {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "Accept": "application/json",
    };

    const [nodesRes, serversRes] = await Promise.all([
      fetch(`${apiUrl}/api/application/nodes`, { headers }),
      fetch(`${apiUrl}/api/application/servers`, { headers }),
    ]);

    if (!nodesRes.ok || !serversRes.ok) {
      throw new Error("Failed to connect to panel");
    }

    const nodesData = await nodesRes.json();
    const serversData = await serversRes.json();

    return new Response(JSON.stringify({
      success: true,
      nodes: nodesData.meta?.pagination?.total || nodesData.data?.length || 0,
      servers: serversData.meta?.pagination?.total || serversData.data?.length || 0,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
}

async function handleGetPanelData(apiUrl: string, apiKey: string, corsHeaders: any) {
  const headers = {
    "Authorization": `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    "Accept": "application/json",
  };

  try {
    // Fetch nests with eggs
    const nestsRes = await fetch(`${apiUrl}/api/application/nests?include=eggs`, { headers });
    const nodesRes = await fetch(`${apiUrl}/api/application/nodes`, { headers });

    if (!nestsRes.ok || !nodesRes.ok) {
      throw new Error("Failed to fetch panel data");
    }

    const nestsData = await nestsRes.json();
    const nodesData = await nodesRes.json();

    const nests = nestsData.data?.map((nest: any) => ({
      id: nest.attributes.id,
      name: nest.attributes.name,
      eggs: nest.attributes.relationships?.eggs?.data?.map((egg: any) => ({
        id: egg.attributes.id,
        name: egg.attributes.name,
        docker_image: egg.attributes.docker_image,
        startup: egg.attributes.startup,
      })) || [],
    })) || [];

    const nodes = nodesData.data?.map((node: any) => ({
      id: node.attributes.id,
      name: node.attributes.name,
      memory: node.attributes.memory,
      disk: node.attributes.disk,
    })) || [];

    return new Response(JSON.stringify({ nests, nodes }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
}

async function createServer(
  apiUrl: string,
  headers: Record<string, string>,
  orderId: string,
  serverDetails: any,
  supabase: any
) {
  console.log("Creating server for order:", orderId, serverDetails);

  await appendProvisioningLog(supabase, orderId, {
    status: "started",
    message: "Server provisioning started.",
    request: serverDetails,
  });

  // Get order details
  const { data: order, error: orderError } = await supabase
    .from("orders")
    .select("*")
    .eq("id", orderId)
    .single();

  if (orderError || !order) {
    console.error("Order lookup error:", orderError, "orderId:", orderId);
    throw new Error("Order not found");
  }

  // IDEMPOTENCY CHECK: If server already created, skip
  if (order.server_id) {
    console.log("Server already exists for order:", orderId, "server_id:", order.server_id);
    return { 
      success: true, 
      serverId: order.server_id, 
      message: "Server already created",
      skipped: true 
    };
  }

  // Mark order as being processed to prevent race conditions
  const { error: lockError } = await supabase
    .from("orders")
    .update({ status: "provisioning" })
    .eq("id", orderId)
    .eq("status", order.status) // Only update if status hasn't changed
    .is("server_id", null); // Only if no server_id yet

  if (lockError) {
    console.log("Order already being processed by another request:", orderId);
    return { success: true, message: "Order already being processed", skipped: true };
  }

  // Get user email - try profile first, then auth.users as backup
  let userEmail = null;
  
  const { data: profile } = await supabase
    .from("profiles")
    .select("email")
    .eq("user_id", order.user_id)
    .single();
  
  if (profile?.email) {
    userEmail = profile.email;
  } else {
    // Fallback: get email directly from auth.users using service role
    const { data: authUser } = await supabase.auth.admin.getUserById(order.user_id);
    if (authUser?.user?.email) {
      userEmail = authUser.user.email;
      console.log("Got email from auth.users:", userEmail);
      
      // Also update the profile with the correct email
      await supabase
        .from("profiles")
        .update({ email: authUser.user.email })
        .eq("user_id", order.user_id);
    }
  }
  
  if (!userEmail) {
    throw new Error("User email not found. Cannot create Pterodactyl account without valid email.");
  }
  
  console.log("Creating Pterodactyl user with email:", userEmail);

  // Handle cart format: server_details may have items array
  const orderDetails = order.server_details || serverDetails || {};
  const items = orderDetails.items || [orderDetails];
  const firstItem = items[0] || {};

  // Get plan config with Pterodactyl settings
  const planId = firstItem.plan_id || serverDetails?.plan_id;
  const { data: planConfig } = await supabase
    .from("game_plans")
    .select("*")
    .eq("plan_id", planId)
    .maybeSingle();

  // Get or create Pterodactyl user - returns password if newly created
  const pterodactylUser = await getOrCreateUser(apiUrl, headers, userEmail);
  
  // Track if this is a new user (has password) for showing credentials
  const isNewPanelUser = !!pterodactylUser.password;
  const panelCredentials = isNewPanelUser ? {
    email: userEmail,
    username: pterodactylUser.username,
    password: pterodactylUser.password,
    isNew: true,
  } : null;

  // Use customer-selected nest/egg from order, or fall back to plan config, or defaults
  const serverName = firstItem.server_name || firstItem.name || `Server-${orderId.slice(0, 8)}`;
  // Priority: customer selection > plan config > default
  const eggId = firstItem.pterodactyl_egg_id || planConfig?.pterodactyl_egg_id || 1;
  const nestId = firstItem.pterodactyl_nest_id || planConfig?.pterodactyl_nest_id || 1;
  const nodeId = firstItem.pterodactyl_node_id || planConfig?.pterodactyl_node_id;
  const portRange = firstItem.pterodactyl_port_range || planConfig?.pterodactyl_port_range || planConfig?.pterodactyl_feature_limits?.port_range;
  const defaultLimits = { memory: 1024, swap: 0, disk: 10240, io: 500, cpu: 100 };
  const planLimits = planConfig?.pterodactyl_limits || null;
  const limits = { ...defaultLimits, ...(planLimits || {}) };
  const hasCustomLimits = !!planLimits && (
    planLimits.memory !== defaultLimits.memory ||
    planLimits.disk !== defaultLimits.disk ||
    planLimits.cpu !== defaultLimits.cpu ||
    planLimits.swap !== defaultLimits.swap ||
    planLimits.io !== defaultLimits.io
  );
  const featureLimits = {
    databases: 1,
    backups: 2,
    allocations: 1,
    ...(planConfig?.pterodactyl_feature_limits || {}),
    ...(firstItem.pterodactyl_feature_limits || {}),
  };

  const parseSizeToMb = (value?: string | null) => {
    if (!value) return null;
    const normalized = value.toLowerCase().trim();
    const numeric = Number(normalized.replace(/[^0-9.]/g, ""));
    if (Number.isNaN(numeric) || numeric <= 0) return null;
    if (normalized.includes("tb")) return Math.round(numeric * 1024 * 1024);
    if (normalized.includes("gb") || normalized.includes("gib")) return Math.round(numeric * 1024);
    if (normalized.includes("mb") || normalized.includes("mib")) return Math.round(numeric);
    return Math.round(numeric);
  };

  const parseCpuPercent = (value?: string | null) => {
    if (!value) return null;
    const normalized = value.toLowerCase().trim();
    const numeric = Number(normalized.replace(/[^0-9.]/g, ""));
    if (Number.isNaN(numeric) || numeric <= 0) return null;
    if (normalized.includes("%")) return Math.round(numeric);
    if (normalized.includes("vcpu") || normalized.includes("core")) return Math.round(numeric * 100);
    return Math.round(numeric);
  };

  if (!hasCustomLimits && planConfig) {
    const memoryFromPlan = parseSizeToMb(planConfig.ram);
    const diskFromPlan = parseSizeToMb(planConfig.storage);
    const cpuFromPlan = parseCpuPercent(planConfig.cpu);

    if (memoryFromPlan) limits.memory = memoryFromPlan;
    if (diskFromPlan) limits.disk = diskFromPlan;
    if (cpuFromPlan) limits.cpu = cpuFromPlan;
  }

  const memoryFromOrder = parseSizeToMb(firstItem.ram);
  const diskFromOrder = parseSizeToMb(firstItem.storage);
  const cpuFromOrder = parseCpuPercent(firstItem.cpu);

  // Only fall back to order display values when custom plan limits are not configured.
  // This ensures plan-level Pterodactyl limits (e.g. CPU 105%) are preserved exactly.
  if (!hasCustomLimits) {
    if (memoryFromOrder) limits.memory = memoryFromOrder;
    if (diskFromOrder) limits.disk = diskFromOrder;
    if (cpuFromOrder) limits.cpu = cpuFromOrder;
  }
  
  // Fetch egg details to get docker_image and startup command for customer-selected egg
  let dockerImage = firstItem.pterodactyl_docker_image || planConfig?.pterodactyl_docker_image || "ghcr.io/pterodactyl/yolks:java_17";
  let startup = firstItem.pterodactyl_startup || planConfig?.pterodactyl_startup || "java -Xms128M -Xmx{{SERVER_MEMORY}}M -jar {{SERVER_JARFILE}}";
  let environment = {
    ...(planConfig?.pterodactyl_environment || {}),
    ...(firstItem.pterodactyl_environment || {}),
  };
  
  // If customer selected a different egg, fetch its details
  if (firstItem.pterodactyl_egg_id) {
    console.log(`Customer selected egg ${eggId} from nest ${nestId}, fetching egg details...`);
    try {
      const eggRes = await fetch(`${apiUrl}/api/application/nests/${nestId}/eggs/${eggId}?include=variables`, { headers });
      if (eggRes.ok) {
        const eggData = await eggRes.json();
        dockerImage = eggData.attributes.docker_image || dockerImage;
        startup = eggData.attributes.startup || startup;
        
        // Build environment from egg variables
        const eggVars = eggData.attributes.relationships?.variables?.data || [];
        const eggEnvironment: Record<string, string> = {};
        for (const v of eggVars) {
          eggEnvironment[v.attributes.env_variable] = v.attributes.default_value || "";
        }
        environment = { ...eggEnvironment, ...environment };
        console.log(`Egg ${eggId} details loaded: docker=${dockerImage}`);
      }
    } catch (err) {
      console.error("Failed to fetch egg details, using defaults:", err);
    }
  }

  // Find available allocation
  const allocation = await findAvailableAllocation(apiUrl, headers, nodeId, portRange);

  // Default environment variables for common Minecraft eggs
  const defaultEnvironment: Record<string, string> = {
    SERVER_JARFILE: "server.jar",
    VANILLA_VERSION: "latest",
    MC_VERSION: "latest",
    BUILD_TYPE: "recommended",
    BUILD_NUMBER: "latest",
    MINECRAFT_VERSION: "latest",
    VERSION: "latest",
  };

  const serverPayload = {
    name: serverName,
    user: pterodactylUser.id,
    egg: eggId,
    docker_image: dockerImage,
    startup: startup,
    environment: {
      ...defaultEnvironment,
      ...environment,
    },
    limits: limits,
    feature_limits: featureLimits,
    allocation: {
      default: allocation.id,
    },
  };

  console.log("Creating server with payload:", JSON.stringify(serverPayload));

  const response = await fetch(`${apiUrl}/api/application/servers`, {
    method: "POST",
    headers,
    body: JSON.stringify(serverPayload),
  });

  if (!response.ok) {
    const errorData = await response.text();
    console.error("Pterodactyl API error:", errorData);
    throw new Error(`Failed to create server: ${response.statusText}`);
  }

  const serverData = await response.json();
  const serverId = serverData.attributes.identifier;

  console.log("Server created successfully:", serverId);

  await appendProvisioningLog(supabase, orderId, {
    status: "success",
    message: "Server provisioning completed.",
    response: { serverId, pterodactylId: serverData.attributes.id },
  });

  // Get billing_days from plan for next_due_date calculation
  const billingDays = planConfig?.billing_days || 30;
  const nextDueDate = new Date();
  nextDueDate.setDate(nextDueDate.getDate() + billingDays);

  // Update order with server ID, credentials (if new user), and next due date
  const updatedServerDetails: Record<string, any> = {
    ...serverDetails,
    pterodactyl_id: serverData.attributes.id,
    pterodactyl_uuid: serverData.attributes.uuid,
    pterodactyl_identifier: serverId,
    ip: allocation.ip,
    port: allocation.port,
    billing_days: billingDays,
    panel_url: apiUrl,
  };
  
  // Store credentials only if this is a new panel user
  if (panelCredentials) {
    updatedServerDetails.panel_credentials = panelCredentials;
    console.log("New panel user created, credentials stored for invoice display");
  }

  await supabase
    .from("orders")
    .update({
      server_id: serverId,
      status: "active",
      next_due_date: nextDueDate.toISOString(),
      server_details: updatedServerDetails,
    })
    .eq("id", orderId);

  // Send email with panel credentials or server setup notification
  try {
    if (panelCredentials) {
      // New panel user - send credentials email
      console.log("Sending panel credentials email to:", userEmail);
      const emailResponse = await supabase.functions.invoke('send-email', {
        body: {
          action: 'panel-credentials',
          to: userEmail,
          panelCredentials: panelCredentials,
          panelUrl: apiUrl,
          serverName: serverName,
        }
      });
      console.log("Panel credentials email sent:", emailResponse);
    } else {
      // Existing user - send server setup complete email
      console.log("Sending server setup complete email to:", userEmail);
      const emailResponse = await supabase.functions.invoke('send-email', {
        body: {
          action: 'server-setup-complete',
          orderId: orderId,
          serverDetails: {
            name: serverName,
            ip: allocation.ip,
            port: allocation.port,
            panelUrl: apiUrl,
          }
        }
      });
      console.log("Server setup email sent:", emailResponse);
    }
  } catch (emailErr) {
    console.error("Failed to send email (non-blocking):", emailErr);
    // Don't fail the server creation if email fails
  }

  return {
    success: true,
    serverId: serverId,
    serverDetails: {
      id: serverData.attributes.id,
      uuid: serverData.attributes.uuid,
      identifier: serverId,
      name: serverData.attributes.name,
      ip: allocation.ip,
      port: allocation.port,
    },
    nextDueDate: nextDueDate.toISOString(),
  };
}

async function appendProvisioningLog(
  supabase: any,
  orderId: string,
  entry: { status: "started" | "success" | "failed"; message: string; request?: any; response?: any }
) {
  try {
    const { data: order } = await supabase
      .from("orders")
      .select("server_details")
      .eq("id", orderId)
      .single();

    const details = order?.server_details || {};
    const logs = details.provisioning_logs || [];

    const updatedDetails = {
      ...details,
      provisioning_logs: [
        ...logs,
        {
          ...entry,
          at: new Date().toISOString(),
        },
      ],
    };

    await supabase
      .from("orders")
      .update({ server_details: updatedDetails })
      .eq("id", orderId);
  } catch (error) {
    console.error("Failed to append provisioning log in edge function:", error);
  }
}

async function getOrCreateUser(apiUrl: string, headers: Record<string, string>, email: string) {
  // Search for existing user
  const searchResponse = await fetch(
    `${apiUrl}/api/application/users?filter[email]=${encodeURIComponent(email)}`,
    { headers }
  );

  if (searchResponse.ok) {
    const searchData = await searchResponse.json();
    if (searchData.data && searchData.data.length > 0) {
      console.log("Found existing Pterodactyl user:", searchData.data[0].attributes.id);
      return { 
        id: searchData.data[0].attributes.id,
        username: searchData.data[0].attributes.username,
        isExisting: true,
      };
    }
  }

  // Create new user
  const username = email.split("@")[0].replace(/[^a-zA-Z0-9]/g, "").substring(0, 20) + Math.floor(Math.random() * 100);
  const password = generatePassword();

  const createResponse = await fetch(`${apiUrl}/api/application/users`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      email: email,
      username: username,
      first_name: username,
      last_name: "User",
      password: password,
    }),
  });

  if (!createResponse.ok) {
    const errorText = await createResponse.text();
    console.error("Failed to create user:", errorText);
    throw new Error("Failed to create Pterodactyl user");
  }

  const userData = await createResponse.json();
  console.log("Created new Pterodactyl user:", userData.attributes.id, "username:", username);

  return { id: userData.attributes.id, username, password, isExisting: false };
}

async function findAvailableAllocation(apiUrl: string, headers: Record<string, string>, nodeId?: number, portRange?: string) {
  // Get nodes
  const nodesResponse = await fetch(`${apiUrl}/api/application/nodes`, { headers });
  const nodesData = await nodesResponse.json();

  if (!nodesData.data || nodesData.data.length === 0) {
    throw new Error("No nodes available");
  }

  // Use specified node or first available
  const selectedNodeId = nodeId || nodesData.data[0].attributes.id;
  const selectedNode = nodesData.data.find((n: any) => n.attributes.id === selectedNodeId) || nodesData.data[0];
  
  const allocationsResponse = await fetch(
    `${apiUrl}/api/application/nodes/${selectedNodeId}/allocations?per_page=1000`,
    { headers }
  );
  const allocationsData = await allocationsResponse.json();

  const parsePortRange = (range?: string) => {
    if (!range) return null;
    const match = range.trim().match(/^(\d+)\s*-\s*(\d+)$/);
    if (!match) return null;
    const start = Number(match[1]);
    const end = Number(match[2]);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start <= 0 || end <= 0) return null;
    return { start: Math.min(start, end), end: Math.max(start, end) };
  };

  const portFilter = parsePortRange(portRange);

  // Find unassigned allocation
  const unassignedAllocations = allocationsData.data?.filter(
    (a: any) => !a.attributes.assigned && (!portFilter || (a.attributes.port >= portFilter.start && a.attributes.port <= portFilter.end))
  ) || [];
  let availableAllocation =
    unassignedAllocations.length > 0
      ? unassignedAllocations[Math.floor(Math.random() * unassignedAllocations.length)]
      : null;

  // If no allocation available, try to create one
  if (!availableAllocation) {
    console.log("No available allocations, attempting to create one...");
    
    // Get node's IP address from its FQDN or existing allocations
    let nodeIp = selectedNode.attributes.fqdn || "0.0.0.0";
    
    // Try to get an existing IP from allocations
    if (allocationsData.data && allocationsData.data.length > 0) {
      nodeIp = allocationsData.data[0].attributes.ip;
    }
    
    // Find a free port (pick a random port in configured range or safe default range)
    const usedPorts = new Set(allocationsData.data?.map((a: any) => a.attributes.port) || []);
    const minPort = portFilter?.start ?? 20000;
    const maxPort = portFilter?.end ?? 50000;
    let newPort = Math.floor(Math.random() * (maxPort - minPort + 1)) + minPort;
    let attempts = 0;
    while (usedPorts.has(newPort) && attempts < 200) {
      newPort = Math.floor(Math.random() * (maxPort - minPort + 1)) + minPort;
      attempts++;
    }
    if (usedPorts.has(newPort)) {
      throw new Error("No available ports found for allocation.");
    }
    
    // Create new allocation
    const createAllocationResponse = await fetch(
      `${apiUrl}/api/application/nodes/${selectedNodeId}/allocations`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          ip: nodeIp,
          ports: [newPort.toString()],
        }),
      }
    );
    
    if (!createAllocationResponse.ok) {
      const errorText = await createAllocationResponse.text();
      console.error("Failed to create allocation:", errorText);
      throw new Error("No available allocations and failed to create new one. Please add allocations in Pterodactyl panel.");
    }
    
    let createdAllocationData: any = null;
    try {
      createdAllocationData = await createAllocationResponse.json();
    } catch {
      // Some panel versions may return empty/no-json body on allocation create.
      createdAllocationData = null;
    }

    const createdAttributes =
      createdAllocationData?.attributes ||
      createdAllocationData?.data?.[0]?.attributes ||
      null;

    availableAllocation = createdAttributes ? { attributes: createdAttributes } : null;

    if (!availableAllocation) {
      // Fallback: refetch allocations and find the newly created unassigned port.
      let fallbackFound: any = null;
      for (let retry = 0; retry < 3 && !fallbackFound; retry++) {
        await new Promise((resolve) => setTimeout(resolve, 250 * (retry + 1)));
        const retryAllocationsResponse = await fetch(
          `${apiUrl}/api/application/nodes/${selectedNodeId}/allocations?per_page=1000`,
          { headers }
        );
        const retryAllocationsData = await retryAllocationsResponse.json();
        fallbackFound = retryAllocationsData?.data?.find(
          (a: any) => !a.attributes.assigned && a.attributes.port === newPort
        );
      }

      if (fallbackFound) {
        availableAllocation = fallbackFound;
      } else {
        throw new Error("Failed to select an available allocation on the node");
      }
    }

    console.log("Created new allocation:", availableAllocation.attributes);
  }

  return {
    id: availableAllocation.attributes.id,
    ip: availableAllocation.attributes.ip,
    port: availableAllocation.attributes.port,
  };
}

async function sendPowerSignal(apiUrl: string, apiKey: string, serverId: string, signal: string) {
  console.log(`Sending power signal '${signal}' to server ${serverId}`);

  // First, get the internal server ID from the identifier
  const headers = {
    "Authorization": `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    "Accept": "application/json",
  };

  // Get server by external ID
  const serverResponse = await fetch(
    `${apiUrl}/api/application/servers/external/${serverId}`,
    { headers }
  );

  if (!serverResponse.ok) {
    throw new Error(`Server not found: ${serverId}`);
  }

  const serverData = await serverResponse.json();
  const internalId = serverData.attributes.id;

  // Send power signal using client API
  const powerResponse = await fetch(
    `${apiUrl}/api/client/servers/${serverId}/power`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({ signal }),
    }
  );

  if (!powerResponse.ok) {
    const errorText = await powerResponse.text();
    console.error("Power signal error:", errorText);
    throw new Error(`Failed to send power signal: ${powerResponse.statusText}`);
  }

  return { success: true, signal, serverId };
}

async function suspendServer(apiUrl: string, headers: Record<string, string>, serverId: string) {
  const serverResponse = await fetch(
    `${apiUrl}/api/application/servers/external/${serverId}`,
    { headers }
  );

  if (!serverResponse.ok) {
    throw new Error(`Server not found: ${serverId}`);
  }

  const serverData = await serverResponse.json();
  const internalId = serverData.attributes.id;

  const response = await fetch(
    `${apiUrl}/api/application/servers/${internalId}/suspend`,
    { method: "POST", headers }
  );

  if (!response.ok) {
    throw new Error(`Failed to suspend server: ${response.statusText}`);
  }

  return { success: true, action: "suspended", serverId };
}

async function unsuspendServer(apiUrl: string, headers: Record<string, string>, serverId: string) {
  const serverResponse = await fetch(
    `${apiUrl}/api/application/servers/external/${serverId}`,
    { headers }
  );

  if (!serverResponse.ok) {
    throw new Error(`Server not found: ${serverId}`);
  }

  const serverData = await serverResponse.json();
  const internalId = serverData.attributes.id;

  const response = await fetch(
    `${apiUrl}/api/application/servers/${internalId}/unsuspend`,
    { method: "POST", headers }
  );

  if (!response.ok) {
    throw new Error(`Failed to unsuspend server: ${response.statusText}`);
  }

  return { success: true, action: "unsuspended", serverId };
}

async function terminateServer(apiUrl: string, headers: Record<string, string>, serverId: string) {
  const serverResponse = await fetch(
    `${apiUrl}/api/application/servers/external/${serverId}`,
    { headers }
  );

  if (!serverResponse.ok) {
    throw new Error(`Server not found: ${serverId}`);
  }

  const serverData = await serverResponse.json();
  const internalId = serverData.attributes.id;

  const response = await fetch(
    `${apiUrl}/api/application/servers/${internalId}`,
    { method: "DELETE", headers }
  );

  if (!response.ok) {
    throw new Error(`Failed to terminate server: ${response.statusText}`);
  }

  return { success: true, action: "terminated", serverId };
}

async function getServerStatus(apiUrl: string, headers: Record<string, string>, serverId: string) {
  // First, get server details from Application API to check if server exists
  const serverResponse = await fetch(
    `${apiUrl}/api/application/servers/external/${serverId}`,
    { headers }
  );

  if (!serverResponse.ok) {
    if (serverResponse.status === 404) {
      return {
        success: false,
        status: "not_found",
        error: "Server not found in Pterodactyl panel",
        resources: null,
      };
    }
    throw new Error(`Failed to get server info: ${serverResponse.statusText}`);
  }

  const serverData = await serverResponse.json();
  const serverInfo = serverData.attributes;
  
  // Check if server is suspended at the application level
  const isSuspended = serverInfo.suspended || serverInfo.status === "suspended";
  
  // Try to get resources from client API - but this may fail if we don't have client API access
  // The Application API key doesn't work with client endpoints, so we'll use application data
  let currentState = "unknown";
  let resources = null;
  
  // Use websocket connection status from application API if available
  if (isSuspended) {
    currentState = "suspended";
  } else {
    // Try client API with a timeout - it may work if the API key has client permissions
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      
      const resourcesResponse = await fetch(
        `${apiUrl}/api/client/servers/${serverId}/resources`,
        { 
          headers,
          signal: controller.signal 
        }
      );
      
      clearTimeout(timeoutId);
      
      if (resourcesResponse.ok) {
        const resourcesData = await resourcesResponse.json();
        currentState = resourcesData.attributes.current_state;
        resources = resourcesData.attributes.resources;
      } else {
        // Client API failed, use application data
        currentState = serverInfo.status || "unknown";
      }
    } catch (err) {
      // Client API not accessible, use application data
      console.log("Client API not accessible, using application data");
      currentState = isSuspended ? "suspended" : (serverInfo.status || "active");
    }
  }

  return {
    success: true,
    status: currentState,
    suspended: isSuspended,
    serverInfo: {
      id: serverInfo.id,
      uuid: serverInfo.uuid,
      identifier: serverInfo.identifier,
      name: serverInfo.name,
      limits: serverInfo.limits,
      featureLimits: serverInfo.feature_limits,
    },
    resources: resources,
  };
}

function generatePassword(): string {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*";
  let password = "";
  for (let i = 0; i < 16; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return password;
}

async function resetUserPassword(apiUrl: string, headers: Record<string, string>, email: string, supabase: any) {
  console.log("Resetting password for user:", email);
  
  // Find user by email
  const searchResponse = await fetch(
    `${apiUrl}/api/application/users?filter[email]=${encodeURIComponent(email)}`,
    { headers }
  );

  if (!searchResponse.ok) {
    throw new Error("Failed to search for user");
  }

  const searchData = await searchResponse.json();
  if (!searchData.data || searchData.data.length === 0) {
    throw new Error("No Pterodactyl account found for this email. Please contact support.");
  }

  const userId = searchData.data[0].attributes.id;
  const username = searchData.data[0].attributes.username;
  const newPassword = generatePassword();

  // Update user password
  const updateResponse = await fetch(`${apiUrl}/api/application/users/${userId}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({
      email: email,
      username: username,
      first_name: searchData.data[0].attributes.first_name,
      last_name: searchData.data[0].attributes.last_name,
      password: newPassword,
    }),
  });

  if (!updateResponse.ok) {
    const errorText = await updateResponse.text();
    console.error("Failed to reset password:", errorText);
    throw new Error("Failed to reset password. Please try again or contact support.");
  }

  console.log("Password reset successful for user:", userId);

  // Send email notification with new credentials
  try {
    console.log("Sending password reset email to:", email);
    await supabase.functions.invoke('send-email', {
      body: {
        action: 'panel-password-reset',
        to: email,
        newPassword: newPassword,
        panelUrl: apiUrl,
      }
    });
    console.log("Password reset email sent successfully");
  } catch (emailErr) {
    console.error("Failed to send password reset email (non-blocking):", emailErr);
  }

  return {
    success: true,
    message: "Password reset successful",
    credentials: {
      email: email,
      username: username,
      password: newPassword,
    },
  };
}

// ============= Preview Servers From Panel =============

async function previewServersFromPanel(
  apiUrl: string,
  headers: Record<string, string>
) {
  console.log("Previewing servers from Pterodactyl panel...");

  let allServers: any[] = [];
  let page = 1;
  let hasMore = true;

  while (hasMore) {
    const serversRes = await fetch(
      `${apiUrl}/api/application/servers?page=${page}&include=user`,
      { headers }
    );

    if (!serversRes.ok) {
      throw new Error("Failed to fetch servers from panel");
    }

    const serversData = await serversRes.json();
    allServers = allServers.concat(serversData.data || []);
    
    const meta = serversData.meta?.pagination;
    if (meta && meta.current_page < meta.total_pages) {
      page++;
    } else {
      hasMore = false;
    }
  }

  console.log(`Found ${allServers.length} servers in panel for preview`);

  // Map servers to simplified format
  const servers = allServers.map((server: any) => {
    const attrs = server.attributes;
    const userAttrs = attrs.relationships?.user?.attributes;
    return {
      id: attrs.id,
      uuid: attrs.uuid,
      external_id: attrs.external_id,
      name: attrs.name,
      email: userAttrs?.email || "unknown",
      suspended: attrs.suspended,
      limits: attrs.limits,
      created_at: attrs.created_at,
    };
  });

  return {
    success: true,
    totalInPanel: servers.length,
    servers,
  };
}

// ============= Sync Servers From Panel =============

async function syncServersFromPanel(
  apiUrl: string,
  headers: Record<string, string>,
  supabase: any,
  serverPrices: Record<string, number> = {}
) {
  console.log("Syncing servers from Pterodactyl panel...");

  // Fetch all servers from panel with pagination
  let allServers: any[] = [];
  let page = 1;
  let hasMore = true;

  while (hasMore) {
    const serversRes = await fetch(
      `${apiUrl}/api/application/servers?page=${page}&include=user`,
      { headers }
    );

    if (!serversRes.ok) {
      throw new Error("Failed to fetch servers from panel");
    }

    const serversData = await serversRes.json();
    allServers = allServers.concat(serversData.data || []);
    
    // Check if there are more pages
    const meta = serversData.meta?.pagination;
    if (meta && meta.current_page < meta.total_pages) {
      page++;
    } else {
      hasMore = false;
    }
  }

  console.log(`Found ${allServers.length} servers in panel`);

  // Get existing orders with server_ids
  const { data: existingOrders } = await supabase
    .from("orders")
    .select("server_id, user_id");

  const existingServerIds = new Set(
    (existingOrders || []).map((o: any) => o.server_id).filter(Boolean)
  );

  // Group servers by user email for batch processing
  const serversByEmail: Map<string, any[]> = new Map();
  
  for (const server of allServers) {
    const attrs = server.attributes;
    const userAttrs = attrs.relationships?.user?.attributes;
    const email = userAttrs?.email;
    
    if (email) {
      if (!serversByEmail.has(email)) {
        serversByEmail.set(email, []);
      }
      serversByEmail.get(email)!.push(server);
    }
  }

  const imported: any[] = [];
  const skipped: any[] = [];
  const errors: any[] = [];
  const newUsersCreated: any[] = [];

  for (const [email, servers] of serversByEmail) {
    // Find or create user
    let userId = null;
    let isNewUser = false;
    let generatedPassword = null;
    
    // First check if profile exists with this email
    const { data: profile } = await supabase
      .from("profiles")
      .select("user_id")
      .eq("email", email)
      .maybeSingle();

    if (profile) {
      userId = profile.user_id;
    } else {
      // Check auth.users
      const { data: authUsers } = await supabase.auth.admin.listUsers();
      const existingAuthUser = authUsers?.users?.find(
        (u: any) => u.email === email
      );
      
      if (existingAuthUser) {
        userId = existingAuthUser.id;
        // Ensure profile exists
        await supabase.from("profiles").upsert({
          user_id: existingAuthUser.id,
          email: email,
        }, { onConflict: "user_id" });
      }
    }

    // If no user found, CREATE a new user account
    if (!userId) {
      try {
        generatedPassword = generatePassword();
        
        // Create user via Supabase Auth Admin
        const { data: newUser, error: createError } = await supabase.auth.admin.createUser({
          email: email,
          password: generatedPassword,
          email_confirm: true, // Auto-confirm the email
          user_metadata: {
            created_from_panel_sync: true,
            sync_date: new Date().toISOString(),
          },
        });

        if (createError) {
          console.error(`Failed to create user for ${email}:`, createError);
          for (const server of servers) {
            errors.push({ 
              id: server.attributes.id, 
              name: server.attributes.name, 
              error: `Failed to create user: ${createError.message}` 
            });
          }
          continue;
        }

        userId = newUser.user.id;
        isNewUser = true;

        // Create profile for new user
        await supabase.from("profiles").insert({
          user_id: userId,
          email: email,
        });

        // Assign user role
        await supabase.from("user_roles").insert({
          user_id: userId,
          role: "user",
        });

        console.log(`Created new user account for ${email}, userId: ${userId}`);
        
        newUsersCreated.push({
          email,
          userId,
          serverCount: servers.length,
        });
      } catch (err: any) {
        console.error(`Error creating user for ${email}:`, err);
        for (const server of servers) {
          errors.push({ 
            id: server.attributes.id, 
            name: server.attributes.name, 
            error: `User creation failed: ${err.message}` 
          });
        }
        continue;
      }
    }

    // Process all servers for this user
    const userServerNames: string[] = [];
    
    for (const server of servers) {
      const attrs = server.attributes;
      const externalId = attrs.external_id || attrs.uuid;
      const serverName = attrs.name;
      const createdAt = attrs.created_at;
      const suspended = attrs.suspended;

      // Skip if already exists
      if (existingServerIds.has(externalId) || existingServerIds.has(attrs.uuid)) {
        skipped.push({ id: attrs.id, name: serverName, reason: "already_exists" });
        continue;
      }

      try {
        // Create order for this server
        const serverDetails = {
          plan_name: serverName,
          panel_server_id: attrs.id,
          synced_from_panel: true,
          sync_date: new Date().toISOString(),
          limits: attrs.limits,
          feature_limits: attrs.feature_limits,
        };

        // Calculate next_due_date: 30 days from server creation
        const created = new Date(createdAt);
        const nextDueDate = new Date(created.getTime() + 30 * 24 * 60 * 60 * 1000);

        // Get custom price from serverPrices map, default to 0
        const serverUuid = attrs.uuid;
        const customPrice = serverPrices[serverUuid] ?? 0;

        const { error: insertError } = await supabase.from("orders").insert({
          user_id: userId,
          server_id: externalId || attrs.uuid,
          status: suspended ? "suspended" : "active",
          price: customPrice,
          billing_cycle: "monthly",
          server_details: serverDetails,
          next_due_date: nextDueDate.toISOString(),
          created_at: createdAt,
          notes: `Imported from Pterodactyl panel on ${new Date().toISOString()}. Price: $${customPrice}/month`,
        });

        if (insertError) {
          errors.push({ id: attrs.id, name: serverName, error: insertError.message });
        } else {
          imported.push({ 
            id: attrs.id, 
            name: serverName, 
            userId,
            status: suspended ? "suspended" : "active",
            isNewUser,
          });
          userServerNames.push(serverName);
        }
      } catch (err: any) {
        errors.push({ id: attrs.id, name: serverName, error: err.message });
      }
    }

    // Send welcome email to new users with their credentials and server list
    if (isNewUser && generatedPassword && userServerNames.length > 0) {
      try {
        console.log(`Sending sync welcome email to new user: ${email}`);
        
        await supabase.functions.invoke('send-email', {
          body: {
            action: 'sync-welcome',
            to: email,
            password: generatedPassword,
            panelUrl: apiUrl,
            servers: userServerNames,
          }
        });
        
        console.log(`Sync welcome email sent to ${email}`);
      } catch (emailErr) {
        console.error(`Failed to send welcome email to ${email}:`, emailErr);
        // Non-blocking - continue with sync
      }
    }
  }

  return {
    success: true,
    totalInPanel: allServers.length,
    imported: imported.length,
    skipped: skipped.length,
    errors: errors.length,
    newUsersCreated: newUsersCreated.length,
    details: {
      imported,
      skipped,
      errors,
      newUsersCreated,
    },
  };
}
