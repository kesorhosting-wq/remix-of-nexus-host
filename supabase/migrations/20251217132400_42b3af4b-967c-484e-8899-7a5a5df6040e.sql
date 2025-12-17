-- Create SMTP settings table for email configuration
CREATE TABLE public.smtp_settings (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  host text NOT NULL DEFAULT 'smtp.gmail.com',
  port integer NOT NULL DEFAULT 587,
  username text NOT NULL DEFAULT '',
  password text NOT NULL DEFAULT '',
  from_email text NOT NULL DEFAULT '',
  from_name text NOT NULL DEFAULT '',
  encryption text NOT NULL DEFAULT 'tls',
  enabled boolean DEFAULT false,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.smtp_settings ENABLE ROW LEVEL SECURITY;

-- Only admins can manage SMTP settings
CREATE POLICY "Admins can manage smtp settings" 
  ON public.smtp_settings 
  FOR ALL 
  USING (has_role(auth.uid(), 'admin'::app_role));

-- Insert default row
INSERT INTO public.smtp_settings (host, port, from_email, from_name) 
VALUES ('smtp.gmail.com', 587, 'noreply@example.com', 'Game Hosting');