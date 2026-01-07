import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

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
  
  if (error || !user) return null;

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

// ============= Input Validation =============

const ALLOWED_ACTIONS = ["check", "send-reminders", "get-pending", "auto-suspend", "daily-job", "renew"] as const;

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

// ============= Main Handler =============

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    const body = await req.json().catch(() => ({}));
    const action = validateAction(body.action || "check");

    console.log(`Renewal reminder action: ${action}`);

    // ADMIN ONLY: All renewal reminder actions require admin privileges
    await requireAdmin(req);

    switch (action) {
      case "check": {
        const result = await checkUpcomingRenewals(supabase);
        return new Response(JSON.stringify(result), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "send-reminders": {
        const result = await sendPaymentReminders(supabase);
        return new Response(JSON.stringify(result), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "get-pending": {
        const result = await getPendingReminders(supabase);
        return new Response(JSON.stringify(result), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "auto-suspend": {
        const result = await autoSuspendOverdue(supabase);
        return new Response(JSON.stringify(result), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "daily-job": {
        const reminderResult = await sendPaymentReminders(supabase);
        const suspendResult = await autoSuspendOverdue(supabase);
        return new Response(JSON.stringify({
          success: true,
          reminders: reminderResult,
          suspensions: suspendResult,
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "renew": {
        const validatedOrderId = validateUUID(body.orderId, "orderId");
        const validatedPaymentId = body.paymentId ? validateUUID(body.paymentId, "paymentId") : "";
        const result = await renewService(supabase, validatedOrderId, validatedPaymentId);
        return new Response(JSON.stringify(result), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      default:
        throw new Error(`Unknown action: ${action}`);
    }
  } catch (error: any) {
    console.error("Renewal reminder error:", error);
    
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

async function checkUpcomingRenewals(supabase: any) {
  console.log("Checking for upcoming renewals...");

  const now = new Date();
  const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  // Get unpaid invoices due within 7 days
  const { data: invoices, error: invoicesError } = await supabase
    .from("invoices")
    .select("*")
    .eq("status", "unpaid")
    .gte("due_date", now.toISOString())
    .lte("due_date", sevenDaysFromNow.toISOString());

  if (invoicesError) {
    console.error("Error fetching invoices:", invoicesError);
    throw new Error("Failed to fetch invoices");
  }

  const reminders: any[] = [];

  for (const invoice of invoices || []) {
    const dueDate = new Date(invoice.due_date);
    const daysUntilDue = Math.ceil((dueDate.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));

    // Send reminders at 7, 3, and 1 day(s) before due date
    const shouldRemind = daysUntilDue === 7 || daysUntilDue === 3 || daysUntilDue === 1;

    if (shouldRemind) {
      reminders.push({
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoice_number,
        userId: invoice.user_id,
        orderId: invoice.order_id || "",
        amount: invoice.total,
        dueDate: invoice.due_date,
        daysUntilDue,
      });
      console.log(`Reminder needed for invoice ${invoice.invoice_number}: ${daysUntilDue} days until due`);
    }
  }

  return {
    success: true,
    checkedAt: now.toISOString(),
    totalInvoicesChecked: invoices?.length || 0,
    remindersGenerated: reminders.length,
    reminders,
    reminderBreakdown: {
      sevenDays: reminders.filter(r => r.daysUntilDue === 7).length,
      threeDays: reminders.filter(r => r.daysUntilDue === 3).length,
      oneDay: reminders.filter(r => r.daysUntilDue === 1).length,
    },
  };
}

async function sendPaymentReminders(supabase: any) {
  console.log("Sending payment reminder emails...");

  const now = new Date();
  const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  // Get unpaid invoices due within 7 days
  const { data: invoices, error: invoicesError } = await supabase
    .from("invoices")
    .select("*, orders(server_details, products(name))")
    .eq("status", "unpaid")
    .gte("due_date", now.toISOString())
    .lte("due_date", sevenDaysFromNow.toISOString());

  if (invoicesError) {
    console.error("Error fetching invoices:", invoicesError);
    throw new Error("Failed to fetch invoices");
  }

  const emailsSent: any[] = [];
  const errors: any[] = [];

  for (const invoice of invoices || []) {
    const dueDate = new Date(invoice.due_date);
    const daysUntilDue = Math.ceil((dueDate.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));

    // Send reminders at 7, 3, and 1 day(s) before due date
    const shouldRemind = daysUntilDue === 7 || daysUntilDue === 3 || daysUntilDue === 1;

    if (shouldRemind) {
      // Get user email
      const { data: profile } = await supabase
        .from("profiles")
        .select("email")
        .eq("user_id", invoice.user_id)
        .single();

      if (!profile?.email) {
        console.log(`No email found for user ${invoice.user_id}`);
        continue;
      }

      const serverName = invoice.orders?.server_details?.plan_name || 
                        invoice.orders?.products?.name || 
                        "Game Server";
      const paymentUrl = `${Deno.env.get("SITE_URL") || "https://your-site.com"}/client`;

      try {
        await supabase.functions.invoke("send-email", {
          body: {
            action: "payment-reminder",
            to: profile.email,
            invoiceNumber: invoice.invoice_number,
            serverName,
            dueDate: invoice.due_date,
            amount: invoice.total,
            daysUntilDue,
            paymentUrl,
          },
        });

        emailsSent.push({
          invoiceNumber: invoice.invoice_number,
          email: profile.email,
          daysUntilDue,
        });
        console.log(`Reminder sent to ${profile.email} for invoice ${invoice.invoice_number} (${daysUntilDue} days until due)`);
      } catch (emailError: any) {
        console.error(`Failed to send reminder for invoice ${invoice.invoice_number}:`, emailError);
        errors.push({
          invoiceNumber: invoice.invoice_number,
          error: emailError.message,
        });
      }
    }
  }

  return {
    success: true,
    checkedAt: now.toISOString(),
    totalInvoicesChecked: invoices?.length || 0,
    emailsSentCount: emailsSent.length,
    emailsSent,
    errorsCount: errors.length,
    errors,
    breakdown: {
      sevenDays: emailsSent.filter(e => e.daysUntilDue === 7).length,
      threeDays: emailsSent.filter(e => e.daysUntilDue === 3).length,
      oneDay: emailsSent.filter(e => e.daysUntilDue === 1).length,
    },
  };
}

async function getPendingReminders(supabase: any) {
  const now = new Date();
  const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  // Get all unpaid/overdue invoices
  const { data: invoices, error } = await supabase
    .from("invoices")
    .select("*")
    .in("status", ["unpaid", "overdue"])
    .lte("due_date", sevenDaysFromNow.toISOString())
    .order("due_date", { ascending: true });

  if (error) {
    console.error("Error fetching pending reminders:", error);
    throw new Error("Failed to fetch pending reminders");
  }

  const pendingReminders = (invoices || []).map((invoice: any) => {
    const dueDate = new Date(invoice.due_date);
    const daysUntilDue = Math.ceil((dueDate.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));

    return {
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoice_number,
      userId: invoice.user_id,
      orderId: invoice.order_id,
      serverName: "Server",
      amount: invoice.total,
      dueDate: invoice.due_date,
      daysUntilDue,
      status: invoice.status,
      isOverdue: daysUntilDue < 0,
    };
  });

  return {
    success: true,
    totalPending: pendingReminders.length,
    overdueCount: pendingReminders.filter((r: any) => r.isOverdue).length,
    dueSoonCount: pendingReminders.filter((r: any) => !r.isOverdue && r.daysUntilDue <= 3).length,
    reminders: pendingReminders,
  };
}

async function autoSuspendOverdue(supabase: any) {
  console.log("Checking for orders to suspend (overdue OR exceeded age limit)...");

  const now = new Date();
  
  // Configuration: Max server age in days (like your Node.js DAYS_LIMIT_SUSPEND = 30)
  const MAX_SERVER_AGE_DAYS = 30;
  const maxAgeDate = new Date(now.getTime() - MAX_SERVER_AGE_DAYS * 24 * 60 * 60 * 1000);

  // Get all active orders
  const { data: activeOrders, error } = await supabase
    .from("orders")
    .select("*, products(name)")
    .eq("status", "active");

  if (error) {
    console.error("Error fetching active orders:", error);
    throw new Error("Failed to fetch active orders");
  }

  const suspended: string[] = [];
  const emailsSent: string[] = [];
  const suspensionReasons: Record<string, string> = {};

  // Get Pterodactyl config once (for efficiency)
  const { data: integration } = await supabase
    .from("server_integrations")
    .select("*")
    .eq("type", "pterodactyl")
    .eq("enabled", true)
    .maybeSingle();

  for (const order of activeOrders || []) {
    const createdAt = new Date(order.created_at);
    const nextDueDate = order.next_due_date ? new Date(order.next_due_date) : null;
    
    // Check both conditions:
    // 1. Billing overdue: next_due_date has passed
    // 2. Age limit exceeded: created_at is older than MAX_SERVER_AGE_DAYS
    const isOverdue = nextDueDate && nextDueDate < now;
    const isAgeExceeded = createdAt < maxAgeDate;
    
    // Skip if neither condition is met
    if (!isOverdue && !isAgeExceeded) {
      continue;
    }

    // Determine suspension reason
    let reason = "";
    if (isOverdue && isAgeExceeded) {
      reason = "overdue_and_age_exceeded";
    } else if (isOverdue) {
      reason = "billing_overdue";
    } else {
      reason = "age_limit_exceeded";
    }

    console.log(`Processing order ${order.id} for suspension. Reason: ${reason}`);
    suspensionReasons[order.id] = reason;

    // Suspend server in Pterodactyl if configured
    if (integration && order.server_id) {
      try {
        // Get server internal ID
        const serverRes = await fetch(
          `${integration.api_url}/api/application/servers/external/${order.server_id}`,
          {
            headers: {
              Authorization: `Bearer ${integration.api_key}`,
              Accept: "application/json",
            },
          }
        );

        if (serverRes.ok) {
          const serverData = await serverRes.json();
          const internalId = serverData.attributes.id;

          // Suspend the server
          await fetch(
            `${integration.api_url}/api/application/servers/${internalId}/suspend`,
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${integration.api_key}`,
                Accept: "application/json",
              },
            }
          );

          console.log(`Successfully suspended server for order ${order.id}`);
        }
      } catch (e) {
        console.error(`Failed to suspend server for order ${order.id}:`, e);
      }
    }

    // Update order status to suspended
    await supabase
      .from("orders")
      .update({ status: "suspended" })
      .eq("id", order.id);

    suspended.push(order.id);

    // Get user email for notification
    const { data: profile } = await supabase
      .from("profiles")
      .select("email")
      .eq("user_id", order.user_id)
      .single();

    if (profile?.email) {
      try {
        // Send suspension email notification
        const serverName = order.server_details?.plan_name || order.products?.name || "Game Server";
        const paymentUrl = `${Deno.env.get("SITE_URL") || "https://your-site.com"}/client`;

        await supabase.functions.invoke("send-email", {
          body: {
            action: "server-suspended-overdue",
            to: profile.email,
            serverName,
            orderId: order.id,
            dueDate: order.next_due_date || order.created_at,
            amount: order.price || 0,
            paymentUrl,
            suspensionReason: reason,
          },
        });

        emailsSent.push(profile.email);
        console.log(`Suspension email sent to ${profile.email} for order ${order.id}`);
      } catch (emailError) {
        console.error(`Failed to send suspension email for order ${order.id}:`, emailError);
      }
    }
  }

  // Count by reason
  const overdueCount = Object.values(suspensionReasons).filter(r => r.includes("overdue")).length;
  const ageExceededCount = Object.values(suspensionReasons).filter(r => r.includes("age")).length;

  return {
    success: true,
    checkedAt: now.toISOString(),
    maxServerAgeDays: MAX_SERVER_AGE_DAYS,
    totalActiveChecked: activeOrders?.length || 0,
    suspendedCount: suspended.length,
    suspendedOrders: suspended,
    suspensionReasons,
    breakdown: {
      billingOverdue: overdueCount,
      ageExceeded: ageExceededCount,
    },
    emailsSentCount: emailsSent.length,
    emailsSent,
  };
}

async function renewService(supabase: any, orderId: string, paymentId: string) {
  console.log(`Renewing service for order ${orderId}`);

  // Get order details
  const { data: order, error: orderError } = await supabase
    .from("orders")
    .select("*")
    .eq("id", orderId)
    .single();

  if (orderError || !order) {
    throw new Error("Order not found");
  }

  // Get plan billing days
  const planId = order.server_details?.plan_id;
  let billingDays = 30;

  if (planId) {
    const { data: plan } = await supabase
      .from("game_plans")
      .select("billing_days")
      .eq("plan_id", planId)
      .maybeSingle();

    if (plan?.billing_days) {
      billingDays = plan.billing_days;
    }
  }

  // Calculate new due date
  const newDueDate = new Date();
  newDueDate.setDate(newDueDate.getDate() + billingDays);

  // If suspended, unsuspend the server
  if (order.status === "suspended" && order.server_id) {
    const { data: integration } = await supabase
      .from("server_integrations")
      .select("*")
      .eq("type", "pterodactyl")
      .eq("enabled", true)
      .maybeSingle();

    if (integration) {
      try {
        const serverRes = await fetch(
          `${integration.api_url}/api/application/servers/external/${order.server_id}`,
          {
            headers: {
              Authorization: `Bearer ${integration.api_key}`,
              Accept: "application/json",
            },
          }
        );

        if (serverRes.ok) {
          const serverData = await serverRes.json();
          const internalId = serverData.attributes.id;

          await fetch(
            `${integration.api_url}/api/application/servers/${internalId}/unsuspend`,
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${integration.api_key}`,
                Accept: "application/json",
              },
            }
          );
        }
      } catch (e) {
        console.error("Failed to unsuspend server:", e);
      }
    }
  }

  // Update order
  await supabase
    .from("orders")
    .update({
      status: "active",
      next_due_date: newDueDate.toISOString(),
    })
    .eq("id", orderId);

  return {
    success: true,
    orderId,
    newDueDate: newDueDate.toISOString(),
    billingDays,
  };
}
