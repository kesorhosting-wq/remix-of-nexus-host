-- Phase 1: Fix Critical RLS Policy Vulnerabilities

-- 1. Fix email_logs INSERT policy - restrict to service role only (no client-side inserts)
DROP POLICY IF EXISTS "Service can insert email logs" ON public.email_logs;

-- Only allow inserts from authenticated admins (edge functions use service role which bypasses RLS)
CREATE POLICY "Only admins can insert email logs" 
ON public.email_logs 
FOR INSERT 
TO authenticated
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- 2. Fix ticket_replies staff impersonation - prevent users from setting is_staff=true
DROP POLICY IF EXISTS "Users can create replies to own tickets" ON public.ticket_replies;

CREATE POLICY "Users can create replies to own tickets" 
ON public.ticket_replies 
FOR INSERT 
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM tickets 
    WHERE tickets.id = ticket_replies.ticket_id 
    AND tickets.user_id = auth.uid()
  )
  AND (
    -- Non-admins cannot set is_staff to true
    is_staff = false 
    OR has_role(auth.uid(), 'admin'::app_role)
  )
);

-- 3. Create invoice items price validation function and trigger
CREATE OR REPLACE FUNCTION public.validate_invoice_item_price()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  valid_price BOOLEAN := false;
  product_price NUMERIC;
  plan_price NUMERIC;
BEGIN
  -- Skip validation for admins
  IF has_role(auth.uid(), 'admin'::app_role) THEN
    RETURN NEW;
  END IF;

  -- Check if price matches any product price
  SELECT price INTO product_price 
  FROM products 
  WHERE price = NEW.unit_price 
  LIMIT 1;
  
  IF FOUND THEN
    valid_price := true;
  END IF;

  -- Check if price matches any game_plan price
  IF NOT valid_price THEN
    SELECT price INTO plan_price 
    FROM game_plans 
    WHERE price = NEW.unit_price 
    LIMIT 1;
    
    IF FOUND THEN
      valid_price := true;
    END IF;
  END IF;

  -- Validate total calculation
  IF valid_price AND NEW.total != (NEW.unit_price * NEW.quantity) THEN
    RAISE EXCEPTION 'Invoice item total does not match unit_price * quantity';
  END IF;

  IF NOT valid_price THEN
    RAISE EXCEPTION 'Invoice item price does not match any configured product or plan price';
  END IF;

  RETURN NEW;
END;
$$;

-- Create the trigger
DROP TRIGGER IF EXISTS validate_invoice_item_price_trigger ON public.invoice_items;
CREATE TRIGGER validate_invoice_item_price_trigger
  BEFORE INSERT ON public.invoice_items
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_invoice_item_price();

-- 4. Add sanitization for server_details in orders to prevent credential storage
CREATE OR REPLACE FUNCTION public.sanitize_server_details()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  sensitive_keys TEXT[] := ARRAY['password', 'api_key', 'apikey', 'secret', 'token', 'credential', 'private_key'];
  key TEXT;
BEGIN
  -- Check for sensitive keys in server_details
  IF NEW.server_details IS NOT NULL THEN
    FOREACH key IN ARRAY sensitive_keys LOOP
      IF NEW.server_details ? key OR 
         NEW.server_details::text ILIKE '%' || key || '%' THEN
        RAISE EXCEPTION 'server_details cannot contain sensitive information (detected: %)', key;
      END IF;
    END LOOP;
  END IF;
  
  RETURN NEW;
END;
$$;

-- Create the trigger for orders
DROP TRIGGER IF EXISTS sanitize_server_details_trigger ON public.orders;
CREATE TRIGGER sanitize_server_details_trigger
  BEFORE INSERT OR UPDATE ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.sanitize_server_details();