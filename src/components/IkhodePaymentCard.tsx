import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { 
  Wallet, Copy, Check, Timer, Smartphone, Shield, RefreshCw, 
  Loader2, CheckCircle2, Wifi, WifiOff, Zap 
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";

interface IkhodePaymentCardProps {
  qrCode: string;
  qrString?: string;
  amount: number;
  currency?: string;
  orderId: string;
  transactionId: string;
  description?: string;
  onComplete?: () => void;
  onCancel?: () => void;
  expiresIn?: number;
  wsUrl?: string;
}

const IkhodePaymentCard = ({
  qrCode,
  qrString,
  amount,
  currency = "USD",
  orderId,
  transactionId,
  description,
  onComplete,
  onCancel,
  expiresIn = 900,
  wsUrl,
}: IkhodePaymentCardProps) => {
  const { toast } = useToast();
  const navigate = useNavigate();
  const wsRef = useRef<WebSocket | null>(null);
  
  const [timeLeft, setTimeLeft] = useState(expiresIn);
  const [copied, setCopied] = useState(false);
  const [checking, setChecking] = useState(false);
  const [paymentStatus, setPaymentStatus] = useState<"pending" | "paid" | "provisioning" | "active">("pending");
  const [wsConnected, setWsConnected] = useState(false);
  const [wsReconnecting, setWsReconnecting] = useState(false);

  // WebSocket connection for real-time updates
  useEffect(() => {
    if (!wsUrl || paymentStatus !== "pending") return;

    const connectWebSocket = () => {
      try {
        console.log("Connecting to WebSocket:", wsUrl);
        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        ws.onopen = () => {
          console.log("WebSocket connected");
          setWsConnected(true);
          setWsReconnecting(false);
          
          // Subscribe to transaction updates
          ws.send(JSON.stringify({
            type: "subscribe",
            transactionId,
          }));
        };

        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            console.log("WebSocket message:", data);

            if (data.type === "payment_received" && data.transactionId === transactionId) {
              handlePaymentSuccess();
            } else if (data.type === "payment_status" && data.status === "paid") {
              handlePaymentSuccess();
            }
          } catch (e) {
            console.error("WebSocket message parse error:", e);
          }
        };

        ws.onclose = () => {
          console.log("WebSocket closed");
          setWsConnected(false);
          
          // Reconnect if payment still pending
          if (paymentStatus === "pending" && timeLeft > 0) {
            setWsReconnecting(true);
            setTimeout(connectWebSocket, 3000);
          }
        };

        ws.onerror = (error) => {
          console.error("WebSocket error:", error);
          setWsConnected(false);
        };
      } catch (error) {
        console.error("WebSocket connection error:", error);
      }
    };

    connectWebSocket();

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [wsUrl, transactionId, paymentStatus, timeLeft]);

  // Timer countdown
  useEffect(() => {
    const timer = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  // Fallback polling if no WebSocket
  useEffect(() => {
    if (wsConnected || paymentStatus !== "pending") return;

    const pollInterval = setInterval(async () => {
      await checkPaymentStatus(true);
    }, 10000); // Poll every 10 seconds as fallback

    return () => clearInterval(pollInterval);
  }, [wsConnected, paymentStatus, orderId]);

  const handlePaymentSuccess = async () => {
    setPaymentStatus("paid");
    toast({ title: "Payment received!", description: "Setting up your server..." });

    try {
      // Update order and invoice status
      await supabase.from("orders").update({ status: "paid" }).eq("id", orderId);
      
      const { data: invoiceUpdate } = await supabase
        .from("invoices")
        .update({ status: "paid", paid_at: new Date().toISOString() })
        .eq("order_id", orderId)
        .select()
        .single();

      // Send payment confirmation email
      if (invoiceUpdate) {
        try {
          await supabase.functions.invoke("send-email", {
            body: { action: "payment-confirmation", invoiceId: invoiceUpdate.id }
          });
        } catch (emailError) {
          console.error("Email notification error:", emailError);
        }
      }

      // Trigger server provisioning
      setPaymentStatus("provisioning");
      
      const { data: order } = await supabase.from("orders").select("*").eq("id", orderId).single();
      
      if (order) {
        const { error: provisionError } = await supabase.functions.invoke("pterodactyl", {
          body: { action: "create", orderId, serverDetails: order.server_details },
        });

        if (provisionError) {
          console.error("Provisioning error:", provisionError);
          toast({ title: "Server provisioning started", description: "Your server is being set up." });
        } else {
          toast({ title: "Server created!", description: "Your server is now active." });
        }
      }

      setPaymentStatus("active");
      onComplete?.();
      
      setTimeout(() => navigate("/client"), 2000);
    } catch (error) {
      console.error("Post-payment error:", error);
    }
  };

  const checkPaymentStatus = useCallback(async (silent = false) => {
    if (!silent) setChecking(true);
    
    try {
      const { data, error } = await supabase.functions.invoke("ikhode-payment", {
        body: { action: "check-status", transactionId: orderId },
      });

      if (error) throw error;

      if (data?.status === "paid") {
        await handlePaymentSuccess();
      } else if (!silent) {
        toast({ 
          title: "Payment not yet received", 
          description: "Please complete the payment in your banking app" 
        });
      }
    } catch (error: any) {
      console.error("Payment check error:", error);
      if (!silent) {
        toast({ title: "Error checking payment", description: error.message, variant: "destructive" });
      }
    } finally {
      if (!silent) setChecking(false);
    }
  }, [orderId, toast]);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    toast({ title: `${label} copied!` });
    setTimeout(() => setCopied(false), 2000);
  };

  const isExpired = timeLeft === 0;

  if (paymentStatus === "paid" || paymentStatus === "provisioning" || paymentStatus === "active") {
    return (
      <Card className="overflow-hidden border-0 shadow-2xl">
        <div className="bg-gradient-to-br from-green-500 via-green-600 to-green-700 p-8 text-white text-center">
          <CheckCircle2 className="w-16 h-16 mx-auto mb-4 animate-bounce" />
          <h2 className="text-2xl font-bold mb-2">
            {paymentStatus === "paid" ? "Payment Received!" : 
             paymentStatus === "provisioning" ? "Setting Up Server..." : 
             "Server Active!"}
          </h2>
          <p className="text-white/80">
            {paymentStatus === "provisioning" 
              ? "Your server is being provisioned..." 
              : "Redirecting to your dashboard..."}
          </p>
        </div>
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden border-0 shadow-2xl">
      {/* Header */}
      <div className="relative bg-gradient-to-br from-blue-600 via-indigo-600 to-purple-700 p-6 text-white overflow-hidden">
        <div className="absolute inset-0 opacity-10" style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='0.4'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
        }} />
        
        <div className="relative">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 bg-white/20 backdrop-blur rounded-xl flex items-center justify-center">
                <Wallet className="w-6 h-6" />
              </div>
              <div>
                <h2 className="text-xl font-bold">Ikhode KHQR</h2>
                <p className="text-white/80 text-sm">Bakong Payment</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {wsConnected ? (
                <Badge className="bg-green-500/20 text-green-200 border-0">
                  <Wifi className="w-3 h-3 mr-1" />
                  Live
                </Badge>
              ) : wsReconnecting ? (
                <Badge className="bg-yellow-500/20 text-yellow-200 border-0">
                  <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                  Reconnecting
                </Badge>
              ) : (
                <Badge className="bg-white/20 text-white border-0">
                  <Shield className="w-3 h-3 mr-1" />
                  Secure
                </Badge>
              )}
            </div>
          </div>
          
          <div className="text-center py-4">
            <p className="text-white/70 text-sm mb-1">Amount to Pay</p>
            <div className="flex items-baseline justify-center gap-1">
              <span className="text-4xl font-bold">{currency === "USD" ? "$" : "៛"}</span>
              <span className="text-5xl font-bold">
                {currency === "KHR" ? amount.toLocaleString() : amount.toFixed(2)}
              </span>
              <span className="text-xl font-medium ml-1">{currency}</span>
            </div>
            {description && (
              <p className="text-white/70 text-sm mt-2">{description}</p>
            )}
          </div>
        </div>
      </div>

      <CardContent className="p-6 bg-gradient-to-b from-background to-muted/30">
        {/* QR Code */}
        <div className="relative mx-auto w-fit">
          <div className="absolute -top-2 -left-2 w-8 h-8 border-t-4 border-l-4 border-blue-600 rounded-tl-lg" />
          <div className="absolute -top-2 -right-2 w-8 h-8 border-t-4 border-r-4 border-blue-600 rounded-tr-lg" />
          <div className="absolute -bottom-2 -left-2 w-8 h-8 border-b-4 border-l-4 border-blue-600 rounded-bl-lg" />
          <div className="absolute -bottom-2 -right-2 w-8 h-8 border-b-4 border-r-4 border-blue-600 rounded-br-lg" />
          
          <div className={`p-4 bg-white rounded-2xl shadow-lg transition-all ${isExpired ? "opacity-50 grayscale" : ""}`}>
            <img
              src={qrCode.startsWith("data:") ? qrCode : `data:image/png;base64,${qrCode}`}
              alt="KHQR Payment Code"
              className="w-56 h-56 sm:w-64 sm:h-64"
            />
          </div>

          {isExpired && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/50 rounded-2xl">
              <div className="text-center text-white">
                <Timer className="w-8 h-8 mx-auto mb-2" />
                <p className="font-semibold">QR Expired</p>
              </div>
            </div>
          )}
        </div>

        {/* Real-time indicator */}
        {wsConnected && (
          <div className="flex items-center justify-center gap-2 mt-4">
            <Zap className="w-4 h-4 text-green-500 animate-pulse" />
            <span className="text-sm text-green-600 dark:text-green-400">
              Real-time updates active
            </span>
          </div>
        )}

        {/* Timer */}
        <div className="flex items-center justify-center gap-2 mt-4">
          <Timer className={`w-4 h-4 ${timeLeft < 60 ? "text-destructive animate-pulse" : "text-muted-foreground"}`} />
          <span className={`font-mono text-lg ${timeLeft < 60 ? "text-destructive font-bold" : "text-muted-foreground"}`}>
            {formatTime(timeLeft)}
          </span>
          <span className="text-sm text-muted-foreground">remaining</span>
        </div>

        {/* Instructions */}
        <div className="mt-6 p-4 bg-muted/50 rounded-xl space-y-3">
          <div className="flex items-start gap-3">
            <div className="w-6 h-6 rounded-full bg-blue-600 text-white flex items-center justify-center text-xs font-bold flex-shrink-0">1</div>
            <p className="text-sm">Open your <strong>Bakong</strong> or any banking app</p>
          </div>
          <div className="flex items-start gap-3">
            <div className="w-6 h-6 rounded-full bg-blue-600 text-white flex items-center justify-center text-xs font-bold flex-shrink-0">2</div>
            <p className="text-sm">Tap <strong>Scan QR</strong> and scan this code</p>
          </div>
          <div className="flex items-start gap-3">
            <div className="w-6 h-6 rounded-full bg-blue-600 text-white flex items-center justify-center text-xs font-bold flex-shrink-0">3</div>
            <p className="text-sm">Confirm the payment in your app</p>
          </div>
        </div>

        {/* Transaction ID */}
        <div className="mt-4 flex items-center justify-between p-3 bg-muted rounded-lg">
          <div>
            <p className="text-xs text-muted-foreground">Transaction ID</p>
            <p className="font-mono text-sm truncate max-w-[180px]">{transactionId}</p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => copyToClipboard(transactionId, "Transaction ID")}
            className="h-8 w-8"
          >
            {copied ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
          </Button>
        </div>

        {/* Actions */}
        <div className="mt-6 space-y-3">
          <Button
            onClick={() => checkPaymentStatus(false)}
            disabled={checking || isExpired}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white gap-2"
          >
            {checking ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Checking...
              </>
            ) : (
              <>
                <RefreshCw className="w-4 h-4" />
                I've Completed Payment
              </>
            )}
          </Button>
          
          {onCancel && (
            <Button variant="outline" onClick={onCancel} className="w-full">
              Cancel Order
            </Button>
          )}
        </div>

        <div className="mt-6 pt-4 border-t border-border">
          <p className="text-xs text-center text-muted-foreground mb-3">
            Supported by all Bakong member banks
          </p>
          <div className="flex items-center justify-center gap-4 opacity-60">
            <Smartphone className="w-5 h-5" />
            <span className="text-xs">Scan with any banking app</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default IkhodePaymentCard;
