
-- Add policy for users to create their own invoices
CREATE POLICY "Users can create own invoices"
ON public.invoices
FOR INSERT
WITH CHECK (auth.uid() = user_id);

-- Add policy for users to create invoice items for their own invoices
CREATE POLICY "Users can create own invoice items"
ON public.invoice_items
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM invoices
    WHERE invoices.id = invoice_items.invoice_id
    AND invoices.user_id = auth.uid()
  )
);
