import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { 
  FileText, 
  Download, 
  CreditCard, 
  CheckCircle2, 
  Clock, 
  AlertCircle,
  Building2,
  Calendar,
  Hash,
  X,
  Printer
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useBranding } from '@/hooks/useBranding';

interface InvoiceItem {
  id: string;
  description: string;
  quantity: number;
  unit_price: number;
  total: number;
}

interface Invoice {
  id: string;
  invoice_number: string;
  status: string;
  subtotal: number;
  tax: number;
  discount: number;
  total: number;
  due_date: string;
  created_at: string;
  paid_at: string | null;
  payment_method: string | null;
  notes: string | null;
}

interface ModernInvoiceProps {
  invoice: Invoice;
  onClose: () => void;
  onPay?: () => void;
}

const ModernInvoice = ({ invoice, onClose, onPay }: ModernInvoiceProps) => {
  const { brand } = useBranding();
  const [items, setItems] = useState<InvoiceItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchItems();
  }, [invoice.id]);

  const fetchItems = async () => {
    try {
      const { data } = await supabase
        .from('invoice_items')
        .select('*')
        .eq('invoice_id', invoice.id);
      
      if (data) setItems(data);
    } catch (error) {
      console.error('Failed to fetch invoice items:', error);
    } finally {
      setLoading(false);
    }
  };

  const getStatusConfig = (status: string) => {
    switch (status) {
      case 'paid':
        return { icon: CheckCircle2, color: 'text-green-500', bg: 'bg-green-500/10', label: 'Paid' };
      case 'unpaid':
        return { icon: AlertCircle, color: 'text-red-500', bg: 'bg-red-500/10', label: 'Unpaid' };
      case 'pending':
        return { icon: Clock, color: 'text-yellow-500', bg: 'bg-yellow-500/10', label: 'Pending' };
      default:
        return { icon: Clock, color: 'text-muted-foreground', bg: 'bg-muted', label: status };
    }
  };

  const statusConfig = getStatusConfig(invoice.status);
  const StatusIcon = statusConfig.icon;

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 print:p-0 print:bg-white">
      <Card className="w-full max-w-3xl max-h-[90vh] overflow-auto print:max-h-none print:shadow-none print:border-none">
        {/* Header Actions */}
        <div className="flex items-center justify-between p-4 border-b print:hidden">
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={handlePrint}>
              <Printer className="w-4 h-4 mr-2" />
              Print
            </Button>
            <Button variant="outline" size="sm">
              <Download className="w-4 h-4 mr-2" />
              Download PDF
            </Button>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose}>
            <X className="w-4 h-4" />
          </Button>
        </div>

        <CardContent className="p-8">
          {/* Invoice Header */}
          <div className="flex flex-col md:flex-row justify-between gap-6 mb-8">
            <div>
              <div className="flex items-center gap-3 mb-4">
                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-primary to-primary/60 flex items-center justify-center">
                  <FileText className="w-6 h-6 text-primary-foreground" />
                </div>
              <div>
                  <h1 className="text-2xl font-bold">{brand.name}</h1>
                  <p className="text-sm text-muted-foreground">{brand.tagline}</p>
                </div>
              </div>
              <div className="text-sm text-muted-foreground space-y-1">
                <p>{brand.footerDescription}</p>
              </div>
            </div>
            <div className="text-right">
              <div className={`inline-flex items-center gap-2 px-4 py-2 rounded-full ${statusConfig.bg} mb-4`}>
                <StatusIcon className={`w-5 h-5 ${statusConfig.color}`} />
                <span className={`font-semibold ${statusConfig.color}`}>{statusConfig.label}</span>
              </div>
              <h2 className="text-3xl font-bold tracking-tight">INVOICE</h2>
              <p className="text-muted-foreground font-mono">#{invoice.invoice_number}</p>
            </div>
          </div>

          {/* Invoice Meta */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
            <div className="p-4 rounded-lg bg-muted/50">
              <div className="flex items-center gap-2 text-muted-foreground mb-1">
                <Hash className="w-4 h-4" />
                <span className="text-xs font-medium">Invoice Number</span>
              </div>
              <p className="font-semibold font-mono">{invoice.invoice_number}</p>
            </div>
            <div className="p-4 rounded-lg bg-muted/50">
              <div className="flex items-center gap-2 text-muted-foreground mb-1">
                <Calendar className="w-4 h-4" />
                <span className="text-xs font-medium">Issue Date</span>
              </div>
              <p className="font-semibold">{new Date(invoice.created_at).toLocaleDateString()}</p>
            </div>
            <div className="p-4 rounded-lg bg-muted/50">
              <div className="flex items-center gap-2 text-muted-foreground mb-1">
                <Calendar className="w-4 h-4" />
                <span className="text-xs font-medium">Due Date</span>
              </div>
              <p className="font-semibold">{new Date(invoice.due_date).toLocaleDateString()}</p>
            </div>
            <div className="p-4 rounded-lg bg-muted/50">
              <div className="flex items-center gap-2 text-muted-foreground mb-1">
                <CreditCard className="w-4 h-4" />
                <span className="text-xs font-medium">Payment Method</span>
              </div>
              <p className="font-semibold">{invoice.payment_method || 'N/A'}</p>
            </div>
          </div>

          {/* Line Items */}
          <div className="mb-8">
            <div className="rounded-lg border overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr className="bg-muted/50">
                    <th className="text-left p-4 font-semibold">Description</th>
                    <th className="text-center p-4 font-semibold">Qty</th>
                    <th className="text-right p-4 font-semibold">Unit Price</th>
                    <th className="text-right p-4 font-semibold">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {items.length > 0 ? items.map((item, index) => (
                    <tr key={item.id} className={index % 2 === 0 ? 'bg-background' : 'bg-muted/20'}>
                      <td className="p-4">{item.description}</td>
                      <td className="p-4 text-center">{item.quantity}</td>
                      <td className="p-4 text-right font-mono">${item.unit_price.toFixed(2)}</td>
                      <td className="p-4 text-right font-mono font-semibold">${item.total.toFixed(2)}</td>
                    </tr>
                  )) : (
                    <tr>
                      <td className="p-4">Service Subscription</td>
                      <td className="p-4 text-center">1</td>
                      <td className="p-4 text-right font-mono">${invoice.subtotal.toFixed(2)}</td>
                      <td className="p-4 text-right font-mono font-semibold">${invoice.subtotal.toFixed(2)}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Totals */}
          <div className="flex justify-end mb-8">
            <div className="w-full max-w-xs space-y-2">
              <div className="flex justify-between py-2">
                <span className="text-muted-foreground">Subtotal</span>
                <span className="font-mono">${invoice.subtotal.toFixed(2)}</span>
              </div>
              {invoice.tax > 0 && (
                <div className="flex justify-between py-2">
                  <span className="text-muted-foreground">Tax</span>
                  <span className="font-mono">${invoice.tax.toFixed(2)}</span>
                </div>
              )}
              {invoice.discount > 0 && (
                <div className="flex justify-between py-2 text-green-500">
                  <span>Discount</span>
                  <span className="font-mono">-${invoice.discount.toFixed(2)}</span>
                </div>
              )}
              <Separator />
              <div className="flex justify-between py-2">
                <span className="text-lg font-bold">Total</span>
                <span className="text-2xl font-bold text-primary font-mono">${invoice.total.toFixed(2)}</span>
              </div>
            </div>
          </div>

          {/* Notes */}
          {invoice.notes && (
            <div className="p-4 rounded-lg bg-muted/50 mb-8">
              <p className="text-sm text-muted-foreground font-medium mb-1">Notes</p>
              <p className="text-sm">{invoice.notes}</p>
            </div>
          )}

          {/* Payment CTA */}
          {invoice.status === 'unpaid' && onPay && (
            <div className="print:hidden">
              <Button onClick={onPay} size="lg" className="w-full gap-2">
                <CreditCard className="w-5 h-5" />
                Pay ${invoice.total.toFixed(2)} Now
              </Button>
            </div>
          )}

          {/* Paid Confirmation */}
          {invoice.status === 'paid' && invoice.paid_at && (
            <div className="p-4 rounded-lg bg-green-500/10 border border-green-500/20 flex items-center gap-3">
              <CheckCircle2 className="w-6 h-6 text-green-500" />
              <div>
                <p className="font-semibold text-green-500">Payment Received</p>
                <p className="text-sm text-muted-foreground">
                  Paid on {new Date(invoice.paid_at).toLocaleDateString()} via {invoice.payment_method}
                </p>
              </div>
            </div>
          )}

          {/* Footer */}
          <div className="mt-8 pt-6 border-t text-center text-sm text-muted-foreground">
            <p>Thank you for your business!</p>
            <p className="mt-1">Questions? Contact support at your convenience.</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default ModernInvoice;
