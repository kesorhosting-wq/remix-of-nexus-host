import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Server, CreditCard, ArrowLeft, Loader2, AlertCircle, Zap, Package } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { useCart } from "@/contexts/CartContext";
import IkhodePaymentCard from "@/components/IkhodePaymentCard";
import { useIkhodePayment } from "@/hooks/useIkhodePayment";
import LoadingScreen from "@/components/LoadingScreen";
import abaPaywayIcon from "@/assets/aba-payway.svg";

interface PlanConfig {
  nestId: number | null;
  nestName: string | null;
  eggId: number | null;
  eggName: string | null;
}

const Checkout = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user, loading: authLoading } = useAuth();
  const { items, getTotal, clearCart, itemCount } = useCart();
  
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [serverNames, setServerNames] = useState<Record<string, string>>({});
  const [planConfigs, setPlanConfigs] = useState<Record<string, PlanConfig>>({});
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [orderId, setOrderId] = useState<string | null>(null);
  const [invoiceId, setInvoiceId] = useState<string | null>(null);
  const [wsUrl, setWsUrl] = useState<string | null>(null);
  const [ikhodeAvailable, setIkhodeAvailable] = useState(false);
  const [emailVerified, setEmailVerified] = useState(false);
  const [checkingEmail, setCheckingEmail] = useState(true);
  
  const { generateKHQR, fetchConfig, getWebSocketUrl, loading: ikhodeLoading } = useIkhodePayment();

  useEffect(() => {
    if (!authLoading && !user) {
      navigate("/auth");
      return;
    }
    if (items.length === 0 && !authLoading) {
      navigate("/cart");
      return;
    }
    if (user) {
      verifyUserEmail();
      checkIkhodeAvailability();
      fetchPlanConfigs();
    }
  }, [user, authLoading, items.length]);

  const verifyUserEmail = async () => {
    setCheckingEmail(true);
    try {
      if (!user?.email) {
        setEmailVerified(false);
        toast({
          title: "Email Required",
          description: "Please add a valid email to your account before checkout.",
          variant: "destructive",
        });
        return;
      }

      const { data: profile, error } = await supabase
        .from("profiles")
        .select("email")
        .eq("user_id", user.id)
        .single();

      if (error || !profile?.email) {
        await supabase
          .from("profiles")
          .upsert({ 
            user_id: user.id, 
            email: user.email 
          }, { onConflict: 'user_id' });
      }

      setEmailVerified(true);
    } catch (error) {
      console.error("Error verifying email:", error);
      setEmailVerified(false);
    } finally {
      setCheckingEmail(false);
    }
  };

  const checkIkhodeAvailability = async () => {
    const config = await fetchConfig();
    setIkhodeAvailable(!!config?.apiUrl);
  };

  const fetchPlanConfigs = async () => {
    try {
      const planIds = [...new Set(items.map(item => item.planId))];
      
      const { data: plans, error } = await supabase
        .from("game_plans")
        .select("id, pterodactyl_nest_id, pterodactyl_egg_id")
        .in("id", planIds);

      if (error) throw error;

      // Fetch nest and egg names from Pterodactyl
      const configs: Record<string, PlanConfig> = {};
      
      for (const plan of plans || []) {
        let nestName = null;
        let eggName = null;

        if (plan.pterodactyl_nest_id) {
          try {
            const { data } = await supabase.functions.invoke("pterodactyl", {
              body: { action: "get-nests" }
            });
            const nest = data?.data?.find((n: any) => n.attributes.id === plan.pterodactyl_nest_id);
            nestName = nest?.attributes?.name || `Nest ${plan.pterodactyl_nest_id}`;
            
            if (plan.pterodactyl_egg_id && nest) {
              const eggData = await supabase.functions.invoke("pterodactyl", {
                body: { action: "get-eggs", nestId: plan.pterodactyl_nest_id }
              });
              const egg = eggData.data?.data?.find((e: any) => e.attributes.id === plan.pterodactyl_egg_id);
              eggName = egg?.attributes?.name || `Egg ${plan.pterodactyl_egg_id}`;
            }
          } catch (e) {
            console.error("Error fetching nest/egg names:", e);
          }
        }

        configs[plan.id] = {
          nestId: plan.pterodactyl_nest_id,
          nestName,
          eggId: plan.pterodactyl_egg_id,
          eggName,
        };
      }

      setPlanConfigs(configs);
    } catch (error) {
      console.error("Error fetching plan configs:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleCheckout = async () => {
    if (!user) return;

    if (!emailVerified) {
      toast({ 
        title: "Email verification required", 
        description: "Please ensure your account has a valid email before checkout.",
        variant: "destructive" 
      });
      return;
    }

    // Validate server names
    for (const item of items) {
      if (!serverNames[item.id]?.trim()) {
        toast({ 
          title: "Please enter server names", 
          description: `Enter a name for ${item.gameName} - ${item.planName}`,
          variant: "destructive" 
        });
        return;
      }
    }

    setProcessing(true);

    try {
      const total = getTotal();
      
      // Create a combined order for all items
      const { data: order, error: orderError } = await supabase
        .from("orders")
        .insert({
          user_id: user.id,
          price: total,
          status: "pending",
          billing_cycle: "monthly",
          server_details: {
            items: items.map(item => {
              const config = planConfigs[item.planId];
              return {
                server_name: serverNames[item.id],
                game_id: item.gameId,
                plan_id: item.planId,
                plan_name: item.planName,
                ram: item.ram,
                cpu: item.cpu,
                storage: item.storage,
                pterodactyl_nest_id: config?.nestId,
                pterodactyl_egg_id: config?.eggId,
                quantity: item.quantity,
              };
            }),
          },
        })
        .select()
        .single();

      if (orderError) throw orderError;

      setOrderId(order.id);

      // Create invoice
      const invoiceNumber = `INV-${Date.now()}`;
      const dueDate = new Date();
      dueDate.setDate(dueDate.getDate() + 7);

      const { data: invoice, error: invoiceError } = await supabase
        .from("invoices")
        .insert({
          user_id: user.id,
          order_id: order.id,
          invoice_number: invoiceNumber,
          subtotal: total,
          total: total,
          due_date: dueDate.toISOString(),
          status: "unpaid",
        })
        .select()
        .single();

      if (invoiceError) throw invoiceError;

      setInvoiceId(invoice.id);

      // Generate QR using ABA PayWay
      const result = await generateKHQR(
        total,
        invoice.id,
        user?.email,
        user?.email?.split("@")[0]
      );

      if (result) {
        setQrCode(result.qrCodeData);
        setWsUrl(result.wsUrl || getWebSocketUrl());
        toast({ title: "Order created! Scan QR to pay." });
      } else {
        throw new Error("Failed to generate QR code");
      }
    } catch (error: any) {
      console.error("Checkout error:", error);
      toast({
        title: "Checkout failed",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setProcessing(false);
    }
  };

  const handlePaymentComplete = () => {
    clearCart();
    navigate("/client");
  };

  const handleCancelPayment = () => {
    setQrCode(null);
    setOrderId(null);
    setInvoiceId(null);
    setWsUrl(null);
  };

  if (loading || authLoading || checkingEmail) {
    return <LoadingScreen />;
  }

  if (!emailVerified) {
    return (
      <div className="min-h-screen bg-background">
        <Navbar />
        <main className="container mx-auto px-4 py-24">
          <Card className="max-w-md mx-auto">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-destructive">
                <AlertCircle className="w-5 h-5" />
                Email Verification Required
              </CardTitle>
              <CardDescription>
                Your account needs a valid email address before you can checkout.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                A valid email is required to create your panel account and receive important notifications.
              </p>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => navigate("/cart")}>
                  <ArrowLeft className="w-4 h-4 mr-2" />
                  Back to Cart
                </Button>
                <Button onClick={() => navigate("/client")}>
                  Go to Account Settings
                </Button>
              </div>
            </CardContent>
          </Card>
        </main>
        <Footer />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="container mx-auto px-4 py-20 sm:py-24">
        <Button
          variant="ghost"
          className="mb-4 sm:mb-6 gap-2"
          onClick={() => navigate("/cart")}
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Cart
        </Button>

        <h1 className="font-display text-2xl sm:text-3xl font-bold mb-6 sm:mb-8 flex flex-wrap items-center gap-2 sm:gap-3">
          <CreditCard className="w-6 h-6 sm:w-8 sm:h-8 text-primary" />
          Checkout
          <span className="text-xs sm:text-sm font-normal text-muted-foreground">
            ({itemCount} {itemCount === 1 ? "server" : "servers"})
          </span>
        </h1>

        {qrCode ? (
          <div className="max-w-md mx-auto">
            <IkhodePaymentCard
              qrCode={qrCode}
              amount={getTotal()}
              currency="USD"
              invoiceId={invoiceId || ""}
              description={`${items.length} server(s)`}
              onCancel={handleCancelPayment}
              onComplete={handlePaymentComplete}
              wsUrl={wsUrl || undefined}
            />
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 lg:gap-8">
            {/* Server Configuration */}
            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Server className="w-5 h-5 text-primary" />
                    Server Configuration
                  </CardTitle>
                  <CardDescription>Enter a name for each server</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  {items.map((item, index) => {
                    const config = planConfigs[item.planId];
                    return (
                      <div key={item.id} className="space-y-4 p-3 sm:p-4 rounded-lg bg-muted/50">
                        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
                          <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl bg-muted flex items-center justify-center flex-shrink-0">
                            {item.gameIcon.startsWith("/") || item.gameIcon.startsWith("http") ? (
                              <img src={item.gameIcon} alt={item.gameName} className="w-6 h-6 sm:w-8 sm:h-8 object-contain rounded" />
                            ) : (
                              <span className="text-xl sm:text-2xl">{item.gameIcon}</span>
                            )}
                          </div>
                          <div className="flex-1 w-full">
                            <div className="flex justify-between items-start">
                              <div>
                                <h3 className="font-semibold text-sm sm:text-base">{item.gameName}</h3>
                                <p className="text-xs sm:text-sm text-muted-foreground">{item.planName}</p>
                              </div>
                              <Badge variant="secondary" className="text-xs">${item.price.toFixed(2)}/mo</Badge>
                            </div>
                          </div>
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor={`server-${item.id}`}>Server Name</Label>
                          <Input
                            id={`server-${item.id}`}
                            placeholder="My Awesome Server"
                            value={serverNames[item.id] || ""}
                            onChange={(e) =>
                              setServerNames({ ...serverNames, [item.id]: e.target.value })
                            }
                          />
                        </div>

                        {/* Admin-configured Nest/Egg (Read-only display) */}
                        {(config?.nestName || config?.eggName) && (
                          <div className="grid grid-cols-2 gap-3">
                            {config?.nestName && (
                              <div className="p-3 rounded-lg bg-background border">
                                <p className="text-xs text-muted-foreground mb-1">Nest</p>
                                <p className="text-sm font-medium flex items-center gap-2">
                                  <Package className="w-4 h-4 text-primary" />
                                  {config.nestName}
                                </p>
                              </div>
                            )}
                            {config?.eggName && (
                              <div className="p-3 rounded-lg bg-background border">
                                <p className="text-xs text-muted-foreground mb-1">Game Type</p>
                                <p className="text-sm font-medium flex items-center gap-2">
                                  <Server className="w-4 h-4 text-primary" />
                                  {config.eggName}
                                </p>
                              </div>
                            )}
                          </div>
                        )}

                        {item.quantity > 1 && (
                          <p className="text-sm text-muted-foreground">
                            × {item.quantity} servers
                          </p>
                        )}
                      </div>
                    );
                  })}
                </CardContent>
              </Card>
            </div>

            {/* Payment */}
            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <CreditCard className="w-5 h-5 text-primary" />
                    Payment
                  </CardTitle>
                  <CardDescription>Select payment method and complete order</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  {/* Order Summary */}
                  <div className="space-y-3">
                    {items.map((item) => (
                      <div key={item.id} className="flex justify-between text-sm">
                        <span className="text-muted-foreground">
                          {item.gameName} - {item.planName} {item.quantity > 1 && `×${item.quantity}`}
                        </span>
                        <span>${(item.price * item.quantity).toFixed(2)}</span>
                      </div>
                    ))}
                    <Separator />
                    <div className="flex justify-between font-semibold text-lg">
                      <span>Total</span>
                      <span className="text-primary">${getTotal().toFixed(2)}/mo</span>
                    </div>
                  </div>

                  {/* Payment Method */}
                  <div className="space-y-3">
                    <Label className="text-sm font-medium">Payment Method</Label>
                    <div className="flex items-center gap-3 p-4 rounded-lg border border-primary bg-primary/5">
                      <div className="w-12 h-12 rounded-lg bg-white flex items-center justify-center p-2">
                        <img src={abaPaywayIcon} alt="ABA PayWay" className="w-full h-full object-contain" />
                      </div>
                      <div className="flex-1">
                        <p className="font-medium flex items-center gap-2">
                          ABA PayWay
                          {ikhodeAvailable && (
                            <span className="inline-flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
                              <Zap className="w-3 h-3" />
                              Live
                            </span>
                          )}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {ikhodeAvailable ? "Real-time payment updates" : "Not configured"}
                        </p>
                      </div>
                    </div>
                  </div>

                  <Button
                    className="w-full"
                    size="lg"
                    onClick={handleCheckout}
                    disabled={processing || ikhodeLoading || !ikhodeAvailable}
                  >
                    {processing || ikhodeLoading ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Processing...
                      </>
                    ) : (
                      "Complete Order"
                    )}
                  </Button>

                  {!ikhodeAvailable && (
                    <p className="text-sm text-center text-muted-foreground">
                      Payment gateway not configured. Please contact admin.
                    </p>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        )}
      </main>
      <Footer />
    </div>
  );
};

export default Checkout;