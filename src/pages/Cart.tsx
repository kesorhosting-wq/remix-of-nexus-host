import { useState, useEffect } from "react";
import abaPaywayIcon from "@/assets/aba-payway.svg";
import { useNavigate } from "react-router-dom";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { useCart } from "@/contexts/CartContext";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Trash2, ShoppingCart, ArrowRight, Loader2, Zap } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import IkhodePaymentCard from "@/components/IkhodePaymentCard";
import { useIkhodePayment } from "@/hooks/useIkhodePayment";
import { usePterodactylData } from "@/hooks/usePterodactylData";

interface NestEggSelection {
  nestId: number | null;
  eggId: number | null;
}

const Cart = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { items, removeFromCart, clearCart, getTotal, itemCount } = useCart();
  const { user, loading: authLoading } = useAuth();
  const { generateKHQR, fetchConfig, getWebSocketUrl, config } = useIkhodePayment();
  const { nests, getEggsForNest, loading: panelLoading } = usePterodactylData();
  
  const [serverNames, setServerNames] = useState<Record<string, string>>({});
  const [nestEggSelections, setNestEggSelections] = useState<Record<string, NestEggSelection>>({});
  const [processing, setProcessing] = useState(false);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [orderId, setOrderId] = useState<string | null>(null);
  const [invoiceId, setInvoiceId] = useState<string | null>(null);
  const [wsUrl, setWsUrl] = useState<string | null>(null);
  const [ikhodeAvailable, setIkhodeAvailable] = useState(false);

  // Check if Ikhode gateway is available
  useEffect(() => {
    const checkIkhodeAvailability = async () => {
      const cfg = await fetchConfig();
      setIkhodeAvailable(!!cfg?.apiUrl);
    };
    checkIkhodeAvailability();
  }, [fetchConfig]);

  const handleCheckout = async () => {
    if (!user) {
      navigate("/auth");
      return;
    }

    // Validate server names and nest/egg selections
    for (const item of items) {
      if (!serverNames[item.id]?.trim()) {
        toast({ 
          title: "Please enter server names", 
          description: `Enter a name for ${item.gameName} - ${item.planName}`,
          variant: "destructive" 
        });
        return;
      }
      const selection = nestEggSelections[item.id];
      if (!selection?.nestId || !selection?.eggId) {
        toast({ 
          title: "Please select Nest and Egg", 
          description: `Select a Nest and Egg for ${item.gameName} - ${item.planName}`,
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
              const selection = nestEggSelections[item.id];
              return {
                server_name: serverNames[item.id],
                game_id: item.gameId,
                plan_id: item.planId,
                plan_name: item.planName,
                ram: item.ram,
                cpu: item.cpu,
                storage: item.storage,
                pterodactyl_nest_id: selection?.nestId,
                pterodactyl_egg_id: selection?.eggId,
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

      // Use ABA PayWay (Ikhode gateway)
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

  if (authLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="container mx-auto px-4 py-24">
        <h1 className="font-display text-3xl font-bold mb-8 flex items-center gap-3">
          <ShoppingCart className="w-8 h-8 text-primary" />
          Shopping Cart
          {itemCount > 0 && (
            <span className="text-sm font-normal text-muted-foreground">
              ({itemCount} {itemCount === 1 ? "item" : "items"})
            </span>
          )}
        </h1>

        {items.length === 0 ? (
          <Card className="text-center py-16">
            <CardContent>
              <ShoppingCart className="w-16 h-16 text-muted-foreground mx-auto mb-4" />
              <h2 className="text-xl font-semibold mb-2">Your cart is empty</h2>
              <p className="text-muted-foreground mb-6">
                Browse our plans and add servers to your cart
              </p>
              <Button onClick={() => navigate("/#pricing")}>
                Browse Plans
              </Button>
            </CardContent>
          </Card>
        ) : qrCode ? (
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
          <div className="grid lg:grid-cols-3 gap-8">
            {/* Cart Items */}
            <div className="lg:col-span-2 space-y-4">
              {items.map((item) => (
                <Card key={item.id}>
                  <CardContent className="p-6">
                    <div className="flex items-start gap-4">
                      <div className="w-16 h-16 rounded-xl bg-muted flex items-center justify-center">
                        {item.gameIcon.startsWith("/") || item.gameIcon.startsWith("http") ? (
                          <img src={item.gameIcon} alt={item.gameName} className="w-12 h-12 object-contain rounded" />
                        ) : (
                          <span className="text-3xl">{item.gameIcon}</span>
                        )}
                      </div>
                      <div className="flex-1">
                        <div className="flex justify-between items-start">
                          <div>
                            <h3 className="font-semibold text-lg">{item.gameName}</h3>
                            <p className="text-muted-foreground">{item.planName}</p>
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => removeFromCart(item.id)}
                            className="text-destructive hover:text-destructive"
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                        <div className="mt-2 text-sm text-muted-foreground grid grid-cols-2 gap-2">
                          <span>{item.ram} RAM</span>
                          <span>{item.cpu}</span>
                          <span>{item.storage}</span>
                          <span>{item.slots}</span>
                        </div>
                        <div className="mt-4">
                          <Label htmlFor={`server-${item.id}`} className="text-sm">
                            Server Name
                          </Label>
                          <Input
                            id={`server-${item.id}`}
                            placeholder="My Awesome Server"
                            value={serverNames[item.id] || ""}
                            onChange={(e) =>
                              setServerNames({ ...serverNames, [item.id]: e.target.value })
                            }
                            className="mt-1"
                          />
                        </div>
                        
                        {/* Nest Selection */}
                        <div className="mt-4 grid grid-cols-2 gap-3">
                          <div>
                            <Label className="text-sm">Nest</Label>
                            <Select
                              value={nestEggSelections[item.id]?.nestId?.toString() || ""}
                              onValueChange={(value) => {
                                setNestEggSelections({
                                  ...nestEggSelections,
                                  [item.id]: { nestId: parseInt(value), eggId: null }
                                });
                              }}
                              disabled={panelLoading}
                            >
                              <SelectTrigger className="mt-1">
                                <SelectValue placeholder={panelLoading ? "Loading..." : "Select Nest"} />
                              </SelectTrigger>
                              <SelectContent>
                                {nests.map((nest) => (
                                  <SelectItem key={nest.id} value={nest.id.toString()}>
                                    {nest.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          
                          {/* Egg Selection */}
                          <div>
                            <Label className="text-sm">Egg</Label>
                            <Select
                              value={nestEggSelections[item.id]?.eggId?.toString() || ""}
                              onValueChange={(value) => {
                                setNestEggSelections({
                                  ...nestEggSelections,
                                  [item.id]: { 
                                    ...nestEggSelections[item.id], 
                                    eggId: parseInt(value) 
                                  }
                                });
                              }}
                              disabled={!nestEggSelections[item.id]?.nestId || panelLoading}
                            >
                              <SelectTrigger className="mt-1">
                                <SelectValue placeholder="Select Egg" />
                              </SelectTrigger>
                              <SelectContent>
                                {nestEggSelections[item.id]?.nestId && 
                                  getEggsForNest(nestEggSelections[item.id].nestId!).map((egg) => (
                                    <SelectItem key={egg.id} value={egg.id.toString()}>
                                      {egg.name}
                                    </SelectItem>
                                  ))
                                }
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                        <div className="mt-4 flex items-center justify-between">
                          <span className="text-xl font-bold text-primary">
                            ${item.price.toFixed(2)}/mo
                          </span>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>

            {/* Order Summary */}
            <div className="lg:col-span-1">
              <Card className="sticky top-24">
                <CardHeader>
                  <CardTitle>Order Summary</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {items.map((item) => (
                    <div key={item.id} className="flex justify-between text-sm">
                      <span className="text-muted-foreground">
                        {item.gameName} - {item.planName}
                      </span>
                      <span>${item.price.toFixed(2)}</span>
                    </div>
                  ))}
                  <Separator />
                  <div className="flex justify-between font-semibold text-lg">
                    <span>Total</span>
                    <span className="text-primary">${getTotal().toFixed(2)}/mo</span>
                  </div>
                  
                  {/* Payment Method Selection */}
                  <div className="pt-4 space-y-3">
                    <Label className="text-sm font-medium">Payment Method</Label>
                    {/* ABA PayWay Payment */}
                    <div className="flex items-center gap-3 p-3 rounded-lg border border-primary bg-primary/5">
                      <div className="w-10 h-10 rounded-lg bg-white flex items-center justify-center p-1">
                        <img src={abaPaywayIcon} alt="ABA PayWay" className="w-full h-full object-contain" />
                      </div>
                      <div className="flex-1">
                        <p className="font-medium text-sm flex items-center gap-2">
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
                    
                    <Button
                      className="w-full gap-2"
                      size="lg"
                      onClick={handleCheckout}
                      disabled={processing}
                    >
                      {processing ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Processing...
                        </>
                      ) : (
                        <>
                          Checkout
                          <ArrowRight className="w-4 h-4" />
                        </>
                      )}
                    </Button>
                  </div>
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

export default Cart;
