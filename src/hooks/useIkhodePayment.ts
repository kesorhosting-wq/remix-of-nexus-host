import { useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface PaymentConfig {
  apiUrl: string;
  wsUrl: string;
  wsEnabled: boolean;
}

interface KHQRResult {
  qrCode: string;
  qrString: string;
  transactionId: string;
  amount: number;
  currency: string;
}

interface MerchantSettings {
  accountId: string;
  merchantName: string;
  merchantCity: string;
  currency: string;
}

export function useIkhodePayment() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [config, setConfig] = useState<PaymentConfig | null>(null);
  const [merchantSettings, setMerchantSettings] = useState<MerchantSettings | null>(null);

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

  const fetchMerchantSettings = useCallback(async () => {
    try {
      // Get merchant settings from Bakong config in payment_gateways
      const { data: gateway } = await supabase
        .from("payment_gateways")
        .select("config")
        .eq("slug", "bakong")
        .single();

      if (gateway?.config) {
        const cfg = gateway.config as any;
        const settings: MerchantSettings = {
          accountId: cfg.accountId || cfg.merchantId || "",
          merchantName: cfg.merchantName || "GameHost",
          merchantCity: cfg.merchantCity || "Phnom Penh",
          currency: cfg.currency || "USD",
        };
        setMerchantSettings(settings);
        return settings;
      }
      return null;
    } catch (error) {
      console.error("Error fetching merchant settings:", error);
      return null;
    }
  }, []);

  const generateKHQR = useCallback(async (
    amount: number,
    orderId: string,
    description?: string
  ): Promise<KHQRResult | null> => {
    setLoading(true);
    try {
      // Ensure we have config and merchant settings
      let currentConfig = config;
      let settings = merchantSettings;

      if (!currentConfig) {
        currentConfig = await fetchConfig();
      }

      if (!settings) {
        settings = await fetchMerchantSettings();
      }

      if (!currentConfig || !settings) {
        toast({
          title: "Payment not configured",
          description: "Please configure the Ikhode Payment API in admin settings",
          variant: "destructive",
        });
        return null;
      }

      const transactionId = `TXN-${orderId.slice(0, 8)}-${Date.now()}`;

      const { data, error } = await supabase.functions.invoke("ikhode-payment", {
        body: {
          action: "generate-khqr",
          accountId: settings.accountId,
          merchantName: settings.merchantName,
          merchantCity: settings.merchantCity,
          amount,
          currency: settings.currency,
          transactionId,
        },
      });

      if (error) throw error;

      if (data.error) {
        throw new Error(data.error);
      }

      return {
        qrCode: data.qrCode || data.qrImage,
        qrString: data.qrString || data.qrData,
        transactionId,
        amount,
        currency: settings.currency,
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
  }, [config, merchantSettings, fetchConfig, fetchMerchantSettings, toast]);

  const getWebSocketUrl = useCallback(() => {
    if (config?.wsEnabled && config.wsUrl) {
      return config.wsUrl;
    }
    return null;
  }, [config]);

  return {
    loading,
    config,
    merchantSettings,
    fetchConfig,
    fetchMerchantSettings,
    generateKHQR,
    getWebSocketUrl,
  };
}
