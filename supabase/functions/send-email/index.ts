import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";

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
  
  // Check if this is a service role call (internal edge function to edge function)
  // Service role key is used for internal calls between edge functions
  if (token === SUPABASE_SERVICE_ROLE_KEY) {
    console.log("Service role key detected - internal call authorized");
    return { user: { id: "service-role" }, isAdmin: true };
  }
  
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

async function requireAdminOrService(req: Request): Promise<AuthResult> {
  const auth = await getAuthUser(req);
  if (!auth) throw new Error("Unauthorized: No valid authentication token");
  if (!auth.isAdmin) throw new Error("Forbidden: Admin access required");
  console.log(`Access granted for: ${auth.user.id}`);
  return auth;
}

// ============= Input Validation =============

const ALLOWED_ACTIONS = [
  "test", "welcome", "password-reset", "payment-confirmation", 
  "server-setup-complete", "renewal-reminder", "service-suspended",
  "service-terminated", "service-reactivated", "panel-credentials",
  "panel-password-reset", "server-suspended-overdue", "payment-reminder",
  "server-age-warning", "sync-welcome"
] as const;

function validateAction(action: unknown): typeof ALLOWED_ACTIONS[number] {
  if (typeof action !== "string" || !ALLOWED_ACTIONS.includes(action as any)) {
    throw new Error(`Invalid action. Must be one of: ${ALLOWED_ACTIONS.join(", ")}`);
  }
  return action as typeof ALLOWED_ACTIONS[number];
}

function validateEmail(value: unknown): string {
  if (typeof value !== "string") throw new Error("Email must be a string");
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(value) || value.length > 255) {
    throw new Error("Invalid email address");
  }
  return value;
}

function validateUUID(value: unknown, fieldName: string): string {
  if (typeof value !== "string") throw new Error(`${fieldName} must be a string`);
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(value)) throw new Error(`${fieldName} must be a valid UUID`);
  return value;
}

function sanitizeString(value: unknown, maxLength = 1000): string {
  if (typeof value !== "string") return "";
  return value.replace(/<[^>]*>/g, "").trim().slice(0, maxLength);
}

// ============= SMTP Functions =============

async function getSMTPSettings(supabase: any) {
  const { data, error } = await supabase
    .from("smtp_settings")
    .select("*")
    .maybeSingle();
  
  if (error) {
    console.log("Error fetching SMTP settings:", error);
    return null;
  }
  
  if (!data || !data.enabled) {
    console.log("Email notifications are not configured or disabled");
    return null;
  }
  
  return data;
}

async function sendEmailViaSMTP(
  settings: any,
  to: string,
  subject: string,
  html: string
): Promise<{ success: boolean; messageId?: string; method: string }> {
  console.log(`Sending email via SMTP to: ${to}`);
  console.log(`SMTP Host: ${settings.host}:${settings.port}, Encryption: ${settings.encryption}`);
  
  // denomailer tls config:
  // true = direct SSL/TLS connection (port 465)
  // false = plain connection, will auto-upgrade via STARTTLS if server supports it (port 587/25)
  const useTls = settings.encryption === "ssl";
  
  console.log(`Using direct TLS: ${useTls}`);
  
  const client = new SMTPClient({
    connection: {
      hostname: settings.host,
      port: settings.port,
      tls: useTls,
      auth: {
        username: settings.username,
        password: settings.password,
      },
    },
  });

  try {
    await client.send({
      from: `${settings.from_name} <${settings.from_email}>`,
      to: to,
      subject: subject,
      content: "Please view this email in an HTML-enabled client.",
      html: html,
    });

    await client.close();
    console.log(`Email sent successfully via SMTP to ${to}`);
    return { success: true, method: 'smtp' };
  } catch (error: any) {
    console.error("SMTP send error:", error);
    try { await client.close(); } catch (e) { /* ignore close errors */ }
    throw error;
  }
}

async function sendEmailViaResend(
  settings: any,
  to: string,
  subject: string,
  html: string
): Promise<{ success: boolean; id?: string; method: string }> {
  const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
  if (!RESEND_API_KEY) {
    throw new Error("RESEND_API_KEY not configured");
  }
  
  console.log("Using Resend API for email delivery");
  
  // Use Resend's default domain for public domains
  const publicDomains = ['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'icloud.com', 'aol.com'];
  const emailDomain = settings.from_email?.split('@')[1]?.toLowerCase() || '';
  const isPublicDomain = publicDomains.includes(emailDomain);
  
  const fromEmail = isPublicDomain 
    ? `${settings.from_name || 'Notifications'} <onboarding@resend.dev>` 
    : `${settings.from_name || 'Notifications'} <${settings.from_email}>`;
  
  console.log(`From: ${fromEmail}`);
  if (isPublicDomain) {
    console.log(`Note: Using Resend default sender. Add your domain at https://resend.com/domains for custom sender.`);
  }
  
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: fromEmail,
      to: [to],
      subject: subject,
      html: html,
      reply_to: settings.from_email,
    }),
  });
  
  if (!response.ok) {
    const errorText = await response.text();
    console.error(`Resend API error (${response.status}):`, errorText);
    throw new Error(`Resend API error: ${errorText}`);
  }
  
  const result = await response.json();
  console.log(`Email sent via Resend, ID: ${result.id}`);
  return { success: true, id: result.id, method: 'resend' };
}

async function sendEmail(
  settings: any, 
  to: string, 
  subject: string, 
  html: string, 
  supabase: any,
  action: string,
  metadata: any = {}
) {
  console.log(`=== Sending email ===`);
  console.log(`To: ${to}`);
  console.log(`Subject: ${subject}`);
  console.log(`Action: ${action}`);
  
  const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
  const hasFullSMTP = settings.host && settings.username && settings.password;
  
  console.log(`RESEND_API_KEY available: ${!!RESEND_API_KEY}`);
  console.log(`Full SMTP configured: ${hasFullSMTP}`);
  
  try {
    // Priority 1: Use Resend API (more reliable from edge functions)
    if (RESEND_API_KEY) {
      const result = await sendEmailViaResend(settings, to, subject, html);
      await logEmail(supabase, action, to, subject, 'sent', null, { ...metadata, ...result });
      return result;
    }
    
    // Priority 2: Use direct SMTP if configured
    if (hasFullSMTP) {
      const result = await sendEmailViaSMTP(settings, to, subject, html);
      await logEmail(supabase, action, to, subject, 'sent', null, { ...metadata, ...result });
      return result;
    }
    
    // Fallback: Log the email (useful for development)
    console.log("Email simulated (no SMTP or Resend configured):");
    console.log({ to, subject, htmlPreview: html.substring(0, 200) + "..." });
    
    await logEmail(supabase, action, to, subject, 'simulated', null, { ...metadata, method: 'simulated' });
    return { success: true, method: 'simulated', message: "Email logged (configure RESEND_API_KEY or SMTP for actual sending)" };
  } catch (error: any) {
    console.error("Email send error:", error);
    await logEmail(supabase, action, to, subject, 'failed', error.message, metadata);
    throw error;
  }
}

async function logEmail(
  supabase: any,
  action: string,
  recipient: string,
  subject: string | null,
  status: string,
  errorMessage: string | null,
  metadata: any = {}
) {
  try {
    await supabase.from('email_logs').insert({
      action,
      recipient,
      subject,
      status,
      error_message: errorMessage,
      metadata,
    });
    console.log(`Email logged: ${action} to ${recipient} - ${status}`);
  } catch (err) {
    console.error('Failed to log email:', err);
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    const body = await req.json();
    const action = validateAction(body.action);
    const { to, orderId, invoiceId, serverDetails, resetUrl, userName } = body;

    console.log(`Email action: ${action}`);

    // Admin or internal service call required for email sending
    // This prevents unauthorized users from sending emails to arbitrary addresses
    await requireAdminOrService(req);

    const settings = await getSMTPSettings(supabase);
    
    // If email is not configured, return success but log that email was skipped
    if (!settings) {
      console.log(`Email action "${action}" skipped - notifications not configured or disabled`);
      return new Response(JSON.stringify({ success: true, skipped: true, message: "Email notifications are disabled" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    switch (action) {
      case "test": {
        const validatedTo = to ? validateEmail(to) : settings.from_email;
        const html = generateTestEmail(settings.from_name);
        await sendEmail(settings, validatedTo, "Test Email", html, supabase, action);
        return new Response(JSON.stringify({ success: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "welcome": {
        const { data: profile } = await supabase
          .from("profiles")
          .select("email")
          .eq("user_id", to)
          .single();
        
        const email = profile?.email || to;
        const html = generateWelcomeEmail(userName || email.split("@")[0], settings.from_name);
        await sendEmail(settings, email, `Welcome to ${settings.from_name}!`, html, supabase, action, { userName });
        
        return new Response(JSON.stringify({ success: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "password-reset": {
        const html = generatePasswordResetEmail(resetUrl, settings.from_name);
        await sendEmail(settings, to, "Reset Your Password", html, supabase, action);
        
        return new Response(JSON.stringify({ success: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "payment-confirmation": {
        const { data: invoice } = await supabase
          .from("invoices")
          .select("*, orders(*)")
          .eq("id", invoiceId)
          .single();
        
        if (!invoice) throw new Error("Invoice not found");
        
        const { data: profile } = await supabase
          .from("profiles")
          .select("email")
          .eq("user_id", invoice.user_id)
          .single();
        
        if (!profile?.email) throw new Error("User email not found");
        
        const html = generatePaymentConfirmationEmail(invoice, settings.from_name);
        await sendEmail(settings, profile.email, `Payment Received - Invoice #${invoice.invoice_number}`, html, supabase, action, { invoiceId, invoiceNumber: invoice.invoice_number });
        
        return new Response(JSON.stringify({ success: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "server-setup-complete": {
        const { data: order } = await supabase
          .from("orders")
          .select("*, products(name)")
          .eq("id", orderId)
          .single();
        
        if (!order) throw new Error("Order not found");
        
        const { data: profile } = await supabase
          .from("profiles")
          .select("email")
          .eq("user_id", order.user_id)
          .single();
        
        if (!profile?.email) throw new Error("User email not found");
        
        const html = generateServerSetupEmail(order, serverDetails, settings.from_name);
        await sendEmail(settings, profile.email, "Your Server is Ready!", html, supabase, action, { orderId });
        
        return new Response(JSON.stringify({ success: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "renewal-reminder": {
        const { data: order } = await supabase
          .from("orders")
          .select("*, products(name)")
          .eq("id", orderId)
          .single();
        
        if (!order) throw new Error("Order not found");
        
        const { data: profile } = await supabase
          .from("profiles")
          .select("email")
          .eq("user_id", order.user_id)
          .single();
        
        if (!profile?.email) throw new Error("User email not found");
        
        const html = generateRenewalReminderEmail(order, settings.from_name);
        await sendEmail(settings, profile.email, "Renewal Reminder - Action Required", html, supabase, action, { orderId });
        
        return new Response(JSON.stringify({ success: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "service-suspended": {
        const { data: order } = await supabase
          .from("orders")
          .select("*, products(name)")
          .eq("id", orderId)
          .single();
        
        if (!order) throw new Error("Order not found");
        
        const { data: profile } = await supabase
          .from("profiles")
          .select("email")
          .eq("user_id", order.user_id)
          .single();
        
        if (!profile?.email) throw new Error("User email not found");
        
        const html = generateServiceSuspendedEmail(order, settings.from_name);
        await sendEmail(settings, profile.email, "Service Suspended - Action Required", html, supabase, action, { orderId });
        
        return new Response(JSON.stringify({ success: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "service-terminated": {
        const { data: order } = await supabase
          .from("orders")
          .select("*, products(name)")
          .eq("id", orderId)
          .single();
        
        if (!order) throw new Error("Order not found");
        
        const { data: profile } = await supabase
          .from("profiles")
          .select("email")
          .eq("user_id", order.user_id)
          .single();
        
        if (!profile?.email) throw new Error("User email not found");
        
        const html = generateServiceTerminatedEmail(order, settings.from_name);
        await sendEmail(settings, profile.email, "Service Terminated", html, supabase, action, { orderId });
        
        return new Response(JSON.stringify({ success: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "service-reactivated": {
        const { data: order } = await supabase
          .from("orders")
          .select("*, products(name)")
          .eq("id", orderId)
          .single();
        
        if (!order) throw new Error("Order not found");
        
        const { data: profile } = await supabase
          .from("profiles")
          .select("email")
          .eq("user_id", order.user_id)
          .single();
        
        if (!profile?.email) throw new Error("User email not found");
        
        const html = generateServiceReactivatedEmail(order, settings.from_name);
        await sendEmail(settings, profile.email, "Service Reactivated - Welcome Back!", html, supabase, action, { orderId });
        
        return new Response(JSON.stringify({ success: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "panel-credentials": {
        const { panelCredentials, panelUrl, serverName } = body;
        
        if (!to) throw new Error("Recipient email not provided");
        if (!panelCredentials) throw new Error("Panel credentials not provided");
        
        const html = generatePanelCredentialsEmail(panelCredentials, panelUrl, serverName, settings.from_name);
        await sendEmail(settings, to, "Your Game Panel Login Credentials", html, supabase, action, { serverName });
        
        return new Response(JSON.stringify({ success: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "panel-password-reset": {
        const { newPassword, panelUrl } = body;
        
        if (!to) throw new Error("Recipient email not provided");
        if (!newPassword) throw new Error("New password not provided");
        
        const html = generatePanelPasswordResetEmail(to, newPassword, panelUrl, settings.from_name);
        await sendEmail(settings, to, "Your Game Panel Password Has Been Reset", html, supabase, action);
        
        return new Response(JSON.stringify({ success: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "server-suspended-overdue": {
        const { serverName, orderId, dueDate, amount, paymentUrl } = body;
        
        if (!to) throw new Error("Recipient email not provided");
        
        const html = generateServerSuspendedOverdueEmail(serverName, orderId, dueDate, amount, paymentUrl, settings.from_name);
        await sendEmail(settings, to, "⚠️ Server Suspended - Payment Overdue", html, supabase, action, { serverName, orderId, amount });
        
        return new Response(JSON.stringify({ success: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "payment-reminder": {
        const { invoiceNumber, serverName, dueDate, amount, daysUntilDue, paymentUrl } = body;
        
        if (!to) throw new Error("Recipient email not provided");
        
        const urgency = daysUntilDue <= 1 ? "urgent" : daysUntilDue <= 3 ? "warning" : "notice";
        const html = generatePaymentReminderEmail(invoiceNumber, serverName, dueDate, amount, daysUntilDue, paymentUrl, urgency, settings.from_name);
        
        const subjectPrefix = daysUntilDue <= 1 ? "🚨 URGENT:" : daysUntilDue <= 3 ? "⚠️" : "📋";
        const subject = `${subjectPrefix} Payment Due ${daysUntilDue === 1 ? "Tomorrow" : `in ${daysUntilDue} Days`} - Invoice #${invoiceNumber}`;
        
        await sendEmail(settings, to, subject, html, supabase, action, { invoiceNumber, daysUntilDue, amount });
        
        return new Response(JSON.stringify({ success: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "server-age-warning": {
        const { serverName, orderId, createdAt, daysOld, daysUntilSuspension, paymentUrl } = body;
        
        if (!to) throw new Error("Recipient email not provided");
        
        const html = generateServerAgeWarningEmail(to, serverName, createdAt, daysOld, daysUntilSuspension, paymentUrl, settings.from_name);
        await sendEmail(settings, to, `⚠️ Warning: Your server ${serverName} will be suspended in ${daysUntilSuspension} days`, html, supabase, action, { orderId, daysOld, daysUntilSuspension });
        
        return new Response(JSON.stringify({ success: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "sync-welcome": {
        const { password, panelUrl, servers } = body;
        
        if (!to) throw new Error("Recipient email not provided");
        if (!password) throw new Error("Password not provided");
        if (!servers || !Array.isArray(servers)) throw new Error("Servers list not provided");
        
        const html = generateSyncWelcomeEmail(to, password, panelUrl, servers, settings.from_name);
        await sendEmail(
          settings, 
          to, 
          `🎮 Welcome! Your Account & ${servers.length} Server${servers.length > 1 ? 's' : ''} Are Ready`, 
          html, 
          supabase, 
          action, 
          { serverCount: servers.length }
        );
        
        return new Response(JSON.stringify({ success: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      default:
        throw new Error(`Unknown action: ${action}`);
    }
  } catch (error: any) {
    console.error("Email error:", error);
    
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

function generateTestEmail(brandName: string): string {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
    </head>
    <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; margin: 0; padding: 0; background-color: #f4f4f5;">
      <div style="max-width: 600px; margin: 0 auto; padding: 40px 20px;">
        <div style="background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); padding: 40px; border-radius: 16px 16px 0 0; text-align: center;">
          <h1 style="color: white; margin: 0; font-size: 28px;">✉️ Test Email</h1>
        </div>
        <div style="background: white; padding: 40px; border-radius: 0 0 16px 16px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
          <p style="color: #374151; font-size: 16px; line-height: 1.6;">
            This is a test email from <strong>${brandName}</strong>.
          </p>
          <p style="color: #374151; font-size: 16px; line-height: 1.6;">
            If you received this email, your SMTP settings are configured correctly! 🎉
          </p>
          <div style="margin-top: 30px; padding: 20px; background: #f0fdf4; border-radius: 8px; border-left: 4px solid #22c55e;">
            <p style="margin: 0; color: #166534; font-weight: 600;">✓ Email delivery is working</p>
          </div>
        </div>
        <p style="text-align: center; color: #9ca3af; font-size: 14px; margin-top: 20px;">
          ${brandName} • Email Notifications
        </p>
      </div>
    </body>
    </html>
  `;
}

function generateWelcomeEmail(userName: string, brandName: string): string {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
    </head>
    <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; margin: 0; padding: 0; background-color: #f4f4f5;">
      <div style="max-width: 600px; margin: 0 auto; padding: 40px 20px;">
        <div style="background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); padding: 40px; border-radius: 16px 16px 0 0; text-align: center;">
          <div style="width: 80px; height: 80px; background: white; border-radius: 50%; margin: 0 auto 20px; display: flex; align-items: center; justify-content: center;">
            <span style="font-size: 40px;">🎮</span>
          </div>
          <h1 style="color: white; margin: 0; font-size: 28px;">Welcome to ${brandName}!</h1>
        </div>
        <div style="background: white; padding: 40px; border-radius: 0 0 16px 16px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
          <p style="color: #374151; font-size: 18px; line-height: 1.6;">
            Hey <strong>${userName}</strong>! 👋
          </p>
          <p style="color: #374151; font-size: 16px; line-height: 1.6;">
            Welcome aboard! We're thrilled to have you join our gaming community. Your account has been successfully created and you're ready to start hosting your game servers.
          </p>
          
          <div style="background: linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 100%); border-radius: 12px; padding: 24px; margin: 24px 0; border: 1px solid #bae6fd;">
            <h3 style="margin: 0 0 16px 0; color: #0369a1;">🚀 Getting Started</h3>
            <ul style="margin: 0; padding-left: 20px; color: #0c4a6e;">
              <li style="margin-bottom: 8px;">Browse our available game servers</li>
              <li style="margin-bottom: 8px;">Choose a plan that fits your needs</li>
              <li style="margin-bottom: 8px;">Complete checkout and your server will be ready in minutes</li>
              <li>Manage your servers from our easy-to-use control panel</li>
            </ul>
          </div>
          
          <div style="background: #fef3c7; border-radius: 8px; padding: 16px; margin: 24px 0; border-left: 4px solid #f59e0b;">
            <p style="margin: 0; color: #92400e; font-size: 14px;">
              <strong>💡 Pro Tip:</strong> Need help? Our support team is available 24/7 through our ticket system!
            </p>
          </div>
          
          <a href="#" style="display: block; background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); color: white; text-decoration: none; padding: 16px 32px; border-radius: 8px; font-weight: 600; text-align: center; margin-top: 24px;">
            Start Exploring
          </a>
        </div>
        <p style="text-align: center; color: #9ca3af; font-size: 14px; margin-top: 20px;">
          ${brandName} • Premium Game Hosting
        </p>
      </div>
    </body>
    </html>
  `;
}

function generatePasswordResetEmail(resetUrl: string, brandName: string): string {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
    </head>
    <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; margin: 0; padding: 0; background-color: #f4f4f5;">
      <div style="max-width: 600px; margin: 0 auto; padding: 40px 20px;">
        <div style="background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%); padding: 40px; border-radius: 16px 16px 0 0; text-align: center;">
          <div style="width: 60px; height: 60px; background: white; border-radius: 50%; margin: 0 auto 20px; display: flex; align-items: center; justify-content: center;">
            <span style="font-size: 30px;">🔐</span>
          </div>
          <h1 style="color: white; margin: 0; font-size: 28px;">Password Reset Request</h1>
        </div>
        <div style="background: white; padding: 40px; border-radius: 0 0 16px 16px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
          <p style="color: #374151; font-size: 16px; line-height: 1.6;">
            We received a request to reset your password for your ${brandName} account.
          </p>
          <p style="color: #374151; font-size: 16px; line-height: 1.6;">
            Click the button below to set a new password. This link will expire in 1 hour.
          </p>
          
          <a href="${resetUrl}" style="display: block; background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); color: white; text-decoration: none; padding: 16px 32px; border-radius: 8px; font-weight: 600; text-align: center; margin: 24px 0;">
            Reset Password
          </a>
          
          <div style="background: #fef2f2; border-radius: 8px; padding: 16px; margin: 24px 0; border-left: 4px solid #ef4444;">
            <p style="margin: 0; color: #991b1b; font-size: 14px;">
              <strong>⚠️ Didn't request this?</strong> If you didn't request a password reset, please ignore this email. Your password will remain unchanged.
            </p>
          </div>
          
          <p style="color: #6b7280; font-size: 14px; line-height: 1.6;">
            If the button doesn't work, copy and paste this link into your browser:
          </p>
          <p style="color: #6366f1; font-size: 12px; word-break: break-all; font-family: monospace; background: #f4f4f5; padding: 12px; border-radius: 6px;">
            ${resetUrl}
          </p>
        </div>
        <p style="text-align: center; color: #9ca3af; font-size: 14px; margin-top: 20px;">
          ${brandName} • Account Security
        </p>
      </div>
    </body>
    </html>
  `;
}

function generatePaymentConfirmationEmail(invoice: any, brandName: string): string {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
    </head>
    <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; margin: 0; padding: 0; background-color: #f4f4f5;">
      <div style="max-width: 600px; margin: 0 auto; padding: 40px 20px;">
        <div style="background: linear-gradient(135deg, #22c55e 0%, #16a34a 100%); padding: 40px; border-radius: 16px 16px 0 0; text-align: center;">
          <div style="width: 60px; height: 60px; background: white; border-radius: 50%; margin: 0 auto 20px; display: flex; align-items: center; justify-content: center;">
            <span style="font-size: 30px;">✓</span>
          </div>
          <h1 style="color: white; margin: 0; font-size: 28px;">Payment Received!</h1>
        </div>
        <div style="background: white; padding: 40px; border-radius: 0 0 16px 16px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
          <p style="color: #374151; font-size: 16px; line-height: 1.6;">
            Thank you for your payment! Your transaction has been completed successfully.
          </p>
          
          <div style="background: #f9fafb; border-radius: 12px; padding: 24px; margin: 24px 0;">
            <table style="width: 100%; border-collapse: collapse;">
              <tr>
                <td style="padding: 8px 0; color: #6b7280;">Invoice Number</td>
                <td style="padding: 8px 0; text-align: right; font-weight: 600; color: #111827;">#${invoice.invoice_number}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: #6b7280;">Amount Paid</td>
                <td style="padding: 8px 0; text-align: right; font-weight: 600; color: #22c55e; font-size: 20px;">$${invoice.total.toFixed(2)}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: #6b7280;">Payment Method</td>
                <td style="padding: 8px 0; text-align: right; font-weight: 600; color: #111827;">${invoice.payment_method || 'Online Payment'}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: #6b7280;">Date</td>
                <td style="padding: 8px 0; text-align: right; font-weight: 600; color: #111827;">${new Date().toLocaleDateString()}</td>
              </tr>
            </table>
          </div>
          
          <p style="color: #6b7280; font-size: 14px; line-height: 1.6;">
            Your server is being set up. You'll receive another email once it's ready with connection details.
          </p>
          
          <a href="#" style="display: block; background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); color: white; text-decoration: none; padding: 16px 32px; border-radius: 8px; font-weight: 600; text-align: center; margin-top: 24px;">
            View Invoice
          </a>
        </div>
        <p style="text-align: center; color: #9ca3af; font-size: 14px; margin-top: 20px;">
          ${brandName} • Thank you for choosing us!
        </p>
      </div>
    </body>
    </html>
  `;
}

function generateServerSetupEmail(order: any, serverDetails: any, brandName: string): string {
  const details = order.server_details || serverDetails || {};
  const serverAddress = details.ip && details.port ? `${details.ip}:${details.port}` : 'Check your panel';
  
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
    </head>
    <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; margin: 0; padding: 0; background-color: #f4f4f5;">
      <div style="max-width: 600px; margin: 0 auto; padding: 40px 20px;">
        <div style="background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); padding: 40px; border-radius: 16px 16px 0 0; text-align: center;">
          <div style="width: 60px; height: 60px; background: white; border-radius: 50%; margin: 0 auto 20px; display: flex; align-items: center; justify-content: center;">
            <span style="font-size: 30px;">🚀</span>
          </div>
          <h1 style="color: white; margin: 0; font-size: 28px;">Your Server is Ready!</h1>
        </div>
        <div style="background: white; padding: 40px; border-radius: 0 0 16px 16px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
          <p style="color: #374151; font-size: 16px; line-height: 1.6;">
            Great news! Your server has been set up and is ready to use.
          </p>
          
          <div style="background: linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 100%); border-radius: 12px; padding: 24px; margin: 24px 0; border: 1px solid #bae6fd;">
            <h3 style="margin: 0 0 16px 0; color: #0369a1;">Server Details</h3>
            <table style="width: 100%; border-collapse: collapse;">
              <tr>
                <td style="padding: 8px 0; color: #0369a1;">Service</td>
                <td style="padding: 8px 0; text-align: right; font-weight: 600; color: #0c4a6e;">${details.plan_name || order.products?.name || 'Server'}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: #0369a1;">Server Address</td>
                <td style="padding: 8px 0; text-align: right; font-weight: 600; color: #0c4a6e; font-family: monospace;">${serverAddress}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: #0369a1;">Server ID</td>
                <td style="padding: 8px 0; text-align: right; font-weight: 600; color: #0c4a6e; font-family: monospace;">${order.server_id || 'N/A'}</td>
              </tr>
            </table>
          </div>
          
          <div style="background: #fef3c7; border-radius: 8px; padding: 16px; margin: 24px 0; border-left: 4px solid #f59e0b;">
            <p style="margin: 0; color: #92400e; font-size: 14px;">
              <strong>💡 Tip:</strong> You can manage your server from the control panel to start, stop, restart, or access the console.
            </p>
          </div>
          
          <a href="#" style="display: block; background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); color: white; text-decoration: none; padding: 16px 32px; border-radius: 8px; font-weight: 600; text-align: center; margin-top: 24px;">
            Access Control Panel
          </a>
        </div>
        <p style="text-align: center; color: #9ca3af; font-size: 14px; margin-top: 20px;">
          ${brandName} • Happy Gaming! 🎮
        </p>
      </div>
    </body>
    </html>
  `;
}

function generateRenewalReminderEmail(order: any, brandName: string): string {
  const dueDate = order.next_due_date ? new Date(order.next_due_date).toLocaleDateString() : 'Soon';
  
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
    </head>
    <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; margin: 0; padding: 0; background-color: #f4f4f5;">
      <div style="max-width: 600px; margin: 0 auto; padding: 40px 20px;">
        <div style="background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%); padding: 40px; border-radius: 16px 16px 0 0; text-align: center;">
          <div style="width: 60px; height: 60px; background: white; border-radius: 50%; margin: 0 auto 20px; display: flex; align-items: center; justify-content: center;">
            <span style="font-size: 30px;">⏰</span>
          </div>
          <h1 style="color: white; margin: 0; font-size: 28px;">Renewal Reminder</h1>
        </div>
        <div style="background: white; padding: 40px; border-radius: 0 0 16px 16px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
          <p style="color: #374151; font-size: 16px; line-height: 1.6;">
            Your service is due for renewal soon. Please renew to avoid any interruption.
          </p>
          
          <div style="background: #fef3c7; border-radius: 12px; padding: 24px; margin: 24px 0; border: 1px solid #fcd34d;">
            <table style="width: 100%; border-collapse: collapse;">
              <tr>
                <td style="padding: 8px 0; color: #92400e;">Service</td>
                <td style="padding: 8px 0; text-align: right; font-weight: 600; color: #78350f;">${order.products?.name || 'Server'}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: #92400e;">Due Date</td>
                <td style="padding: 8px 0; text-align: right; font-weight: 600; color: #dc2626;">${dueDate}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: #92400e;">Amount Due</td>
                <td style="padding: 8px 0; text-align: right; font-weight: 600; color: #78350f; font-size: 20px;">$${order.price.toFixed(2)}</td>
              </tr>
            </table>
          </div>
          
          <div style="background: #fef2f2; border-radius: 8px; padding: 16px; margin: 24px 0; border-left: 4px solid #ef4444;">
            <p style="margin: 0; color: #991b1b; font-size: 14px;">
              <strong>⚠️ Important:</strong> Failure to renew will result in service suspension.
            </p>
          </div>
          
          <a href="#" style="display: block; background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); color: white; text-decoration: none; padding: 16px 32px; border-radius: 8px; font-weight: 600; text-align: center; margin-top: 24px;">
            Renew Now
          </a>
        </div>
        <p style="text-align: center; color: #9ca3af; font-size: 14px; margin-top: 20px;">
          ${brandName} • Keep your server running!
        </p>
      </div>
    </body>
    </html>
  `;
}

function generateServiceSuspendedEmail(order: any, brandName: string): string {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
    </head>
    <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; margin: 0; padding: 0; background-color: #f4f4f5;">
      <div style="max-width: 600px; margin: 0 auto; padding: 40px 20px;">
        <div style="background: linear-gradient(135deg, #f97316 0%, #ea580c 100%); padding: 40px; border-radius: 16px 16px 0 0; text-align: center;">
          <div style="width: 60px; height: 60px; background: white; border-radius: 50%; margin: 0 auto 20px; display: flex; align-items: center; justify-content: center;">
            <span style="font-size: 30px;">⚠️</span>
          </div>
          <h1 style="color: white; margin: 0; font-size: 28px;">Service Suspended</h1>
        </div>
        <div style="background: white; padding: 40px; border-radius: 0 0 16px 16px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
          <p style="color: #374151; font-size: 16px; line-height: 1.6;">
            Your service has been suspended. Your server is currently inaccessible.
          </p>
          
          <div style="background: #fff7ed; border-radius: 12px; padding: 24px; margin: 24px 0; border: 1px solid #fed7aa;">
            <h3 style="margin: 0 0 16px 0; color: #c2410c;">Service Information</h3>
            <table style="width: 100%; border-collapse: collapse;">
              <tr>
                <td style="padding: 8px 0; color: #ea580c;">Service</td>
                <td style="padding: 8px 0; text-align: right; font-weight: 600; color: #9a3412;">${order.products?.name || 'Server'}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: #ea580c;">Status</td>
                <td style="padding: 8px 0; text-align: right; font-weight: 600; color: #dc2626;">Suspended</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: #ea580c;">Server ID</td>
                <td style="padding: 8px 0; text-align: right; font-weight: 600; color: #9a3412; font-family: monospace;">${order.server_id || 'N/A'}</td>
              </tr>
            </table>
          </div>
          
          <div style="background: #fef3c7; border-radius: 8px; padding: 16px; margin: 24px 0; border-left: 4px solid #f59e0b;">
            <p style="margin: 0; color: #92400e; font-size: 14px;">
              <strong>💡 How to reactivate:</strong> Please pay any outstanding invoices or contact support if you believe this is an error.
            </p>
          </div>
          
          <div style="background: #fef2f2; border-radius: 8px; padding: 16px; margin: 24px 0; border-left: 4px solid #ef4444;">
            <p style="margin: 0; color: #991b1b; font-size: 14px;">
              <strong>⚠️ Warning:</strong> Continued non-payment may result in permanent service termination and data loss.
            </p>
          </div>
          
          <a href="#" style="display: block; background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); color: white; text-decoration: none; padding: 16px 32px; border-radius: 8px; font-weight: 600; text-align: center; margin-top: 24px;">
            Pay Outstanding Balance
          </a>
        </div>
        <p style="text-align: center; color: #9ca3af; font-size: 14px; margin-top: 20px;">
          ${brandName} • Need help? Contact support
        </p>
      </div>
    </body>
    </html>
  `;
}

function generateServiceTerminatedEmail(order: any, brandName: string): string {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
    </head>
    <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; margin: 0; padding: 0; background-color: #f4f4f5;">
      <div style="max-width: 600px; margin: 0 auto; padding: 40px 20px;">
        <div style="background: linear-gradient(135deg, #dc2626 0%, #b91c1c 100%); padding: 40px; border-radius: 16px 16px 0 0; text-align: center;">
          <div style="width: 60px; height: 60px; background: white; border-radius: 50%; margin: 0 auto 20px; display: flex; align-items: center; justify-content: center;">
            <span style="font-size: 30px;">🚫</span>
          </div>
          <h1 style="color: white; margin: 0; font-size: 28px;">Service Terminated</h1>
        </div>
        <div style="background: white; padding: 40px; border-radius: 0 0 16px 16px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
          <p style="color: #374151; font-size: 16px; line-height: 1.6;">
            Your service has been permanently terminated. All associated data has been deleted and cannot be recovered.
          </p>
          
          <div style="background: #fef2f2; border-radius: 12px; padding: 24px; margin: 24px 0; border: 1px solid #fecaca;">
            <h3 style="margin: 0 0 16px 0; color: #dc2626;">Terminated Service</h3>
            <table style="width: 100%; border-collapse: collapse;">
              <tr>
                <td style="padding: 8px 0; color: #991b1b;">Service</td>
                <td style="padding: 8px 0; text-align: right; font-weight: 600; color: #7f1d1d;">${order.products?.name || 'Server'}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: #991b1b;">Status</td>
                <td style="padding: 8px 0; text-align: right; font-weight: 600; color: #dc2626;">Terminated</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: #991b1b;">Termination Date</td>
                <td style="padding: 8px 0; text-align: right; font-weight: 600; color: #7f1d1d;">${new Date().toLocaleDateString()}</td>
              </tr>
            </table>
          </div>
          
          <div style="background: #f0f9ff; border-radius: 8px; padding: 16px; margin: 24px 0; border-left: 4px solid #0ea5e9;">
            <p style="margin: 0; color: #0369a1; font-size: 14px;">
              <strong>🔄 Want to come back?</strong> You can always start a new service with us. We'd love to have you back!
            </p>
          </div>
          
          <a href="#" style="display: block; background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); color: white; text-decoration: none; padding: 16px 32px; border-radius: 8px; font-weight: 600; text-align: center; margin-top: 24px;">
            Browse Our Services
          </a>
        </div>
        <p style="text-align: center; color: #9ca3af; font-size: 14px; margin-top: 20px;">
          ${brandName} • Thank you for being a customer
        </p>
      </div>
    </body>
    </html>
  `;
}

function generateServiceReactivatedEmail(order: any, brandName: string): string {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
    </head>
    <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; margin: 0; padding: 0; background-color: #f4f4f5;">
      <div style="max-width: 600px; margin: 0 auto; padding: 40px 20px;">
        <div style="background: linear-gradient(135deg, #22c55e 0%, #16a34a 100%); padding: 40px; border-radius: 16px 16px 0 0; text-align: center;">
          <div style="width: 60px; height: 60px; background: white; border-radius: 50%; margin: 0 auto 20px; display: flex; align-items: center; justify-content: center;">
            <span style="font-size: 30px;">🎉</span>
          </div>
          <h1 style="color: white; margin: 0; font-size: 28px;">Service Reactivated!</h1>
        </div>
        <div style="background: white; padding: 40px; border-radius: 0 0 16px 16px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
          <p style="color: #374151; font-size: 16px; line-height: 1.6;">
            Great news! Your service has been reactivated and is now fully operational. Welcome back!
          </p>
          
          <div style="background: #f0fdf4; border-radius: 12px; padding: 24px; margin: 24px 0; border: 1px solid #bbf7d0;">
            <h3 style="margin: 0 0 16px 0; color: #16a34a;">Service Information</h3>
            <table style="width: 100%; border-collapse: collapse;">
              <tr>
                <td style="padding: 8px 0; color: #15803d;">Service</td>
                <td style="padding: 8px 0; text-align: right; font-weight: 600; color: #166534;">${order.products?.name || 'Server'}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: #15803d;">Status</td>
                <td style="padding: 8px 0; text-align: right; font-weight: 600; color: #22c55e;">Active ✓</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: #15803d;">Server ID</td>
                <td style="padding: 8px 0; text-align: right; font-weight: 600; color: #166534; font-family: monospace;">${order.server_id || 'N/A'}</td>
              </tr>
            </table>
          </div>
          
          <div style="background: #f0f9ff; border-radius: 8px; padding: 16px; margin: 24px 0; border-left: 4px solid #0ea5e9;">
            <p style="margin: 0; color: #0369a1; font-size: 14px;">
              <strong>🚀 Your server is ready!</strong> You can now access your server and all its features.
            </p>
          </div>
          
          <a href="#" style="display: block; background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); color: white; text-decoration: none; padding: 16px 32px; border-radius: 8px; font-weight: 600; text-align: center; margin-top: 24px;">
            Access Control Panel
          </a>
        </div>
        <p style="text-align: center; color: #9ca3af; font-size: 14px; margin-top: 20px;">
          ${brandName} • Thank you for your continued support
        </p>
      </div>
    </body>
    </html>
  `;
}

function generatePanelCredentialsEmail(
  credentials: { email: string; username: string; password: string },
  panelUrl: string,
  serverName: string,
  brandName: string
): string {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
    </head>
    <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; margin: 0; padding: 0; background-color: #f4f4f5;">
      <div style="max-width: 600px; margin: 0 auto; padding: 40px 20px;">
        <div style="background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); padding: 40px; border-radius: 16px 16px 0 0; text-align: center;">
          <div style="width: 80px; height: 80px; background: white; border-radius: 50%; margin: 0 auto 20px; display: flex; align-items: center; justify-content: center;">
            <span style="font-size: 40px;">🎮</span>
          </div>
          <h1 style="color: white; margin: 0; font-size: 28px;">Your Server is Ready!</h1>
        </div>
        <div style="background: white; padding: 40px; border-radius: 0 0 16px 16px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
          <p style="color: #374151; font-size: 16px; line-height: 1.6;">
            Great news! Your game server <strong>${serverName}</strong> has been provisioned and is ready to use.
          </p>
          
          <div style="background: linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 100%); border-radius: 12px; padding: 24px; margin: 24px 0; border: 1px solid #bae6fd;">
            <h3 style="margin: 0 0 16px 0; color: #0369a1;">🔐 Your Panel Login Credentials</h3>
            <table style="width: 100%; border-collapse: collapse;">
              <tr>
                <td style="padding: 12px 0; color: #0c4a6e; border-bottom: 1px solid #e0f2fe;">Email</td>
                <td style="padding: 12px 0; text-align: right; font-weight: 600; color: #0369a1; font-family: monospace; border-bottom: 1px solid #e0f2fe;">${credentials.email}</td>
              </tr>
              <tr>
                <td style="padding: 12px 0; color: #0c4a6e; border-bottom: 1px solid #e0f2fe;">Username</td>
                <td style="padding: 12px 0; text-align: right; font-weight: 600; color: #0369a1; font-family: monospace; border-bottom: 1px solid #e0f2fe;">${credentials.username}</td>
              </tr>
              <tr>
                <td style="padding: 12px 0; color: #0c4a6e;">Password</td>
                <td style="padding: 12px 0; text-align: right; font-weight: 600; color: #0369a1; font-family: monospace;">${credentials.password}</td>
              </tr>
            </table>
          </div>
          
          <div style="background: #fef3c7; border-radius: 8px; padding: 16px; margin: 24px 0; border-left: 4px solid #f59e0b;">
            <p style="margin: 0; color: #92400e; font-size: 14px;">
              <strong>🔒 Security Tip:</strong> We recommend changing your password after your first login. You can also reset it anytime from your client area.
            </p>
          </div>
          
          <a href="${panelUrl}" style="display: block; background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); color: white; text-decoration: none; padding: 16px 32px; border-radius: 8px; font-weight: 600; text-align: center; margin-top: 24px;">
            Login to Game Panel
          </a>
          
          <p style="color: #6b7280; font-size: 14px; line-height: 1.6; margin-top: 24px;">
            If the button doesn't work, copy and paste this link into your browser:
          </p>
          <p style="color: #6366f1; word-break: break-all; font-size: 14px;">
            ${panelUrl}
          </p>
        </div>
        <p style="text-align: center; color: #9ca3af; font-size: 14px; margin-top: 20px;">
          ${brandName} • Premium Game Hosting
        </p>
      </div>
    </body>
    </html>
  `;
}

function generatePanelPasswordResetEmail(
  email: string,
  newPassword: string,
  panelUrl: string,
  brandName: string
): string {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
    </head>
    <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; margin: 0; padding: 0; background-color: #f4f4f5;">
      <div style="max-width: 600px; margin: 0 auto; padding: 40px 20px;">
        <div style="background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%); padding: 40px; border-radius: 16px 16px 0 0; text-align: center;">
          <div style="width: 60px; height: 60px; background: white; border-radius: 50%; margin: 0 auto 20px; display: flex; align-items: center; justify-content: center;">
            <span style="font-size: 30px;">🔑</span>
          </div>
          <h1 style="color: white; margin: 0; font-size: 28px;">Password Reset Complete</h1>
        </div>
        <div style="background: white; padding: 40px; border-radius: 0 0 16px 16px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
          <p style="color: #374151; font-size: 16px; line-height: 1.6;">
            Your game panel password has been successfully reset. Here are your new login credentials:
          </p>
          
          <div style="background: linear-gradient(135deg, #fffbeb 0%, #fef3c7 100%); border-radius: 12px; padding: 24px; margin: 24px 0; border: 1px solid #fcd34d;">
            <h3 style="margin: 0 0 16px 0; color: #92400e;">🔐 New Login Credentials</h3>
            <table style="width: 100%; border-collapse: collapse;">
              <tr>
                <td style="padding: 12px 0; color: #78350f; border-bottom: 1px solid #fcd34d;">Email</td>
                <td style="padding: 12px 0; text-align: right; font-weight: 600; color: #92400e; font-family: monospace; border-bottom: 1px solid #fcd34d;">${email}</td>
              </tr>
              <tr>
                <td style="padding: 12px 0; color: #78350f;">New Password</td>
                <td style="padding: 12px 0; text-align: right; font-weight: 600; color: #92400e; font-family: monospace;">${newPassword}</td>
              </tr>
            </table>
          </div>
          
          <div style="background: #fef2f2; border-radius: 8px; padding: 16px; margin: 24px 0; border-left: 4px solid #ef4444;">
            <p style="margin: 0; color: #991b1b; font-size: 14px;">
              <strong>⚠️ Didn't request this?</strong> If you didn't reset your password, please contact support immediately as your account may be compromised.
            </p>
          </div>
          
          <a href="${panelUrl}" style="display: block; background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); color: white; text-decoration: none; padding: 16px 32px; border-radius: 8px; font-weight: 600; text-align: center; margin-top: 24px;">
            Login to Game Panel
          </a>
        </div>
        <p style="text-align: center; color: #9ca3af; font-size: 14px; margin-top: 20px;">
          ${brandName} • Premium Game Hosting
        </p>
      </div>
    </body>
    </html>
  `;
}

function generateServerSuspendedOverdueEmail(
  serverName: string,
  orderId: string,
  dueDate: string,
  amount: number,
  paymentUrl: string,
  brandName: string
): string {
  const formattedDate = new Date(dueDate).toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
  
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
    </head>
    <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; margin: 0; padding: 0; background-color: #f4f4f5;">
      <div style="max-width: 600px; margin: 0 auto; padding: 40px 20px;">
        <div style="background: linear-gradient(135deg, #dc2626 0%, #b91c1c 100%); padding: 40px; border-radius: 16px 16px 0 0; text-align: center;">
          <div style="width: 60px; height: 60px; background: white; border-radius: 50%; margin: 0 auto 20px; display: flex; align-items: center; justify-content: center;">
            <span style="font-size: 30px;">⚠️</span>
          </div>
          <h1 style="color: white; margin: 0; font-size: 28px;">Server Suspended</h1>
          <p style="color: rgba(255,255,255,0.9); margin: 10px 0 0 0; font-size: 16px;">Payment Overdue</p>
        </div>
        <div style="background: white; padding: 40px; border-radius: 0 0 16px 16px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
          <p style="color: #374151; font-size: 16px; line-height: 1.6;">
            Your game server has been <strong>automatically suspended</strong> due to non-payment. Your server is currently inaccessible.
          </p>
          
          <div style="background: #fef2f2; border-radius: 12px; padding: 24px; margin: 24px 0; border: 1px solid #fecaca;">
            <h3 style="margin: 0 0 16px 0; color: #dc2626;">🔴 Suspension Details</h3>
            <table style="width: 100%; border-collapse: collapse;">
              <tr>
                <td style="padding: 12px 0; color: #991b1b; border-bottom: 1px solid #fecaca;">Server</td>
                <td style="padding: 12px 0; text-align: right; font-weight: 600; color: #7f1d1d; border-bottom: 1px solid #fecaca;">${serverName || 'Game Server'}</td>
              </tr>
              <tr>
                <td style="padding: 12px 0; color: #991b1b; border-bottom: 1px solid #fecaca;">Order ID</td>
                <td style="padding: 12px 0; text-align: right; font-weight: 600; color: #7f1d1d; font-family: monospace; border-bottom: 1px solid #fecaca;">${orderId.substring(0, 8)}...</td>
              </tr>
              <tr>
                <td style="padding: 12px 0; color: #991b1b; border-bottom: 1px solid #fecaca;">Original Due Date</td>
                <td style="padding: 12px 0; text-align: right; font-weight: 600; color: #7f1d1d; border-bottom: 1px solid #fecaca;">${formattedDate}</td>
              </tr>
              <tr>
                <td style="padding: 12px 0; color: #991b1b;">Amount Due</td>
                <td style="padding: 12px 0; text-align: right; font-weight: 700; color: #dc2626; font-size: 18px;">$${amount.toFixed(2)}</td>
              </tr>
            </table>
          </div>
          
          <div style="background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%); border-radius: 12px; padding: 24px; margin: 24px 0; border: 1px solid #fcd34d;">
            <h3 style="margin: 0 0 12px 0; color: #92400e;">🔑 How to Reactivate Your Server</h3>
            <ol style="margin: 0; padding-left: 20px; color: #78350f; font-size: 14px; line-height: 1.8;">
              <li>Click the button below to pay your outstanding invoice</li>
              <li>Your server will be automatically reactivated within minutes</li>
              <li>All your data and configurations will be preserved</li>
            </ol>
          </div>
          
          <div style="background: #fef2f2; border-radius: 8px; padding: 16px; margin: 24px 0; border-left: 4px solid #ef4444;">
            <p style="margin: 0; color: #991b1b; font-size: 14px;">
              <strong>⚠️ Important:</strong> Continued non-payment may result in permanent service termination and <strong>data loss</strong>. Please act promptly to avoid losing your server data.
            </p>
          </div>
          
          <a href="${paymentUrl}" style="display: block; background: linear-gradient(135deg, #10b981 0%, #059669 100%); color: white; text-decoration: none; padding: 18px 32px; border-radius: 8px; font-weight: 600; text-align: center; margin-top: 24px; font-size: 16px;">
            💳 Pay Now & Reactivate Server
          </a>
          
          <p style="text-align: center; color: #6b7280; font-size: 13px; margin-top: 16px;">
            Having trouble? <a href="${paymentUrl.replace('/client', '/client/tickets')}" style="color: #6366f1;">Contact Support</a>
          </p>
        </div>
        <p style="text-align: center; color: #9ca3af; font-size: 14px; margin-top: 20px;">
          ${brandName} • Automated Billing System
        </p>
      </div>
    </body>
    </html>
  `;
}

function generatePaymentReminderEmail(
  invoiceNumber: string,
  serverName: string,
  dueDate: string,
  amount: number,
  daysUntilDue: number,
  paymentUrl: string,
  urgency: "urgent" | "warning" | "notice",
  brandName: string
): string {
  const formattedDate = new Date(dueDate).toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
  
  const colors = {
    urgent: { bg: "#dc2626", bgLight: "#fef2f2", border: "#fecaca", text: "#991b1b" },
    warning: { bg: "#f59e0b", bgLight: "#fffbeb", border: "#fcd34d", text: "#92400e" },
    notice: { bg: "#6366f1", bgLight: "#eef2ff", border: "#c7d2fe", text: "#4338ca" }
  };
  
  const color = colors[urgency];
  
  const urgencyMessages = {
    urgent: {
      icon: "🚨",
      title: "Payment Due Tomorrow!",
      subtitle: "Immediate action required to avoid service suspension",
      warning: "Your server will be automatically suspended if payment is not received by the due date."
    },
    warning: {
      icon: "⚠️",
      title: "Payment Due in " + daysUntilDue + " Days",
      subtitle: "Please pay soon to avoid service interruption",
      warning: "To avoid suspension, please ensure payment is made before the due date."
    },
    notice: {
      icon: "📋",
      title: "Payment Due in " + daysUntilDue + " Days",
      subtitle: "Friendly reminder about your upcoming payment",
      warning: "This is a friendly reminder. No action is needed if you have auto-pay enabled."
    }
  };
  
  const msg = urgencyMessages[urgency];
  
  const warningSection = urgency !== "notice" ? `
    <div style="background: #fef3c7; border-radius: 8px; padding: 16px; margin: 24px 0; border-left: 4px solid #f59e0b;">
      <p style="margin: 0; color: #92400e; font-size: 14px;">
        <strong>⚠️ Note:</strong> ${msg.warning}
      </p>
    </div>
  ` : "";
  
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
    </head>
    <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; margin: 0; padding: 0; background-color: #f4f4f5;">
      <div style="max-width: 600px; margin: 0 auto; padding: 40px 20px;">
        <div style="background: linear-gradient(135deg, ${color.bg} 0%, ${color.bg}dd 100%); padding: 40px; border-radius: 16px 16px 0 0; text-align: center;">
          <div style="width: 60px; height: 60px; background: white; border-radius: 50%; margin: 0 auto 20px; display: flex; align-items: center; justify-content: center;">
            <span style="font-size: 30px;">${msg.icon}</span>
          </div>
          <h1 style="color: white; margin: 0; font-size: 24px;">${msg.title}</h1>
          <p style="color: rgba(255,255,255,0.9); margin: 10px 0 0 0; font-size: 14px;">${msg.subtitle}</p>
        </div>
        <div style="background: white; padding: 40px; border-radius: 0 0 16px 16px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
          <p style="color: #374151; font-size: 16px; line-height: 1.6;">
            Hi there! This is a reminder that your invoice for <strong>${serverName}</strong> is due soon.
          </p>
          
          <div style="background: ${color.bgLight}; border-radius: 12px; padding: 24px; margin: 24px 0; border: 1px solid ${color.border};">
            <h3 style="margin: 0 0 16px 0; color: ${color.text};">📄 Invoice Details</h3>
            <table style="width: 100%; border-collapse: collapse;">
              <tr>
                <td style="padding: 12px 0; color: ${color.text}; border-bottom: 1px solid ${color.border};">Invoice #</td>
                <td style="padding: 12px 0; text-align: right; font-weight: 600; color: ${color.text}; font-family: monospace; border-bottom: 1px solid ${color.border};">${invoiceNumber}</td>
              </tr>
              <tr>
                <td style="padding: 12px 0; color: ${color.text}; border-bottom: 1px solid ${color.border};">Service</td>
                <td style="padding: 12px 0; text-align: right; font-weight: 600; color: ${color.text}; border-bottom: 1px solid ${color.border};">${serverName}</td>
              </tr>
              <tr>
                <td style="padding: 12px 0; color: ${color.text}; border-bottom: 1px solid ${color.border};">Due Date</td>
                <td style="padding: 12px 0; text-align: right; font-weight: 600; color: ${color.text}; border-bottom: 1px solid ${color.border};">${formattedDate}</td>
              </tr>
              <tr>
                <td style="padding: 12px 0; color: ${color.text};">Amount Due</td>
                <td style="padding: 12px 0; text-align: right; font-weight: 700; color: ${color.bg}; font-size: 20px;">$${amount.toFixed(2)}</td>
              </tr>
            </table>
          </div>
          
          ${warningSection}
          
          <a href="${paymentUrl}" style="display: block; background: linear-gradient(135deg, #10b981 0%, #059669 100%); color: white; text-decoration: none; padding: 18px 32px; border-radius: 8px; font-weight: 600; text-align: center; margin-top: 24px; font-size: 16px;">
            💳 Pay Invoice Now
          </a>
          
          <p style="text-align: center; color: #6b7280; font-size: 13px; margin-top: 20px;">
            Questions? <a href="${paymentUrl.replace('/client', '/client/tickets')}" style="color: #6366f1;">Contact our support team</a>
          </p>
        </div>
        <p style="text-align: center; color: #9ca3af; font-size: 14px; margin-top: 20px;">
          ${brandName} • Automated Billing Reminder
        </p>
      </div>
    </body>
    </html>
  `;
}

// ============= 25-Day Server Age Warning Email =============

function generateServerAgeWarningEmail(
  email: string,
  serverName: string,
  createdAt: string,
  daysOld: number,
  daysUntilSuspension: number,
  paymentUrl: string,
  brandName: string
): string {
  const userName = email.split("@")[0];
  const createdDate = new Date(createdAt).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
    </head>
    <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; margin: 0; padding: 0; background-color: #f4f4f5;">
      <div style="max-width: 600px; margin: 0 auto; padding: 40px 20px;">
        <div style="background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%); padding: 40px; border-radius: 16px 16px 0 0; text-align: center;">
          <div style="width: 80px; height: 80px; background: white; border-radius: 50%; margin: 0 auto 20px; display: flex; align-items: center; justify-content: center;">
            <span style="font-size: 40px;">⚠️</span>
          </div>
          <h1 style="color: white; margin: 0; font-size: 28px;">Server Warning</h1>
          <p style="color: rgba(255,255,255,0.9); margin: 10px 0 0 0; font-size: 16px;">Action Required</p>
        </div>
        <div style="background: white; padding: 40px; border-radius: 0 0 16px 16px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
          <p style="color: #374151; font-size: 16px; line-height: 1.6;">
            Hello <strong>${userName}</strong>,
          </p>
          
          <div style="background: #fffbeb; border: 1px solid #f59e0b; border-radius: 12px; padding: 20px; margin: 24px 0;">
            <p style="margin: 0; color: #92400e; font-size: 16px;">
              <strong>⚠️ Your server "${serverName}" will be suspended in ${daysUntilSuspension} days!</strong>
            </p>
          </div>
          
          <div style="background: #fafafa; border-radius: 12px; padding: 24px; margin: 24px 0;">
            <h3 style="margin: 0 0 16px 0; color: #374151;">📄 Server Details</h3>
            <table style="width: 100%; border-collapse: collapse;">
              <tr>
                <td style="padding: 12px 0; color: #6b7280; border-bottom: 1px solid #e5e7eb;">Server Name</td>
                <td style="padding: 12px 0; text-align: right; font-weight: 600; color: #111827; border-bottom: 1px solid #e5e7eb;">${serverName}</td>
              </tr>
              <tr>
                <td style="padding: 12px 0; color: #6b7280; border-bottom: 1px solid #e5e7eb;">Created On</td>
                <td style="padding: 12px 0; text-align: right; font-weight: 600; color: #111827; border-bottom: 1px solid #e5e7eb;">${createdDate}</td>
              </tr>
              <tr>
                <td style="padding: 12px 0; color: #6b7280; border-bottom: 1px solid #e5e7eb;">Server Age</td>
                <td style="padding: 12px 0; text-align: right; font-weight: 600; color: #f59e0b; border-bottom: 1px solid #e5e7eb;">${daysOld} days</td>
              </tr>
              <tr>
                <td style="padding: 12px 0; color: #6b7280;">Days Until Suspension</td>
                <td style="padding: 12px 0; text-align: right; font-weight: 700; color: #dc2626; font-size: 20px;">${daysUntilSuspension} days</td>
              </tr>
            </table>
          </div>
          
          <p style="color: #374151; font-size: 16px; line-height: 1.6;">
            To keep your server running, please contact our admin team or complete your payment before the suspension date.
          </p>
          
          <a href="${paymentUrl}" style="display: block; background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%); color: white; text-decoration: none; padding: 18px 32px; border-radius: 8px; font-weight: 600; text-align: center; margin-top: 24px; font-size: 16px;">
            📞 Contact Admin Now
          </a>
          
          <p style="text-align: center; color: #6b7280; font-size: 13px; margin-top: 20px;">
            Questions? <a href="${paymentUrl.replace('/client', '/contact')}" style="color: #f59e0b;">Contact our support team</a>
          </p>
        </div>
        <p style="text-align: center; color: #9ca3af; font-size: 14px; margin-top: 20px;">
          ${brandName} • Server Age Warning
        </p>
      </div>
    </body>
    </html>
  `;
}

function generateSyncWelcomeEmail(
  email: string,
  password: string,
  panelUrl: string,
  servers: string[],
  brandName: string
): string {
  const userName = email.split("@")[0];
  const serverListHtml = servers.map((name, i) => `
    <tr>
      <td style="padding: 12px 16px; color: #6b7280; border-bottom: 1px solid #e5e7eb;">${i + 1}</td>
      <td style="padding: 12px 16px; font-weight: 600; color: #111827; border-bottom: 1px solid #e5e7eb;">🎮 ${name}</td>
    </tr>
  `).join("");

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
    </head>
    <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; margin: 0; padding: 0; background-color: #0f172a;">
      <div style="max-width: 600px; margin: 0 auto; padding: 40px 20px;">
        
        <!-- Header -->
        <div style="background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 50%, #a855f7 100%); padding: 50px 40px; border-radius: 24px 24px 0 0; text-align: center; position: relative; overflow: hidden;">
          <div style="position: absolute; top: 0; left: 0; right: 0; bottom: 0; background: url('data:image/svg+xml,<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 100 100\"><circle cx=\"50\" cy=\"50\" r=\"40\" fill=\"none\" stroke=\"rgba(255,255,255,0.1)\" stroke-width=\"0.5\"/></svg>'); opacity: 0.3;"></div>
          <div style="position: relative; z-index: 1;">
            <div style="width: 100px; height: 100px; background: linear-gradient(135deg, #ffffff 0%, #f0f0f0 100%); border-radius: 50%; margin: 0 auto 24px; display: flex; align-items: center; justify-content: center; box-shadow: 0 20px 40px rgba(0,0,0,0.3);">
              <span style="font-size: 50px;">🎮</span>
            </div>
            <h1 style="color: white; margin: 0; font-size: 32px; font-weight: 700; text-shadow: 0 2px 10px rgba(0,0,0,0.2);">Welcome to ${brandName}!</h1>
            <p style="color: rgba(255,255,255,0.9); margin: 12px 0 0 0; font-size: 18px;">Your account is ready</p>
          </div>
        </div>
        
        <!-- Main Content -->
        <div style="background: linear-gradient(180deg, #1e293b 0%, #0f172a 100%); padding: 40px; border-radius: 0 0 24px 24px; box-shadow: 0 25px 50px rgba(0,0,0,0.5);">
          
          <p style="color: #e2e8f0; font-size: 18px; line-height: 1.6; margin-bottom: 30px;">
            Hello <strong style="color: #a5b4fc;">${userName}</strong>! 🎉
          </p>
          
          <p style="color: #94a3b8; font-size: 16px; line-height: 1.7;">
            Your account has been created for our hosting service. Below are your login credentials and a list of your ${servers.length} server${servers.length > 1 ? 's' : ''}.
          </p>
          
          <!-- Credentials Box -->
          <div style="background: linear-gradient(135deg, #312e81 0%, #1e1b4b 100%); border-radius: 16px; padding: 28px; margin: 30px 0; border: 1px solid #4338ca;">
            <h3 style="margin: 0 0 20px 0; color: #c7d2fe; font-size: 16px; text-transform: uppercase; letter-spacing: 1px;">🔐 Login Credentials</h3>
            <table style="width: 100%;">
              <tr>
                <td style="padding: 10px 0; color: #a5b4fc; font-size: 14px;">Email</td>
                <td style="padding: 10px 0; text-align: right; color: #ffffff; font-family: 'Monaco', monospace; font-size: 14px; background: #1e1b4b; padding: 8px 12px; border-radius: 6px;">${email}</td>
              </tr>
              <tr>
                <td style="padding: 10px 0; color: #a5b4fc; font-size: 14px;">Password</td>
                <td style="padding: 10px 0; text-align: right; color: #fbbf24; font-family: 'Monaco', monospace; font-size: 14px; background: #1e1b4b; padding: 8px 12px; border-radius: 6px; font-weight: 600;">${password}</td>
              </tr>
            </table>
          </div>
          
          <!-- Servers List -->
          <div style="background: #1e293b; border-radius: 16px; padding: 28px; margin: 30px 0; border: 1px solid #334155;">
            <h3 style="margin: 0 0 20px 0; color: #e2e8f0; font-size: 16px; text-transform: uppercase; letter-spacing: 1px;">🖥️ Your Servers (${servers.length})</h3>
            <table style="width: 100%; border-collapse: collapse;">
              <thead>
                <tr style="background: #0f172a;">
                  <th style="padding: 12px 16px; text-align: left; color: #64748b; font-size: 12px; text-transform: uppercase; border-bottom: 2px solid #334155;">#</th>
                  <th style="padding: 12px 16px; text-align: left; color: #64748b; font-size: 12px; text-transform: uppercase; border-bottom: 2px solid #334155;">Server Name</th>
                </tr>
              </thead>
              <tbody>
                ${serverListHtml}
              </tbody>
            </table>
          </div>
          
          <!-- Important Notice -->
          <div style="background: linear-gradient(135deg, #7c2d12 0%, #451a03 100%); border-radius: 12px; padding: 24px; margin: 30px 0; border: 1px solid #c2410c;">
            <p style="margin: 0; color: #fed7aa; font-size: 15px; line-height: 1.6;">
              <strong style="color: #fb923c;">⚠️ Important:</strong> Please login to renew your next invoice and keep your servers running. Unpaid invoices may result in service suspension.
            </p>
          </div>
          
          <!-- CTA Button -->
          <a href="${panelUrl.replace(/\/$/, '')}/client" style="display: block; background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); color: white; text-decoration: none; padding: 20px 40px; border-radius: 12px; font-weight: 700; text-align: center; margin-top: 30px; font-size: 18px; box-shadow: 0 10px 30px rgba(99, 102, 241, 0.4); transition: all 0.3s;">
            🚀 Login to Client Area
          </a>
          
          <!-- Game Panel Link -->
          <a href="${panelUrl}" style="display: block; background: transparent; color: #a5b4fc; text-decoration: none; padding: 16px 40px; border-radius: 12px; font-weight: 600; text-align: center; margin-top: 16px; font-size: 16px; border: 2px solid #4338ca;">
            🎮 Access Game Panel
          </a>
          
          <!-- Security Note -->
          <div style="margin-top: 30px; padding-top: 30px; border-top: 1px solid #334155;">
            <p style="color: #64748b; font-size: 13px; line-height: 1.6; margin: 0;">
              🔒 <strong>Security Tip:</strong> For your security, we recommend changing your password after your first login.
            </p>
          </div>
        </div>
        
        <!-- Footer -->
        <div style="text-align: center; margin-top: 30px;">
          <p style="color: #64748b; font-size: 14px; margin: 0;">
            ${brandName} • Game Server Hosting
          </p>
          <p style="color: #475569; font-size: 12px; margin: 10px 0 0 0;">
            Questions? Contact our support team anytime.
          </p>
        </div>
      </div>
    </body>
    </html>
  `;
}
