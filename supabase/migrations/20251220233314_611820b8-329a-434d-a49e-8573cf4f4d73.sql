-- Create RLS policies for brand-assets bucket
-- Allow anyone to view files (public bucket)
CREATE POLICY "Anyone can view brand assets"
ON storage.objects FOR SELECT
USING (bucket_id = 'brand-assets');

-- Allow admins to upload files
CREATE POLICY "Admins can upload brand assets"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'brand-assets' AND public.has_role(auth.uid(), 'admin'));

-- Allow admins to update files
CREATE POLICY "Admins can update brand assets"
ON storage.objects FOR UPDATE
USING (bucket_id = 'brand-assets' AND public.has_role(auth.uid(), 'admin'));

-- Allow admins to delete files
CREATE POLICY "Admins can delete brand assets"
ON storage.objects FOR DELETE
USING (bucket_id = 'brand-assets' AND public.has_role(auth.uid(), 'admin'));