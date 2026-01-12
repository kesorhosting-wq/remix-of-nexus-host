import { useState } from "react";
import { useNavigate } from "react-router-dom";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { useCart } from "@/contexts/CartContext";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Trash2, ShoppingCart, ArrowRight, Plus, Minus } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const Cart = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { items, removeFromCart, addToCart, getTotal, itemCount } = useCart();
  const { user, loading: authLoading } = useAuth();

  const handleProceedToCheckout = () => {
    if (!user) {
      toast({
        title: "Login Required",
        description: "Please login to proceed to checkout.",
        variant: "destructive",
      });
      navigate("/auth");
      return;
    }

    if (items.length === 0) {
      toast({
        title: "Cart is empty",
        description: "Add items to your cart before checkout.",
        variant: "destructive",
      });
      return;
    }

    navigate("/checkout");
  };

  const handleAddMore = (item: typeof items[0]) => {
    addToCart({
      id: `${item.gameId}-${item.planId}-${Date.now()}`,
      planId: item.planId,
      gameId: item.gameId,
      gameName: item.gameName,
      gameIcon: item.gameIcon,
      planName: item.planName,
      price: item.price,
      ram: item.ram,
      cpu: item.cpu,
      storage: item.storage,
      slots: item.slots,
    });
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
                        <div className="mt-4 flex items-center justify-between">
                          <span className="text-xl font-bold text-primary">
                            ${item.price.toFixed(2)}/mo
                          </span>
                          <div className="flex items-center gap-2">
                            <span className="text-sm text-muted-foreground">Qty: {item.quantity}</span>
                            <Button
                              variant="outline"
                              size="icon"
                              className="h-8 w-8"
                              onClick={() => handleAddMore(item)}
                            >
                              <Plus className="w-4 h-4" />
                            </Button>
                          </div>
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
                        {item.gameName} - {item.planName} x{item.quantity}
                      </span>
                      <span>${(item.price * item.quantity).toFixed(2)}</span>
                    </div>
                  ))}
                  <Separator />
                  <div className="flex justify-between font-semibold text-lg">
                    <span>Total</span>
                    <span className="text-primary">${getTotal().toFixed(2)}/mo</span>
                  </div>
                  
                  <Button
                    className="w-full gap-2"
                    size="lg"
                    onClick={handleProceedToCheckout}
                  >
                    Next
                    <ArrowRight className="w-4 h-4" />
                  </Button>

                  {/* Suggestions */}
                  <div className="pt-4 border-t">
                    <p className="text-sm text-muted-foreground mb-3">You might also like:</p>
                    <Button 
                      variant="outline" 
                      className="w-full text-sm"
                      onClick={() => navigate("/#pricing")}
                    >
                      Add More Servers
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