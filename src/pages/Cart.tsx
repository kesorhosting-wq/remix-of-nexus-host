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
  const { items, removeFromCart, updateQuantity, getTotal, itemCount } = useCart();
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
      <main className="container mx-auto px-4 py-20 sm:py-24">
        <h1 className="font-display text-2xl sm:text-3xl font-bold mb-6 sm:mb-8 flex flex-wrap items-center gap-2 sm:gap-3">
          <ShoppingCart className="w-6 h-6 sm:w-8 sm:h-8 text-primary" />
          Shopping Cart
          {itemCount > 0 && (
            <span className="text-xs sm:text-sm font-normal text-muted-foreground">
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
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 lg:gap-8">
            {/* Cart Items */}
            <div className="lg:col-span-2 space-y-4">
              {items.map((item) => (
                <Card key={item.id}>
                  <CardContent className="p-4 sm:p-6">
                    <div className="flex flex-col sm:flex-row items-start gap-4">
                      <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-xl bg-muted flex items-center justify-center flex-shrink-0">
                        {item.gameIcon.startsWith("/") || item.gameIcon.startsWith("http") ? (
                          <img src={item.gameIcon} alt={item.gameName} className="w-10 h-10 sm:w-12 sm:h-12 object-contain rounded" />
                        ) : (
                          <span className="text-2xl sm:text-3xl">{item.gameIcon}</span>
                        )}
                      </div>
                      <div className="flex-1 w-full">
                        <div className="flex justify-between items-start">
                          <div>
                            <h3 className="font-semibold text-base sm:text-lg">{item.gameName}</h3>
                            <p className="text-sm text-muted-foreground">{item.planName}</p>
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => removeFromCart(item.id)}
                            className="text-destructive hover:text-destructive h-8 w-8"
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                        <div className="mt-2 text-xs sm:text-sm text-muted-foreground grid grid-cols-2 gap-1 sm:gap-2">
                          <span>{item.ram} RAM</span>
                          <span>{item.cpu}</span>
                          <span>{item.storage}</span>
                          <span>{item.slots}</span>
                        </div>
                        <div className="mt-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                          <span className="text-lg sm:text-xl font-bold text-primary">
                            ${(item.price * item.quantity).toFixed(2)}/mo
                          </span>
                          <div className="flex items-center gap-2">
                            <Button
                              variant="outline"
                              size="icon"
                              className="h-8 w-8"
                              onClick={() => updateQuantity(item.id, item.quantity - 1)}
                            >
                              <Minus className="w-4 h-4" />
                            </Button>
                            <span className="w-8 text-center font-medium">{item.quantity}</span>
                            <Button
                              variant="outline"
                              size="icon"
                              className="h-8 w-8"
                              onClick={() => updateQuantity(item.id, item.quantity + 1)}
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