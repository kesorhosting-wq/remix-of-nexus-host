import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

  try {
    const body = await req.json().catch(() => ({}));
    const { action = "check" } = body;

    console.log(`Renewal reminder action: ${action}`);

    switch (action) {
      case "check": {
        const result = await checkUpcomingRenewals(supabase);
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

      default:
        throw new Error(`Unknown action: ${action}`);
    }
  } catch (error: any) {
    console.error("Renewal reminder error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
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
