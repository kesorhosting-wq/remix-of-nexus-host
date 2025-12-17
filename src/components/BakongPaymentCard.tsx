import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { QrCode, Copy, Check, Timer, Smartphone, Shield, RefreshCw, Loader2, CheckCircle2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";

interface BakongPaymentCardProps {
  qrCode: string;
  amount: number;
  currency?: string;
  orderId: string;
  description?: string;
  onComplete?: () => void;
  onCancel?: () => void;
  expiresIn?: number;
  exchangeRate?: number;
}

const BakongPaymentCard = ({
  qrCode,
  amount,
  currency = "USD",
  orderId,
  description,
  onComplete,
  onCancel,
  expiresIn = 900,
  exchangeRate,
}: BakongPaymentCardProps) => {
  const { toast } = useToast();
  const navigate = useNavigate();
  const [timeLeft, setTimeLeft] = useState(expiresIn);
  const [copied, setCopied] = useState(false);
  const [checking, setChecking] = useState(false);
  const [paymentStatus, setPaymentStatus] = useState<"pending" | "paid" | "provisioning" | "active">("pending");
  const [autoPolling, setAutoPolling] = useState(true);

  // Auto-poll for payment status every 5 seconds
  useEffect(() => {
    if (!autoPolling || paymentStatus !== "pending") return;
    
    const pollInterval = setInterval(async () => {
      await checkPaymentStatus(true);
    }, 5000);

    return () => clearInterval(pollInterval);
  }, [autoPolling, paymentStatus, orderId]);

  useEffect(() => {
    const timer = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          setAutoPolling(false);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  const copyOrderId = () => {
    navigator.clipboard.writeText(orderId);
    setCopied(true);
    toast({ title: "Order ID copied!" });
    setTimeout(() => setCopied(false), 2000);
  };

  const checkPaymentStatus = useCallback(async (silent = false) => {
    if (!silent) setChecking(true);
    
    try {
      // Check payment status via edge function
      const { data, error } = await supabase.functions.invoke("bakong-qr", {
        body: { action: "check-payment", orderId },
      });

      if (error) throw error;

      if (data?.status === "paid") {
        setPaymentStatus("paid");
        setAutoPolling(false);
        toast({ title: "Payment received!", description: "Setting up your server..." });

        // Update order and invoice status
        await supabase.from("orders").update({ status: "paid" }).eq("id", orderId);
        await supabase.from("invoices").update({ status: "paid", paid_at: new Date().toISOString() }).eq("order_id", orderId);

        // Trigger server provisioning
        setPaymentStatus("provisioning");
        
        const { data: order } = await supabase.from("orders").select("*").eq("id", orderId).single();
        
        if (order) {
          const { error: provisionError } = await supabase.functions.invoke("pterodactyl", {
            body: { action: "create", orderId, serverDetails: order.server_details },
          });

          if (provisionError) {
            console.error("Provisioning error:", provisionError);
            toast({ title: "Server provisioning started", description: "Your server is being set up. Check your services page." });
          } else {
            toast({ title: "Server created!", description: "Your server is now active." });
          }
        }

        setPaymentStatus("active");
        onComplete?.();
        
        // Redirect to client area after 2 seconds
        setTimeout(() => navigate("/client"), 2000);
      } else if (!silent) {
        toast({ title: "Payment not yet received", description: "Please complete the payment in your Bakong app" });
      }
    } catch (error: any) {
      console.error("Payment check error:", error);
      if (!silent) {
        toast({ title: "Error checking payment", description: error.message, variant: "destructive" });
      }
    } finally {
      if (!silent) setChecking(false);
    }
  }, [orderId, toast, navigate, onComplete]);

  const handleCheckPayment = () => checkPaymentStatus(false);

  const isExpired = timeLeft === 0;

  return (
    <Card className="overflow-hidden border-0 shadow-2xl">
      {/* Header with gradient */}
      <div className="relative bg-gradient-to-br from-[#e31837] via-[#c41230] to-[#8b0d24] p-6 text-white overflow-hidden">
        {/* Pattern overlay */}
        <div 
          className="absolute inset-0 opacity-10"
          style={{
            backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='0.4'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
          }}
        />
        <div className="relative">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 bg-white/20 backdrop-blur rounded-xl flex items-center justify-center">
                <QrCode className="w-6 h-6" />
              </div>
              <div>
                <h2 className="text-xl font-bold">BakongKHQR</h2>
                <p className="text-white/80 text-sm">Cambodia's National Payment</p>
              </div>
            </div>
            <Badge className="bg-white/20 text-white border-0 backdrop-blur">
              <Shield className="w-3 h-3 mr-1" />
              Secure
            </Badge>
          </div>
          
          {/* Amount display */}
          <div className="text-center py-4">
            <p className="text-white/70 text-sm mb-1">Amount to Pay</p>
            <div className="flex items-baseline justify-center gap-1">
              <span className="text-4xl font-bold">{currency === "USD" ? "$" : "៛"}</span>
              <span className="text-5xl font-bold">
                {currency === "KHR" ? amount.toLocaleString() : amount.toFixed(2)}
              </span>
              <span className="text-xl font-medium ml-1">{currency}</span>
            </div>
            {exchangeRate && currency === "KHR" && (
              <p className="text-white/60 text-xs mt-1">
                ≈ ${(amount / exchangeRate).toFixed(2)} USD (1 USD = {exchangeRate.toLocaleString()} KHR)
              </p>
            )}
            {description && (
              <p className="text-white/70 text-sm mt-2">{description}</p>
            )}
          </div>
        </div>
      </div>

      <CardContent className="p-6 bg-gradient-to-b from-background to-muted/30">
        {/* QR Code Container */}
        <div className="relative mx-auto w-fit">
          {/* Decorative corners */}
          <div className="absolute -top-2 -left-2 w-8 h-8 border-t-4 border-l-4 border-[#e31837] rounded-tl-lg"></div>
          <div className="absolute -top-2 -right-2 w-8 h-8 border-t-4 border-r-4 border-[#e31837] rounded-tr-lg"></div>
          <div className="absolute -bottom-2 -left-2 w-8 h-8 border-b-4 border-l-4 border-[#e31837] rounded-bl-lg"></div>
          <div className="absolute -bottom-2 -right-2 w-8 h-8 border-b-4 border-r-4 border-[#e31837] rounded-br-lg"></div>
          
          <div className={`p-4 bg-white rounded-2xl shadow-lg transition-all ${isExpired ? "opacity-50 grayscale" : ""}`}>
            <img
              src={`data:image/png;base64,${qrCode}`}
              alt="Bakong KHQR Payment Code"
              className="w-56 h-56 sm:w-64 sm:h-64"
            />
          </div>

          {/* Expired overlay */}
          {isExpired && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/50 rounded-2xl">
              <div className="text-center text-white">
                <Timer className="w-8 h-8 mx-auto mb-2" />
                <p className="font-semibold">QR Expired</p>
              </div>
            </div>
          )}
        </div>

        {/* Timer */}
        <div className="flex items-center justify-center gap-2 mt-6">
          <Timer className={`w-4 h-4 ${timeLeft < 60 ? "text-destructive animate-pulse" : "text-muted-foreground"}`} />
          <span className={`font-mono text-lg ${timeLeft < 60 ? "text-destructive font-bold" : "text-muted-foreground"}`}>
            {formatTime(timeLeft)}
          </span>
          <span className="text-sm text-muted-foreground">remaining</span>
        </div>

        {/* Instructions */}
        <div className="mt-6 p-4 bg-muted/50 rounded-xl space-y-3">
          <div className="flex items-start gap-3">
            <div className="w-6 h-6 rounded-full bg-[#e31837] text-white flex items-center justify-center text-xs font-bold flex-shrink-0">1</div>
            <p className="text-sm">Open your <strong>Bakong</strong> mobile app</p>
          </div>
          <div className="flex items-start gap-3">
            <div className="w-6 h-6 rounded-full bg-[#e31837] text-white flex items-center justify-center text-xs font-bold flex-shrink-0">2</div>
            <p className="text-sm">Tap <strong>Scan QR</strong> and scan this code</p>
          </div>
          <div className="flex items-start gap-3">
            <div className="w-6 h-6 rounded-full bg-[#e31837] text-white flex items-center justify-center text-xs font-bold flex-shrink-0">3</div>
            <p className="text-sm">Confirm the payment in your app</p>
          </div>
        </div>

        {/* Order ID */}
        <div className="mt-4 flex items-center justify-between p-3 bg-muted rounded-lg">
          <div>
            <p className="text-xs text-muted-foreground">Order Reference</p>
            <p className="font-mono text-sm truncate max-w-[180px]">{orderId}</p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={copyOrderId}
            className="h-8 w-8"
          >
            {copied ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
          </Button>
        </div>

        {/* Action Buttons */}
        <div className="mt-6 space-y-3">
          <Button
            onClick={handleCheckPayment}
            disabled={checking || isExpired}
            className="w-full bg-[#e31837] hover:bg-[#c41230] text-white gap-2"
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
            <Button
              variant="outline"
              onClick={onCancel}
              className="w-full"
            >
              Cancel Order
            </Button>
          )}
        </div>

        {/* Supported banks indicator */}
        <div className="mt-6 pt-4 border-t border-border">
          <p className="text-xs text-center text-muted-foreground mb-3">
            Supported by all Bakong member banks
          </p>
          <div className="flex items-center justify-center gap-4 opacity-60">
            <Smartphone className="w-5 h-5" />
            <span className="text-xs">Scan with Bakong App</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default BakongPaymentCard;
