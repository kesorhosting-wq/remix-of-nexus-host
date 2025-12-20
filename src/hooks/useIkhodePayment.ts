import { useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface PaymentConfig {
  apiUrl: string;
  wsUrl: string;
  wsEnabled: boolean;
}

interface KHQRResult {
  qrCodeData: string;
  invoiceId: string;
  amount: number;
  wsUrl: string;
}

export function useIkhodePayment() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [config, setConfig] = useState<PaymentConfig | null>(null);

  const fetchConfig = useCallback(async () => {
    try {
      const { data, error } = await supabase.functions.invoke("ikhode-payment", {
        body: { action: "get-config" },
      });

      if (error) throw error;
      setConfig(data);
      return data;
    } catch (error: any) {
      console.error("Error fetching Ikhode config:", error);
      return null;
    }
  }, []);

  // Matches PHP extension pay() method signature
  const generateKHQR = useCallback(async (
    amount: number,
    invoiceId: string,
    email?: string,
    username?: string
  ): Promise<KHQRResult | null> => {
    setLoading(true);
    try {
      // Ensure we have config
      let currentConfig = config;
      if (!currentConfig) {
        currentConfig = await fetchConfig();
      }

      if (!currentConfig?.apiUrl) {
        toast({
          title: "Payment not configured",
          description: "Please configure the KHQR Gateway in admin settings",
          variant: "destructive",
        });
        return null;
      }

      // Call edge function with parameters matching PHP extension
      const { data, error } = await supabase.functions.invoke("ikhode-payment", {
        body: {
          action: "generate-khqr",
          amount,
          invoiceId, // PHP uses $invoice->id as transactionId
          email: email || "",
          username: username || "",
        },
      });

      if (error) throw error;

      if (data.error) {
        throw new Error(data.error);
      }

      return {
        qrCodeData: data.qrCodeData,
        invoiceId: data.invoiceId,
        amount: data.amount,
        wsUrl: data.wsUrl,
      };
    } catch (error: any) {
      console.error("Error generating KHQR:", error);
      toast({
        title: "Failed to generate QR code",
        description: error.message,
        variant: "destructive",
      });
      return null;
    } finally {
      setLoading(false);
    }
  }, [config, fetchConfig, toast]);

  const checkPaymentStatus = useCallback(async (invoiceId: string) => {
    try {
      const { data, error } = await supabase.functions.invoke("ikhode-payment", {
        body: { 
          action: "check-status", 
          invoiceId,
        },
      });

      if (error) throw error;
      return data;
    } catch (error: any) {
      console.error("Error checking payment status:", error);
      return { status: "pending" };
    }
  }, []);

  const getWebSocketUrl = useCallback(() => {
    return config?.wsUrl || null;
  }, [config]);

  return {
    loading,
    config,
    fetchConfig,
    generateKHQR,
    checkPaymentStatus,
    getWebSocketUrl,
  };
}
