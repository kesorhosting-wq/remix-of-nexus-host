-- Drop the existing public SELECT policy
DROP POLICY IF EXISTS "Anyone can view enabled payment gateways" ON public.payment_gateways;

-- Create a new policy that only allows authenticated users to view enabled gateways
CREATE POLICY "Authenticated users can view enabled payment gateways"
ON public.payment_gateways
FOR SELECT
TO authenticated
USING (enabled = true);