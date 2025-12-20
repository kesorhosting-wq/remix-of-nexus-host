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
  transactionId: string;
  amount: number;
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

  const generateKHQR = useCallback(async (
    amount: number,
    orderId: string,
    userEmail?: string,
    username?: string,
    invoiceId?: string
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
          description: "Please configure the Ikhode Payment API in admin settings",
          variant: "destructive",
        });
        return null;
      }

      const { data, error } = await supabase.functions.invoke("ikhode-payment", {
        body: {
          action: "generate-khqr",
          amount,
          orderId,
          email: userEmail || "",
          username: username || "",
          invoiceId,
        },
      });

      if (error) throw error;

      if (data.error) {
        throw new Error(data.error);
      }

      return {
        qrCodeData: data.qrCodeData,
        transactionId: data.transactionId,
        amount: data.amount,
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

  const checkPaymentStatus = useCallback(async (orderId: string, transactionId?: string) => {
    try {
      const { data, error } = await supabase.functions.invoke("ikhode-payment", {
        body: { 
          action: "check-status", 
          orderId,
          transactionId,
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
    if (config?.wsEnabled && config.wsUrl) {
      return config.wsUrl;
    }
    return null;
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
