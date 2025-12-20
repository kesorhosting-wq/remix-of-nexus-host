-- Create function to sync profiles with auth.users
CREATE OR REPLACE FUNCTION public.sync_profiles_with_auth_users()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Insert missing profiles
  INSERT INTO public.profiles (user_id, email)
  SELECT id, email FROM auth.users
  WHERE id NOT IN (SELECT user_id FROM public.profiles)
  ON CONFLICT (user_id) DO NOTHING;
  
  -- Update emails that have changed
  UPDATE public.profiles p
  SET email = u.email
  FROM auth.users u
  WHERE p.user_id = u.id AND p.email IS DISTINCT FROM u.email;
END;
$$;