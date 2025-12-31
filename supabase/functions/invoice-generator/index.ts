import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "https://esm.sh/resend@2.0.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");

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

const ALLOWED_ACTIONS = [
  "create", "generate-renewal", "check-overdue", 
  "generate-pdf", "send-payment-confirmation", "payment-confirmed"
] as const;

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

function validateItems(items: unknown): Array<{ description: string; quantity: number; unitPrice: number }> {
  if (!Array.isArray(items)) throw new Error("items must be an array");
  if (items.length > 50) throw new Error("items cannot exceed 50 entries");
  
  return items.map((item, index) => {
    if (typeof item !== "object" || item === null) {
      throw new Error(`items[${index}] must be an object`);
    }
    const { description, quantity, unitPrice } = item as any;
    
    if (typeof description !== "string" || description.length > 500) {
      throw new Error(`items[${index}].description must be a string under 500 characters`);
    }
    if (typeof quantity !== "number" || quantity < 1 || quantity > 10000) {
      throw new Error(`items[${index}].quantity must be a number between 1 and 10000`);
    }
    if (typeof unitPrice !== "number" || unitPrice < 0 || unitPrice > 1000000) {
      throw new Error(`items[${index}].unitPrice must be a number between 0 and 1000000`);
    }
    
    return {
      description: description.replace(/<[^>]*>/g, "").trim(),
      quantity,
      unitPrice,
    };
  });
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
    const { orderId, userId, items, dueDate, notes, invoiceId } = body;

    console.log(`Invoice generator action: ${action}`);

    // ADMIN ONLY: All invoice operations require admin privileges
    await requireAdmin(req);

    switch (action) {
      case "create": {
        const validatedOrderId = orderId ? validateUUID(orderId, "orderId") : undefined;
        const validatedUserId = validateUUID(userId, "userId");
        const validatedItems = items ? validateItems(items) : undefined;
        const sanitizedNotes = typeof notes === "string" ? notes.replace(/<[^>]*>/g, "").slice(0, 1000) : undefined;
        
        const result = await createInvoice(supabase, { 
          orderId: validatedOrderId, 
          userId: validatedUserId, 
          items: validatedItems, 
          dueDate, 
          notes: sanitizedNotes 
        });
        return new Response(JSON.stringify(result), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "generate-renewal": {
        const result = await generateRenewalInvoices(supabase);
        return new Response(JSON.stringify(result), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "check-overdue": {
        const result = await checkOverdueInvoices(supabase);
        return new Response(JSON.stringify(result), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "generate-pdf": {
        const validatedInvoiceId = validateUUID(invoiceId, "invoiceId");
        const result = await generateInvoicePDF(supabase, validatedInvoiceId);
        return new Response(JSON.stringify(result), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "send-payment-confirmation": {
        const validatedInvoiceId = validateUUID(invoiceId, "invoiceId");
        const result = await sendPaymentConfirmationEmail(supabase, validatedInvoiceId);
        return new Response(JSON.stringify(result), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "payment-confirmed": {
        const validatedInvoiceId = validateUUID(invoiceId, "invoiceId");
        const result = await handlePaymentConfirmed(supabase, validatedInvoiceId);
        return new Response(JSON.stringify(result), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      default:
        throw new Error(`Unknown action: ${action}`);
    }
  } catch (error: any) {
    console.error("Invoice generator error:", error);
    
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

async function createInvoice(
  supabase: any,
  params: {
    orderId?: string;
    userId: string;
    items?: Array<{ description: string; quantity: number; unitPrice: number }>;
    dueDate?: string;
    notes?: string;
  }
) {
  const { orderId, userId, items, dueDate, notes } = params;

  let invoiceItems = items || [];
  let subtotal = 0;

  if (orderId) {
    const { data: order, error: orderError } = await supabase
      .from("orders")
      .select("*, products(*)")
      .eq("id", orderId)
      .single();

    if (orderError || !order) {
      throw new Error("Order not found");
    }

    invoiceItems = [
      {
        description: order.products?.name || order.server_details?.plan_name || "Game Server Hosting",
        quantity: 1,
        unitPrice: order.price,
      },
    ];
    subtotal = order.price;
  } else if (items && items.length > 0) {
    subtotal = items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
  }

  const invoiceNumber = `INV-${Date.now()}-${Math.random().toString(36).substr(2, 4).toUpperCase()}`;
  const calculatedDueDate = dueDate || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  const { data: invoice, error: invoiceError } = await supabase
    .from("invoices")
    .insert({
      invoice_number: invoiceNumber,
      user_id: userId,
      order_id: orderId || null,
      subtotal,
      total: subtotal,
      due_date: calculatedDueDate,
      notes,
      status: "unpaid",
    })
    .select()
    .single();

  if (invoiceError) {
    console.error("Failed to create invoice:", invoiceError);
    throw new Error("Failed to create invoice");
  }

  for (const item of invoiceItems) {
    await supabase.from("invoice_items").insert({
      invoice_id: invoice.id,
      description: item.description,
      quantity: item.quantity,
      unit_price: item.unitPrice,
      total: item.quantity * item.unitPrice,
    });
  }

  console.log("Invoice created:", invoiceNumber);

  return {
    success: true,
    invoice: {
      id: invoice.id,
      invoiceNumber,
      total: subtotal,
      dueDate: calculatedDueDate,
    },
  };
}

async function generateRenewalInvoices(supabase: any) {
  console.log("Generating renewal invoices...");

  const sevenDaysFromNow = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const today = new Date().toISOString();

  const { data: orders, error: ordersError } = await supabase
    .from("orders")
    .select("*, products(*)")
    .eq("status", "active")
    .gte("next_due_date", today)
    .lte("next_due_date", sevenDaysFromNow);

  if (ordersError) {
    throw new Error("Failed to fetch orders");
  }

  const generatedInvoices = [];

  for (const order of orders || []) {
    const { data: existingInvoice } = await supabase
      .from("invoices")
      .select("id")
      .eq("order_id", order.id)
      .eq("status", "unpaid")
      .single();

    if (existingInvoice) {
      console.log(`Renewal invoice already exists for order ${order.id}`);
      continue;
    }

    const result = await createInvoice(supabase, {
      orderId: order.id,
      userId: order.user_id,
      dueDate: order.next_due_date,
      notes: `Renewal for billing period starting ${order.next_due_date}`,
    });

    generatedInvoices.push(result.invoice);
    console.log(`Generated renewal invoice for order ${order.id}`);
  }

  return {
    success: true,
    generatedCount: generatedInvoices.length,
    invoices: generatedInvoices,
  };
}

async function checkOverdueInvoices(supabase: any) {
  console.log("Checking for overdue invoices...");

  const today = new Date().toISOString();

  const { data: overdueInvoices, error: invoicesError } = await supabase
    .from("invoices")
    .select("*, orders(*)")
    .eq("status", "unpaid")
    .lt("due_date", today);

  if (invoicesError) {
    throw new Error("Failed to fetch overdue invoices");
  }

  const suspendedOrders = [];

  for (const invoice of overdueInvoices || []) {
    const dueDate = new Date(invoice.due_date);
    const daysOverdue = Math.floor((Date.now() - dueDate.getTime()) / (24 * 60 * 60 * 1000));

    console.log(`Invoice ${invoice.invoice_number} is ${daysOverdue} days overdue`);

    if (daysOverdue > 3 && invoice.order_id && invoice.orders?.status === "active") {
      await supabase
        .from("orders")
        .update({ status: "suspended" })
        .eq("id", invoice.order_id);

      suspendedOrders.push({
        orderId: invoice.order_id,
        invoiceNumber: invoice.invoice_number,
        daysOverdue,
      });
    }

    await supabase
      .from("invoices")
      .update({ status: "overdue" })
      .eq("id", invoice.id);
  }

  return {
    success: true,
    overdueCount: overdueInvoices?.length || 0,
    suspendedCount: suspendedOrders.length,
    suspendedOrders,
  };
}

async function generateInvoicePDF(supabase: any, invoiceId: string) {
  console.log(`Generating PDF for invoice: ${invoiceId}`);

  // Fetch invoice with items and user
  const { data: invoice, error } = await supabase
    .from("invoices")
    .select("*, invoice_items(*), orders(server_details)")
    .eq("id", invoiceId)
    .single();

  if (error || !invoice) {
    throw new Error("Invoice not found");
  }

  // Get user email
  const { data: profile } = await supabase
    .from("profiles")
    .select("email")
    .eq("user_id", invoice.user_id)
    .single();

  // Get branding
  const { data: branding } = await supabase
    .from("branding_settings")
    .select("site_name, logo_url")
    .single();

  const siteName = branding?.site_name || "GameHost";

  // Generate HTML invoice
  const invoiceHtml = generateInvoiceHTML(invoice, profile?.email, siteName, branding?.logo_url);

  // For now, return the HTML - in production you'd use a PDF service
  return {
    success: true,
    invoiceId,
    invoiceNumber: invoice.invoice_number,
    html: invoiceHtml,
    // pdfUrl would be set if using a PDF generation service
  };
}

function generateInvoiceHTML(invoice: any, email: string, siteName: string, logoUrl?: string) {
  const items = invoice.invoice_items || [];
  const formatDate = (date: string) => new Date(date).toLocaleDateString('en-US', { 
    year: 'numeric', month: 'long', day: 'numeric' 
  });
  const formatCurrency = (amount: number) => `$${amount.toFixed(2)}`;

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Invoice ${invoice.invoice_number}</title>
  <style>
    body { font-family: Arial, sans-serif; color: #333; max-width: 800px; margin: 0 auto; padding: 40px; }
    .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 40px; }
    .logo { font-size: 24px; font-weight: bold; color: #6366f1; }
    .invoice-title { text-align: right; }
    .invoice-title h1 { margin: 0; font-size: 32px; color: #1f2937; }
    .invoice-number { color: #6b7280; margin-top: 5px; }
    .details { display: flex; justify-content: space-between; margin-bottom: 40px; }
    .details-section h3 { margin: 0 0 10px 0; font-size: 14px; color: #6b7280; text-transform: uppercase; }
    .details-section p { margin: 5px 0; }
    .status { display: inline-block; padding: 4px 12px; border-radius: 20px; font-size: 12px; font-weight: bold; }
    .status-paid { background: #d1fae5; color: #059669; }
    .status-unpaid { background: #fee2e2; color: #dc2626; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 30px; }
    th { background: #f3f4f6; padding: 12px; text-align: left; font-size: 12px; text-transform: uppercase; color: #6b7280; }
    td { padding: 12px; border-bottom: 1px solid #e5e7eb; }
    .totals { text-align: right; }
    .totals-row { display: flex; justify-content: flex-end; margin-bottom: 8px; }
    .totals-label { width: 120px; color: #6b7280; }
    .totals-value { width: 100px; font-weight: bold; }
    .grand-total { font-size: 20px; color: #6366f1; border-top: 2px solid #e5e7eb; padding-top: 10px; margin-top: 10px; }
    .footer { margin-top: 60px; padding-top: 20px; border-top: 1px solid #e5e7eb; text-align: center; color: #9ca3af; font-size: 12px; }
  </style>
</head>
<body>
  <div class="header">
    <div class="logo">${logoUrl ? `<img src="${logoUrl}" alt="${siteName}" style="height: 40px;">` : siteName}</div>
    <div class="invoice-title">
      <h1>INVOICE</h1>
      <p class="invoice-number">#${invoice.invoice_number}</p>
    </div>
  </div>

  <div class="details">
    <div class="details-section">
      <h3>Bill To</h3>
      <p>${email || 'Customer'}</p>
    </div>
    <div class="details-section">
      <h3>Invoice Details</h3>
      <p><strong>Date:</strong> ${formatDate(invoice.created_at)}</p>
      <p><strong>Due Date:</strong> ${formatDate(invoice.due_date)}</p>
      <p><strong>Status:</strong> <span class="status ${invoice.status === 'paid' ? 'status-paid' : 'status-unpaid'}">${invoice.status.toUpperCase()}</span></p>
      ${invoice.paid_at ? `<p><strong>Paid:</strong> ${formatDate(invoice.paid_at)}</p>` : ''}
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th>Description</th>
        <th style="text-align: center;">Qty</th>
        <th style="text-align: right;">Unit Price</th>
        <th style="text-align: right;">Total</th>
      </tr>
    </thead>
    <tbody>
      ${items.map((item: any) => `
        <tr>
          <td>${item.description}</td>
          <td style="text-align: center;">${item.quantity}</td>
          <td style="text-align: right;">${formatCurrency(item.unit_price)}</td>
          <td style="text-align: right;">${formatCurrency(item.total)}</td>
        </tr>
      `).join('')}
    </tbody>
  </table>

  <div class="totals">
    <div class="totals-row">
      <span class="totals-label">Subtotal:</span>
      <span class="totals-value">${formatCurrency(invoice.subtotal)}</span>
    </div>
    ${invoice.tax ? `
    <div class="totals-row">
      <span class="totals-label">Tax:</span>
      <span class="totals-value">${formatCurrency(invoice.tax)}</span>
    </div>
    ` : ''}
    ${invoice.discount ? `
    <div class="totals-row">
      <span class="totals-label">Discount:</span>
      <span class="totals-value">-${formatCurrency(invoice.discount)}</span>
    </div>
    ` : ''}
    <div class="totals-row grand-total">
      <span class="totals-label">Total:</span>
      <span class="totals-value">${formatCurrency(invoice.total)}</span>
    </div>
  </div>

  ${invoice.notes ? `<p><strong>Notes:</strong> ${invoice.notes}</p>` : ''}

  <div class="footer">
    <p>Thank you for your business!</p>
    <p>${siteName}</p>
  </div>
</body>
</html>`;
}

async function sendPaymentConfirmationEmail(supabase: any, invoiceId: string) {
  if (!RESEND_API_KEY) {
    console.log("Resend API key not configured, skipping email");
    return { success: false, error: "Email not configured" };
  }

  const resend = new Resend(RESEND_API_KEY);

  // Fetch invoice
  const { data: invoice, error } = await supabase
    .from("invoices")
    .select("*, invoice_items(*), orders(server_details)")
    .eq("id", invoiceId)
    .single();

  if (error || !invoice) {
    throw new Error("Invoice not found");
  }

  // Get user email
  const { data: profile } = await supabase
    .from("profiles")
    .select("email")
    .eq("user_id", invoice.user_id)
    .single();

  if (!profile?.email) {
    throw new Error("User email not found");
  }

  // Get branding
  const { data: branding } = await supabase
    .from("branding_settings")
    .select("site_name")
    .single();

  const siteName = branding?.site_name || "GameHost";
  const serverName = invoice.orders?.server_details?.name || "your server";

  const emailHtml = `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; background-color: #f4f4f5; margin: 0; padding: 40px; }
    .container { max-width: 600px; margin: 0 auto; background: white; border-radius: 12px; overflow: hidden; }
    .header { background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); color: white; padding: 40px; text-align: center; }
    .header h1 { margin: 0; font-size: 28px; }
    .content { padding: 40px; }
    .success-icon { width: 60px; height: 60px; background: #d1fae5; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 20px; }
    .details { background: #f9fafb; border-radius: 8px; padding: 20px; margin: 20px 0; }
    .detail-row { display: flex; justify-content: space-between; margin-bottom: 10px; }
    .detail-label { color: #6b7280; }
    .detail-value { font-weight: bold; }
    .total { font-size: 24px; color: #6366f1; text-align: center; margin: 20px 0; }
    .footer { text-align: center; padding: 20px; color: #9ca3af; font-size: 12px; }
    .btn { display: inline-block; background: #6366f1; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; margin-top: 20px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Payment Confirmed! ✓</h1>
    </div>
    <div class="content">
      <div class="success-icon">
        <svg width="24" height="24" fill="none" stroke="#059669" stroke-width="3"><path d="M5 13l4 4L19 7"/></svg>
      </div>
      <p style="text-align: center; font-size: 18px;">Thank you for your payment!</p>
      
      <div class="details">
        <div class="detail-row">
          <span class="detail-label">Invoice Number</span>
          <span class="detail-value">#${invoice.invoice_number}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Service</span>
          <span class="detail-value">${serverName}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Payment Date</span>
          <span class="detail-value">${new Date(invoice.paid_at || Date.now()).toLocaleDateString()}</span>
        </div>
      </div>
      
      <div class="total">
        Amount Paid: $${invoice.total.toFixed(2)}
      </div>
      
      <p style="text-align: center;">Your server "${serverName}" is now active and ready to use.</p>
      
      <div style="text-align: center;">
        <a href="#" class="btn">View My Services</a>
      </div>
    </div>
    <div class="footer">
      <p>This is an automated email from ${siteName}.</p>
      <p>If you have any questions, please contact our support team.</p>
    </div>
  </div>
</body>
</html>`;

  try {
    const emailResponse = await resend.emails.send({
      from: `${siteName} <onboarding@resend.dev>`,
      to: [profile.email],
      subject: `Payment Confirmed - Invoice #${invoice.invoice_number}`,
      html: emailHtml,
    });

    console.log("Payment confirmation email sent:", emailResponse);

    return {
      success: true,
      messageId: (emailResponse as any).data?.id || "sent",
    };
  } catch (emailError: any) {
    console.error("Failed to send email:", emailError);
    return {
      success: false,
      error: emailError.message,
    };
  }
}

async function handlePaymentConfirmed(supabase: any, invoiceId: string) {
  console.log(`Handling payment confirmation for invoice: ${invoiceId}`);

  // Update invoice status
  await supabase
    .from("invoices")
    .update({ 
      status: "paid", 
      paid_at: new Date().toISOString() 
    })
    .eq("id", invoiceId);

  // Generate PDF (for records)
  const pdfResult = await generateInvoicePDF(supabase, invoiceId);

  // Send confirmation email
  const emailResult = await sendPaymentConfirmationEmail(supabase, invoiceId);

  return {
    success: true,
    invoiceId,
    pdfGenerated: pdfResult.success,
    emailSent: emailResult.success,
  };
}
