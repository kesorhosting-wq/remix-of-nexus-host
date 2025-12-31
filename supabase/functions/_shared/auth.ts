import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

export interface AuthResult {
  user: {
    id: string;
    email?: string;
  };
  isAdmin: boolean;
}

/**
 * Validates the user's JWT token and returns user info
 */
export async function getAuthUser(req: Request): Promise<AuthResult | null> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return null;
  }

  const token = authHeader.replace("Bearer ", "");
  
  // Use anon client to validate the token
  const anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const { data: { user }, error } = await anonClient.auth.getUser(token);
  
  if (error || !user) {
    console.log("Auth validation failed:", error?.message);
    return null;
  }

  // Check if user has admin role using service role client
  const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const { data: isAdmin } = await serviceClient.rpc("has_role", {
    _user_id: user.id,
    _role: "admin",
  });

  return {
    user: {
      id: user.id,
      email: user.email,
    },
    isAdmin: !!isAdmin,
  };
}

/**
 * Requires the user to be authenticated and have admin role
 * Throws an error if not authorized
 */
export async function requireAdmin(req: Request): Promise<AuthResult> {
  const auth = await getAuthUser(req);
  
  if (!auth) {
    throw new Error("Unauthorized: No valid authentication token");
  }
  
  if (!auth.isAdmin) {
    throw new Error("Forbidden: Admin access required");
  }
  
  console.log(`Admin access granted for user: ${auth.user.id}`);
  return auth;
}

/**
 * Requires the user to be authenticated (any role)
 * Throws an error if not authenticated
 */
export async function requireAuth(req: Request): Promise<AuthResult> {
  const auth = await getAuthUser(req);
  
  if (!auth) {
    throw new Error("Unauthorized: No valid authentication token");
  }
  
  return auth;
}

/**
 * Verifies that the authenticated user owns the specified order
 */
export async function requireOrderOwner(
  req: Request, 
  orderId: string
): Promise<AuthResult> {
  const auth = await requireAuth(req);
  
  // Admins can access any order
  if (auth.isAdmin) {
    return auth;
  }
  
  // Check if user owns the order
  const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const { data: order, error } = await serviceClient
    .from("orders")
    .select("user_id")
    .eq("id", orderId)
    .single();
  
  if (error || !order) {
    throw new Error("Order not found");
  }
  
  if (order.user_id !== auth.user.id) {
    throw new Error("Forbidden: You don't own this order");
  }
  
  return auth;
}
