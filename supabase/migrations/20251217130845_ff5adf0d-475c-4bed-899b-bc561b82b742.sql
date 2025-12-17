-- Add billing_days column to game_plans for custom expiration per plan
ALTER TABLE public.game_plans 
ADD COLUMN billing_days integer DEFAULT 30;

-- Add comment for clarity
COMMENT ON COLUMN public.game_plans.billing_days IS 'Number of days for billing cycle (e.g., 30 for monthly, 7 for weekly)';