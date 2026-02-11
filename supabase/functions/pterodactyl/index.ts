import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const PTERODACTYL_API_URL = Deno.env.get("PTERODACTYL_API_URL");
const PTERODACTYL_API_KEY = Deno.env.get("PTERODACTYL_API_KEY");

function getPterodactylConfig() {
  if (!PTERODACTYL_API_URL || !PTERODACTYL_API_KEY) {
    throw new Error("Pterodactyl panel not configured. Set PTERODACTYL_API_URL and PTERODACTYL_API_KEY.");
  }

  let normalizedUrl = PTERODACTYL_API_URL.trim();
  while (normalizedUrl.endsWith("/")) normalizedUrl = normalizedUrl.slice(0, -1);
  normalizedUrl = normalizedUrl.replace(/\/api\/application$/i, "").replace(/\/api$/i, "");

  return { apiUrl: normalizedUrl, apiKey: PTERODACTYL_API_KEY };
}

function json(resBody: unknown, status = 200) {
  return new Response(JSON.stringify(resBody), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/**
 * Fetch helper that returns JSON when possible, otherwise text,
 * and throws with the REAL response body if !ok.
 */
async function apiFetch(url: string, init: RequestInit) {
  const res = await fetch(url, init);
  const text = await res.text();

  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!res.ok) {
    const msg =
      typeof data === "string"
        ? data
        : (data?.errors ? JSON.stringify(data.errors) : JSON.stringify(data));
    throw new Error(`Pterodactyl API ${res.status} ${res.statusText}: ${msg}`);
  }

  return data;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    const body = await req.json();
    const { action, orderId, serverDetails, serverId, apiUrl: testApiUrl, apiKey: testApiKey } = body;

    if (action === "test") return await handleTestConnection(testApiUrl, testApiKey);

    if (action === "get-panel-data") {
      const config = getPterodactylConfig();
      return await handleGetPanelData(config.apiUrl, config.apiKey);
    }

    const config = getPterodactylConfig();
    const headers = {
      "Authorization": `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
      "Accept": "application/json",
    };

    switch (action) {
      case "create": {
        await supabase.from("orders").update({
          status: "provisioning",
          notes: "Server provisioning in progress...",
        }).eq("id", orderId);

        const createPromise = createServer(config.apiUrl, headers, orderId, serverDetails, supabase)
          .catch(async (err: any) => {
            console.error("Server creation failed:", err);
            await supabase.from("orders").update({
              status: "failed",
              notes: `Server creation failed: ${err?.message ?? String(err)}`,
            }).eq("id", orderId);
            throw err;
          });

        // Supabase Edge runtime background
        // @ts-ignore
        const runtime = (globalThis as any).EdgeRuntime;
        if (runtime?.waitUntil) {
          runtime.waitUntil(createPromise);
          return json({ success: true, message: "Server provisioning started", status: "provisioning" });
        }

        const result = await createPromise;
        return json(result);
      }

      default:
        return json({ error: `Unknown action: ${action}` }, 400);
    }
  } catch (error: any) {
    console.error("Edge function error:", error);
    return json({ error: error?.message ?? String(error) }, 500);
  }
});

async function handleTestConnection(apiUrl: string, apiKey: string) {
  const headers = {
    "Authorization": `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    "Accept": "application/json",
  };

  const [nodesData, serversData] = await Promise.all([
    apiFetch(`${apiUrl}/api/application/nodes`, { headers }),
    apiFetch(`${apiUrl}/api/application/servers`, { headers }),
  ]);

  return json({
    success: true,
    nodes: nodesData.meta?.pagination?.total ?? nodesData.data?.length ?? 0,
    servers: serversData.meta?.pagination?.total ?? serversData.data?.length ?? 0,
  });
}

async function handleGetPanelData(apiUrl: string, apiKey: string) {
  const headers = {
    "Authorization": `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    "Accept": "application/json",
  };

  const [nestsData, nodesData] = await Promise.all([
    apiFetch(`${apiUrl}/api/application/nests?include=eggs`, { headers }),
    apiFetch(`${apiUrl}/api/application/nodes`, { headers }),
  ]);

  const nests = nestsData.data?.map((nest: any) => ({
    id: nest.attributes.id,
    name: nest.attributes.name,
    eggs: nest.attributes.relationships?.eggs?.data?.map((egg: any) => ({
      id: egg.attributes.id,
      name: egg.attributes.name,
      docker_image: egg.attributes.docker_image,
      startup: egg.attributes.startup,
    })) ?? [],
  })) ?? [];

  const nodes = nodesData.data?.map((node: any) => ({
    id: node.attributes.id,
    name: node.attributes.name,
    memory: node.attributes.memory,
    disk: node.attributes.disk,
    location_id: node.attributes.location_id,
  })) ?? [];

  return json({ nests, nodes });
}

async function createServer(
  apiUrl: string,
  headers: Record<string, string>,
  orderId: string,
  serverDetails: any,
  supabase: any,
) {
  console.log("Creating server for order:", orderId);

  const { data: order, error: orderError } = await supabase
    .from("orders").select("*").eq("id", orderId).single();

  if (orderError || !order) throw new Error("Order not found");

  const { data: profile } = await supabase
    .from("profiles").select("email").eq("user_id", order.user_id).single();

  const orderDetails = order.server_details || serverDetails || {};
  const items = orderDetails.items || [orderDetails];
  const firstItem = items[0] || {};

  const planId = firstItem.plan_id || serverDetails?.plan_id;
  const { data: planConfig } = await supabase
    .from("game_plans").select("*").eq("plan_id", planId).maybeSingle();

  const userEmail = profile?.email || `user-${order.user_id}@gamehost.com`;
  const pUser = await getOrCreateUser(apiUrl, headers, userEmail);

  const serverName =
    firstItem.server_name || firstItem.name || `Server-${orderId.slice(0, 8)}`;

  const eggId = Number(firstItem.pterodactyl_egg_id || planConfig?.pterodactyl_egg_id || 1);
  const nestId = Number(firstItem.pterodactyl_nest_id || planConfig?.pterodactyl_nest_id || 1);

  const limits = planConfig?.pterodactyl_limits ?? { memory: 1024, swap: 0, disk: 10240, io: 500, cpu: 100 };
  const featureLimits = planConfig?.pterodactyl_feature_limits ?? { databases: 1, backups: 2, allocations: 1 };

  // 1) Load egg + variables (so we know EXACT required env vars)
  const eggData = await apiFetch(
    `${apiUrl}/api/application/nests/${nestId}/eggs/${eggId}?include=variables`,
    { headers },
  );

  const dockerImage =
    (firstItem.pterodactyl_docker_image || planConfig?.pterodactyl_docker_image || eggData?.attributes?.docker_image) ??
    "ghcr.io/pterodactyl/yolks:java_17";

  const startup =
    (firstItem.pterodactyl_startup || planConfig?.pterodactyl_startup || eggData?.attributes?.startup) ??
    "java -Xms128M -Xmx{{SERVER_MEMORY}}M -jar {{SERVER_JARFILE}}";

  const eggVars = eggData?.attributes?.relationships?.variables?.data ?? [];

  // Sources of env overrides (highest first)
  const planEnv: Record<string, any> = planConfig?.pterodactyl_environment ?? {};
  const itemEnv: Record<string, any> = firstItem.environment ?? {};
  const passedEnv: Record<string, any> = serverDetails?.environment ?? {};

  // 2) Build a VALID environment object: required vars MUST have value
  const environment: Record<string, string> = {};
  for (const v of eggVars) {
    const envName = v.attributes.env_variable;
    const rules: string = v.attributes.rules ?? "";
    const isRequired = rules.split("|").includes("required");

    const chosen =
      (passedEnv[envName] ?? itemEnv[envName] ?? planEnv[envName] ?? v.attributes.default_value);

    if (isRequired && (chosen === null || chosen === undefined || String(chosen).trim() === "")) {
      throw new Error(
        `Egg variable '${envName}' is required but has no value. Set it in planConfig.pterodactyl_environment or order item.environment.`,
      );
    }

    // Pterodactyl expects strings
    environment[envName] = chosen === null || chosen === undefined ? "" : String(chosen);
  }

  // 3) Allocation (preferred)
  const allocation = await findAvailableAllocation(apiUrl, headers, planConfig?.pterodactyl_node_id);

  // 4) Also include deploy fallback (safe & compatible with create schema) :contentReference[oaicite:1]{index=1}
  const nodeData = await apiFetch(`${apiUrl}/api/application/nodes/${allocation.nodeId}`, { headers });
  const locationId = nodeData?.attributes?.location_id;

  const payload: any = {
    external_id: String(orderId), // optional but useful :contentReference[oaicite:2]{index=2}
    name: serverName,
    user: pUser.id,
    egg: eggId,
    docker_image: dockerImage,
    startup,
    environment,
    limits,
    feature_limits: featureLimits,

    allocation: {
      default: allocation.id,
      additional: [],
    },

    // fallback deploy info (doesn't hurt even if allocation is set)
    ...(locationId ? {
      deploy: {
        locations: [locationId],
        dedicated_ip: false,
        port_range: [],
      },
    } : {}),

    start_on_completion: true,
    skip_scripts: false,
    oom_disabled: true,
  };

  console.log("Create server payload:", JSON.stringify(payload));

  const serverData = await apiFetch(`${apiUrl}/api/application/servers`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });

  const identifier = serverData.attributes.identifier;

  const billingDays = planConfig?.billing_days ?? 30;
  const nextDueDate = new Date();
  nextDueDate.setDate(nextDueDate.getDate() + billingDays);

  const updatedServerDetails: Record<string, any> = {
    ...serverDetails,
    pterodactyl_id: serverData.attributes.id,
    pterodactyl_uuid: serverData.attributes.uuid,
    pterodactyl_identifier: identifier,
    ip: allocation.ip,
    port: allocation.port,
    billing_days: billingDays,
    panel_url: apiUrl,
  };

  // Store panel creds only when new
  if (pUser.password) {
    updatedServerDetails.panel_credentials = {
      email: userEmail,
      username: pUser.username,
      password: pUser.password,
      isNew: true,
    };
  }

  await supabase.from("orders").update({
    server_id: identifier,
    status: "active",
    next_due_date: nextDueDate.toISOString(),
    server_details: updatedServerDetails,
  }).eq("id", orderId);

  return {
    success: true,
    serverId: identifier,
    serverDetails: {
      id: serverData.attributes.id,
      uuid: serverData.attributes.uuid,
      identifier,
      name: serverData.attributes.name,
      ip: allocation.ip,
      port: allocation.port,
    },
    nextDueDate: nextDueDate.toISOString(),
  };
}

async function getOrCreateUser(apiUrl: string, headers: Record<string, string>, email: string) {
  // Search existing
  const searchData = await apiFetch(
    `${apiUrl}/api/application/users?filter[email]=${encodeURIComponent(email)}`,
    { headers },
  ).catch(() => null);

  if (searchData?.data?.length) {
    const u = searchData.data[0].attributes;
    return { id: u.id, username: u.username, isExisting: true };
  }

  const base = email.split("@")[0].replace(/[^a-zA-Z0-9]/g, "").slice(0, 18);
  const username = `${base}${Math.floor(Math.random() * 100)}`;
  const password = generatePassword();

  const userData = await apiFetch(`${apiUrl}/api/application/users`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      email,
      username,
      first_name: username,
      last_name: "User",
      password,
    }),
  });

  return { id: userData.attributes.id, username, password, isExisting: false };
}

function isValidIPv4(ip: string) {
  return /^(\d{1,3}\.){3}\d{1,3}$/.test(ip);
}

async function findAvailableAllocation(apiUrl: string, headers: Record<string, string>, nodeId?: number) {
  const nodesData = await apiFetch(`${apiUrl}/api/application/nodes`, { headers });

  if (!nodesData.data?.length) throw new Error("No nodes available");

  const selectedNodeId = nodeId ?? nodesData.data[0].attributes.id;
  const selectedNode = nodesData.data.find((n: any) => n.attributes.id === selectedNodeId) ?? nodesData.data[0];

  const allocationsData = await apiFetch(
    `${apiUrl}/api/application/nodes/${selectedNodeId}/allocations`,
    { headers },
  );

  let available = allocationsData.data?.find((a: any) => !a.attributes.assigned);

  // If none, try to create ONE new allocation only if we can determine a real IP
  if (!available) {
    const existingIp = allocationsData.data?.[0]?.attributes?.ip;
    const nodeIpCandidate = existingIp ?? selectedNode.attributes?.ip ?? selectedNode.attributes?.fqdn;

    if (!nodeIpCandidate || !isValidIPv4(String(nodeIpCandidate))) {
      throw new Error(
        "No free allocations and cannot auto-create (node IP unknown). Add allocations in Pterodactyl panel first.",
      );
    }

    const usedPorts = new Set<number>(allocationsData.data?.map((a: any) => Number(a.attributes.port)) ?? []);
    let newPort = 25565;
    while (usedPorts.has(newPort) && newPort < 30000) newPort++;

    await apiFetch(`${apiUrl}/api/application/nodes/${selectedNodeId}/allocations`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        ip: String(nodeIpCandidate),
        ports: [String(newPort)],
      }),
    });

    const refreshed = await apiFetch(
      `${apiUrl}/api/application/nodes/${selectedNodeId}/allocations`,
      { headers },
    );

    available = refreshed.data?.find((a: any) => !a.attributes.assigned && Number(a.attributes.port) === newPort);

    if (!available) {
      throw new Error("Allocation creation succeeded but could not find the new free allocation.");
    }
  }

  return {
    id: available.attributes.id,
    ip: available.attributes.ip,
    port: available.attributes.port,
    nodeId: selectedNodeId,
  };
}

function generatePassword(): string {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*";
  let pass = "";
  for (let i = 0; i < 16; i++) pass += chars.charAt(Math.floor(Math.random() * chars.length));
  return pass;
}
