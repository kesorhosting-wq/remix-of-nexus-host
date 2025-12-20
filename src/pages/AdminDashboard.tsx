import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { 
  Shield, Home, LogOut, Package, FileText, MessageSquare, 
  DollarSign, Users, Server, Eye, Send, RefreshCw, Loader2,
  CheckCircle, XCircle, Clock, AlertCircle, CreditCard, Trash2, Pause, SquareCheck
} from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { format } from "date-fns";

interface Order {
  id: string;
  user_id: string;
  price: number;
  status: string;
  billing_cycle: string;
  server_details: any;
  server_id: string | null;
  created_at: string;
  user_email?: string;
}

interface Invoice {
  id: string;
  invoice_number: string;
  user_id: string;
  order_id: string | null;
  subtotal: number;
  total: number;
  status: string;
  due_date: string;
  created_at: string;
  user_email?: string;
}

interface Ticket {
  id: string;
  user_id: string;
  subject: string;
  status: string;
  priority: string | null;
  department: string | null;
  created_at: string;
  updated_at: string;
  user_email?: string;
  replies?: TicketReply[];
}

interface Profile {
  user_id: string;
  email: string | null;
}

interface TicketReply {
  id: string;
  message: string;
  is_staff: boolean;
  created_at: string;
}

interface Payment {
  id: string;
  user_id: string;
  invoice_id: string | null;
  gateway_id: string | null;
  amount: number;
  currency: string;
  status: string;
  transaction_id: string | null;
  created_at: string;
  user_email?: string;
  invoice_number?: string;
}

const statusColors: Record<string, string> = {
  pending: "bg-yellow-500/20 text-yellow-500",
  active: "bg-green-500/20 text-green-500",
  paid: "bg-green-500/20 text-green-500",
  unpaid: "bg-red-500/20 text-red-500",
  cancelled: "bg-gray-500/20 text-gray-500",
  suspended: "bg-orange-500/20 text-orange-500",
  open: "bg-blue-500/20 text-blue-500",
  closed: "bg-gray-500/20 text-gray-500",
  answered: "bg-green-500/20 text-green-500",
};

const AdminDashboard = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user, loading: authLoading, isAdmin, signOut } = useAuth();

  const [orders, setOrders] = useState<Order[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null);
  const [replyMessage, setReplyMessage] = useState("");
  const [sendingReply, setSendingReply] = useState(false);
  const [provisioningOrder, setProvisioningOrder] = useState<string | null>(null);
  const [updatingPayment, setUpdatingPayment] = useState<string | null>(null);
  const [deletingOrder, setDeletingOrder] = useState<string | null>(null);
  const [suspendingOrder, setSuspendingOrder] = useState<string | null>(null);
  const [selectedOrders, setSelectedOrders] = useState<Set<string>>(new Set());
  const [bulkActionLoading, setBulkActionLoading] = useState(false);

  useEffect(() => {
    if (!authLoading && !user) {
      navigate("/auth");
      return;
    }
    if (!authLoading && user && !isAdmin) {
      toast({ title: "Access Denied", variant: "destructive" });
      navigate("/");
      return;
    }
    if (user && isAdmin) {
      fetchData();
    }
  }, [user, authLoading, isAdmin]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [ordersRes, invoicesRes, ticketsRes, profilesRes, paymentsRes] = await Promise.all([
        supabase.from("orders").select("*").order("created_at", { ascending: false }),
        supabase.from("invoices").select("*").order("created_at", { ascending: false }),
        supabase.from("tickets").select("*, replies:ticket_replies(*)").order("updated_at", { ascending: false }),
        supabase.from("profiles").select("user_id, email"),
        supabase.from("payments").select("*").order("created_at", { ascending: false }),
      ]);

      const profileMap = new Map<string, string>();
      profilesRes.data?.forEach((p: Profile) => {
        if (p.email) profileMap.set(p.user_id, p.email);
      });

      const invoiceMap = new Map<string, string>();
      invoicesRes.data?.forEach((i: any) => {
        invoiceMap.set(i.id, i.invoice_number);
      });

      if (ordersRes.data) {
        setOrders(ordersRes.data.map((o: any) => ({ ...o, user_email: profileMap.get(o.user_id) || "N/A" })));
      }
      if (invoicesRes.data) {
        setInvoices(invoicesRes.data.map((i: any) => ({ ...i, user_email: profileMap.get(i.user_id) || "N/A" })));
      }
      if (ticketsRes.data) {
        setTickets(ticketsRes.data.map((t: any) => ({ ...t, user_email: profileMap.get(t.user_id) || "N/A" })));
      }
      if (paymentsRes.data) {
        setPayments(paymentsRes.data.map((p: any) => ({ 
          ...p, 
          user_email: profileMap.get(p.user_id) || "N/A",
          invoice_number: p.invoice_id ? invoiceMap.get(p.invoice_id) : null
        })));
      }
    } catch (error) {
      console.error("Error fetching data:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleProvisionServer = async (order: Order) => {
    if (order.status !== "paid" && order.status !== "active" && order.status !== "failed") {
      toast({ title: "Order must be paid first", variant: "destructive" });
      return;
    }

    setProvisioningOrder(order.id);
    try {
      const { data, error } = await supabase.functions.invoke("pterodactyl", {
        body: {
          action: "create",
          orderId: order.id,
          serverDetails: order.server_details,
        },
      });

      if (error) throw error;

      toast({ title: "Server provisioned successfully!" });
      fetchData();
    } catch (error: any) {
      console.error("Provisioning error:", error);
      toast({ title: "Failed to provision server", description: error.message, variant: "destructive" });
    } finally {
      setProvisioningOrder(null);
    }
  };

  const handleUpdateOrderStatus = async (orderId: string, status: string) => {
    const order = orders.find(o => o.id === orderId);
    setSuspendingOrder(orderId);
    
    try {
      // If suspending and server exists, suspend in Pterodactyl first
      if (status === "suspended" && order?.server_id) {
        try {
          const { error: suspendError } = await supabase.functions.invoke("pterodactyl", {
            body: { action: "suspend", serverId: order.server_id }
          });
          if (suspendError) {
            console.error("Failed to suspend in panel:", suspendError);
            toast({ title: "Warning: Failed to suspend server in panel", variant: "destructive" });
          }
        } catch (err) {
          console.error("Panel suspend error:", err);
        }
        
        // Send suspension email notification
        try {
          await supabase.functions.invoke("send-email", {
            body: { action: "service-suspended", orderId }
          });
          console.log("Suspension email sent");
        } catch (emailErr) {
          console.error("Failed to send suspension email:", emailErr);
        }
      }
      
      // If unsuspending/activating and server exists, unsuspend in Pterodactyl
      if (status === "active" && order?.server_id && order.status === "suspended") {
        try {
          const { error: unsuspendError } = await supabase.functions.invoke("pterodactyl", {
            body: { action: "unsuspend", serverId: order.server_id }
          });
          if (unsuspendError) {
            console.error("Failed to unsuspend in panel:", unsuspendError);
            toast({ title: "Warning: Failed to unsuspend server in panel", variant: "destructive" });
          }
        } catch (err) {
          console.error("Panel unsuspend error:", err);
        }
      }

      const { error } = await supabase.from("orders").update({ status }).eq("id", orderId);
      if (error) throw error;
      toast({ title: `Order status updated to ${status}` });
      fetchData();
    } catch (error: any) {
      toast({ title: "Failed to update status", variant: "destructive" });
    } finally {
      setSuspendingOrder(null);
    }
  };

  const handleDeleteOrder = async (order: Order) => {
    setDeletingOrder(order.id);
    try {
      // Send termination email notification before deleting
      try {
        await supabase.functions.invoke("send-email", {
          body: { action: "service-terminated", orderId: order.id }
        });
        console.log("Termination email sent");
      } catch (emailErr) {
        console.error("Failed to send termination email:", emailErr);
      }

      // If server exists, terminate it in Pterodactyl first
      if (order.server_id) {
        try {
          const { error: terminateError } = await supabase.functions.invoke("pterodactyl", {
            body: { action: "terminate", serverId: order.server_id }
          });
          if (terminateError) {
            console.error("Failed to terminate in panel:", terminateError);
          }
        } catch (err) {
          console.error("Panel terminate error:", err);
        }
      }

      // Delete related invoices first
      const { error: invoiceError } = await supabase
        .from("invoices")
        .delete()
        .eq("order_id", order.id);
      
      if (invoiceError) {
        console.error("Failed to delete invoices:", invoiceError);
      }

      // Delete the order
      const { error } = await supabase.from("orders").delete().eq("id", order.id);
      if (error) throw error;
      
      toast({ title: "Service deleted successfully" });
      fetchData();
    } catch (error: any) {
      toast({ title: "Failed to delete service", description: error.message, variant: "destructive" });
    } finally {
      setDeletingOrder(null);
    }
  };

  // Bulk selection handlers
  const toggleOrderSelection = (orderId: string) => {
    setSelectedOrders(prev => {
      const newSet = new Set(prev);
      if (newSet.has(orderId)) {
        newSet.delete(orderId);
      } else {
        newSet.add(orderId);
      }
      return newSet;
    });
  };

  const toggleSelectAll = () => {
    if (selectedOrders.size === orders.length) {
      setSelectedOrders(new Set());
    } else {
      setSelectedOrders(new Set(orders.map(o => o.id)));
    }
  };

  const handleBulkSuspend = async () => {
    if (selectedOrders.size === 0) return;
    setBulkActionLoading(true);
    
    try {
      const selectedOrdersList = orders.filter(o => selectedOrders.has(o.id));
      let successCount = 0;
      let failCount = 0;

      for (const order of selectedOrdersList) {
        try {
          // Suspend in Pterodactyl if server exists
          if (order.server_id) {
            await supabase.functions.invoke("pterodactyl", {
              body: { action: "suspend", serverId: order.server_id }
            });
          }
          
          // Update status in database
          await supabase.from("orders").update({ status: "suspended" }).eq("id", order.id);
          
          // Send suspension email
          await supabase.functions.invoke("send-email", {
            body: { action: "service-suspended", orderId: order.id }
          });
          
          successCount++;
        } catch (err) {
          console.error(`Failed to suspend order ${order.id}:`, err);
          failCount++;
        }
      }

      toast({ 
        title: `Bulk suspend complete`, 
        description: `${successCount} suspended, ${failCount} failed` 
      });
      setSelectedOrders(new Set());
      fetchData();
    } catch (error: any) {
      toast({ title: "Bulk suspend failed", variant: "destructive" });
    } finally {
      setBulkActionLoading(false);
    }
  };

  const handleBulkDelete = async () => {
    if (selectedOrders.size === 0) return;
    setBulkActionLoading(true);
    
    try {
      const selectedOrdersList = orders.filter(o => selectedOrders.has(o.id));
      let successCount = 0;
      let failCount = 0;

      for (const order of selectedOrdersList) {
        try {
          // Send termination email
          await supabase.functions.invoke("send-email", {
            body: { action: "service-terminated", orderId: order.id }
          });

          // Terminate in Pterodactyl if server exists
          if (order.server_id) {
            await supabase.functions.invoke("pterodactyl", {
              body: { action: "terminate", serverId: order.server_id }
            });
          }

          // Delete related invoices
          await supabase.from("invoices").delete().eq("order_id", order.id);

          // Delete the order
          await supabase.from("orders").delete().eq("id", order.id);
          
          successCount++;
        } catch (err) {
          console.error(`Failed to delete order ${order.id}:`, err);
          failCount++;
        }
      }

      toast({ 
        title: `Bulk delete complete`, 
        description: `${successCount} deleted, ${failCount} failed` 
      });
      setSelectedOrders(new Set());
      fetchData();
    } catch (error: any) {
      toast({ title: "Bulk delete failed", variant: "destructive" });
    } finally {
      setBulkActionLoading(false);
    }
  };

  const handleUpdateInvoiceStatus = async (invoiceId: string, status: string) => {
    try {
      const updates: any = { status };
      if (status === "paid") updates.paid_at = new Date().toISOString();
      
      const { error } = await supabase.from("invoices").update(updates).eq("id", invoiceId);
      if (error) throw error;
      
      // If marked as paid, auto-create server for the associated order
      if (status === "paid") {
        const invoice = invoices.find(i => i.id === invoiceId);
        if (invoice?.order_id) {
          const order = orders.find(o => o.id === invoice.order_id);
          if (order && !order.server_id) {
            toast({ title: "Invoice paid, provisioning server..." });
            
            // Update order status to paid first
            await supabase.from("orders").update({ status: "paid" }).eq("id", order.id);
            
            // Trigger server creation
            try {
              const { data, error: provisionError } = await supabase.functions.invoke("pterodactyl", {
                body: {
                  action: "create",
                  orderId: order.id,
                  serverDetails: order.server_details,
                },
              });
              
              if (provisionError) {
                console.error("Server provisioning error:", provisionError);
                toast({ title: "Server provisioning started", description: "Check order status for updates" });
              } else {
                toast({ title: "Server provisioned successfully!" });
              }
              
              // Send payment confirmation email
              try {
                await supabase.functions.invoke("send-email", {
                  body: { action: "payment-confirmation", invoiceId }
                });
              } catch (emailError) {
                console.error("Email error:", emailError);
              }
            } catch (provErr: any) {
              console.error("Provisioning error:", provErr);
              toast({ title: "Server provisioning started in background" });
            }
          }
        }
      }
      
      toast({ title: `Invoice status updated to ${status}` });
      fetchData();
    } catch (error: any) {
      toast({ title: "Failed to update status", variant: "destructive" });
    }
  };

  const handleSendReply = async () => {
    if (!selectedTicket || !replyMessage.trim()) return;

    setSendingReply(true);
    try {
      const { error: replyError } = await supabase.from("ticket_replies").insert({
        ticket_id: selectedTicket.id,
        user_id: user!.id,
        message: replyMessage,
        is_staff: true,
      });

      if (replyError) throw replyError;

      const { error: ticketError } = await supabase
        .from("tickets")
        .update({ status: "answered", updated_at: new Date().toISOString() })
        .eq("id", selectedTicket.id);

      if (ticketError) throw ticketError;

      toast({ title: "Reply sent!" });
      setReplyMessage("");
      fetchData();
      setSelectedTicket(null);
    } catch (error: any) {
      toast({ title: "Failed to send reply", variant: "destructive" });
    } finally {
      setSendingReply(false);
    }
  };

  const handleCloseTicket = async (ticketId: string) => {
    try {
      const { error } = await supabase.from("tickets").update({ status: "closed" }).eq("id", ticketId);
      if (error) throw error;
      toast({ title: "Ticket closed" });
      fetchData();
    } catch (error) {
      toast({ title: "Failed to close ticket", variant: "destructive" });
    }
  };

  const handleUpdatePaymentStatus = async (paymentId: string, status: string) => {
    setUpdatingPayment(paymentId);
    try {
      const { error } = await supabase.from("payments").update({ status }).eq("id", paymentId);
      if (error) throw error;

      // If marking as completed, also update associated invoice
      if (status === "completed") {
        const payment = payments.find(p => p.id === paymentId);
        if (payment?.invoice_id) {
          await handleUpdateInvoiceStatus(payment.invoice_id, "paid");
        }
      }

      toast({ title: `Payment marked as ${status}` });
      fetchData();
    } catch (error: any) {
      toast({ title: "Failed to update payment", variant: "destructive" });
    } finally {
      setUpdatingPayment(null);
    }
  };

  if (authLoading || loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full mx-auto mb-4" />
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  if (!user || !isAdmin) return null;

  const stats = {
    totalOrders: orders.length,
    activeOrders: orders.filter((o) => o.status === "active").length,
    pendingOrders: orders.filter((o) => o.status === "pending").length,
    totalRevenue: invoices.filter((i) => i.status === "paid").reduce((sum, i) => sum + i.total, 0),
    openTickets: tickets.filter((t) => t.status === "open").length,
    pendingPayments: payments.filter((p) => p.status === "pending").length,
  };

  return (
    <div className="min-h-screen bg-background p-4 md:p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8 flex-wrap gap-4">
          <div className="flex items-center gap-4">
            <div className="p-3 rounded-xl bg-primary/20 border border-primary/30">
              <Shield className="w-8 h-8 text-primary" />
            </div>
            <div>
              <h1 className="font-display text-3xl font-bold text-gradient">Admin Dashboard</h1>
              <p className="text-muted-foreground">Manage orders, invoices, and support</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => navigate("/admin")} className="gap-2">
              <Package className="w-4 h-4" />
              Products
            </Button>
            <Button variant="outline" onClick={() => navigate("/")} className="gap-2">
              <Home className="w-4 h-4" />
            </Button>
            <Button variant="outline" onClick={signOut} className="gap-2">
              <LogOut className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-6 gap-4 mb-8">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-2">
                <Package className="w-5 h-5 text-primary" />
                <div>
                  <p className="text-2xl font-bold">{stats.totalOrders}</p>
                  <p className="text-xs text-muted-foreground">Total Orders</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-2">
                <Server className="w-5 h-5 text-green-500" />
                <div>
                  <p className="text-2xl font-bold">{stats.activeOrders}</p>
                  <p className="text-xs text-muted-foreground">Active</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-2">
                <Clock className="w-5 h-5 text-yellow-500" />
                <div>
                  <p className="text-2xl font-bold">{stats.pendingOrders}</p>
                  <p className="text-xs text-muted-foreground">Pending</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-2">
                <DollarSign className="w-5 h-5 text-green-500" />
                <div>
                  <p className="text-2xl font-bold">${stats.totalRevenue.toFixed(2)}</p>
                  <p className="text-xs text-muted-foreground">Revenue</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-2">
                <CreditCard className="w-5 h-5 text-orange-500" />
                <div>
                  <p className="text-2xl font-bold">{stats.pendingPayments}</p>
                  <p className="text-xs text-muted-foreground">Pending Payments</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-2">
                <MessageSquare className="w-5 h-5 text-blue-500" />
                <div>
                  <p className="text-2xl font-bold">{stats.openTickets}</p>
                  <p className="text-xs text-muted-foreground">Open Tickets</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Tabs */}
        <Tabs defaultValue="orders">
          <TabsList className="mb-6">
            <TabsTrigger value="orders" className="gap-2">
              <Package className="w-4 h-4" />
              Orders ({orders.length})
            </TabsTrigger>
            <TabsTrigger value="invoices" className="gap-2">
              <FileText className="w-4 h-4" />
              Invoices ({invoices.length})
            </TabsTrigger>
            <TabsTrigger value="payments" className="gap-2">
              <CreditCard className="w-4 h-4" />
              Payments ({payments.length})
            </TabsTrigger>
            <TabsTrigger value="tickets" className="gap-2">
              <MessageSquare className="w-4 h-4" />
              Tickets ({tickets.length})
            </TabsTrigger>
          </TabsList>

          {/* Orders Tab */}
          <TabsContent value="orders">
            <Card>
              <CardHeader>
                <div className="flex justify-between items-center">
                  <div className="flex items-center gap-4">
                    <CardTitle>All Orders</CardTitle>
                    {selectedOrders.size > 0 && (
                      <Badge variant="secondary">{selectedOrders.size} selected</Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {selectedOrders.size > 0 && (
                      <>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="outline" size="sm" disabled={bulkActionLoading}>
                              {bulkActionLoading ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Pause className="w-4 h-4 mr-1" />}
                              Suspend ({selectedOrders.size})
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Bulk Suspend Services</AlertDialogTitle>
                              <AlertDialogDescription>
                                Are you sure you want to suspend {selectedOrders.size} service(s)? This will:
                                <ul className="list-disc list-inside mt-2 space-y-1">
                                  <li>Suspend servers in Pterodactyl panel</li>
                                  <li>Send suspension emails to customers</li>
                                  <li>Update order status to suspended</li>
                                </ul>
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction onClick={handleBulkSuspend}>
                                Suspend All
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="destructive" size="sm" disabled={bulkActionLoading}>
                              {bulkActionLoading ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Trash2 className="w-4 h-4 mr-1" />}
                              Delete ({selectedOrders.size})
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Bulk Delete Services</AlertDialogTitle>
                              <AlertDialogDescription>
                                Are you sure you want to delete {selectedOrders.size} service(s)? This will:
                                <ul className="list-disc list-inside mt-2 space-y-1">
                                  <li>Terminate servers in Pterodactyl panel</li>
                                  <li>Send termination emails to customers</li>
                                  <li>Delete all related invoices</li>
                                  <li>Permanently remove the orders</li>
                                </ul>
                                <p className="mt-2 font-semibold text-destructive">This action cannot be undone.</p>
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction 
                                onClick={handleBulkDelete}
                                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                              >
                                Delete All
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </>
                    )}
                    <Button variant="outline" size="sm" onClick={fetchData}>
                      <RefreshCw className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10">
                        <Checkbox 
                          checked={orders.length > 0 && selectedOrders.size === orders.length}
                          onCheckedChange={toggleSelectAll}
                        />
                      </TableHead>
                      <TableHead>ID</TableHead>
                      <TableHead>Customer</TableHead>
                      <TableHead>Server</TableHead>
                      <TableHead>Price</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {orders.map((order) => (
                      <TableRow key={order.id} className={selectedOrders.has(order.id) ? "bg-muted/50" : ""}>
                        <TableCell>
                          <Checkbox 
                            checked={selectedOrders.has(order.id)}
                            onCheckedChange={() => toggleOrderSelection(order.id)}
                          />
                        </TableCell>
                        <TableCell className="font-mono text-xs">{order.id.slice(0, 8)}</TableCell>
                        <TableCell>{order.user_email || "N/A"}</TableCell>
                        <TableCell>{order.server_details?.name || "N/A"}</TableCell>
                        <TableCell>${order.price.toFixed(2)}</TableCell>
                        <TableCell>
                          <Badge className={statusColors[order.status] || ""}>{order.status}</Badge>
                        </TableCell>
                        <TableCell>{format(new Date(order.created_at), "PP")}</TableCell>
                        <TableCell>
                          <div className="flex gap-2">
                            <Select 
                              onValueChange={(v) => handleUpdateOrderStatus(order.id, v)}
                              disabled={suspendingOrder === order.id}
                            >
                              <SelectTrigger className="w-28 h-8">
                                {suspendingOrder === order.id ? (
                                  <Loader2 className="w-4 h-4 animate-spin" />
                                ) : (
                                  <SelectValue placeholder="Status" />
                                )}
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="pending">Pending</SelectItem>
                                <SelectItem value="paid">Paid</SelectItem>
                                <SelectItem value="provisioning">Provisioning</SelectItem>
                                <SelectItem value="active">Active</SelectItem>
                                <SelectItem value="failed">Failed</SelectItem>
                                <SelectItem value="suspended">Suspended</SelectItem>
                                <SelectItem value="cancelled">Cancelled</SelectItem>
                              </SelectContent>
                            </Select>
                            {!order.server_id && (order.status === "paid" || order.status === "active" || order.status === "failed") && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleProvisionServer(order)}
                                disabled={provisioningOrder === order.id}
                              >
                                {provisioningOrder === order.id ? (
                                  <Loader2 className="w-4 h-4 animate-spin" />
                                ) : (
                                  <Server className="w-4 h-4" />
                                )}
                              </Button>
                            )}
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button
                                  size="sm"
                                  variant="destructive"
                                  disabled={deletingOrder === order.id}
                                >
                                  {deletingOrder === order.id ? (
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                  ) : (
                                    <Trash2 className="w-4 h-4" />
                                  )}
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>Delete Service</AlertDialogTitle>
                                  <AlertDialogDescription>
                                    Are you sure you want to delete this service? This will:
                                    <ul className="list-disc list-inside mt-2 space-y-1">
                                      {order.server_id && <li>Terminate the server in Pterodactyl panel</li>}
                                      <li>Delete all related invoices</li>
                                      <li>Permanently remove the order</li>
                                    </ul>
                                    <p className="mt-2 font-semibold text-destructive">This action cannot be undone.</p>
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                                  <AlertDialogAction
                                    onClick={() => handleDeleteOrder(order)}
                                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                  >
                                    Delete Service
                                  </AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Invoices Tab */}
          <TabsContent value="invoices">
            <Card>
              <CardHeader>
                <CardTitle>All Invoices</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Invoice #</TableHead>
                      <TableHead>Customer</TableHead>
                      <TableHead>Amount</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Due Date</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {invoices.map((invoice) => (
                      <TableRow key={invoice.id}>
                        <TableCell className="font-mono">{invoice.invoice_number}</TableCell>
                        <TableCell>{invoice.user_email || "N/A"}</TableCell>
                        <TableCell>${invoice.total.toFixed(2)}</TableCell>
                        <TableCell>
                          <Badge className={statusColors[invoice.status] || ""}>{invoice.status}</Badge>
                        </TableCell>
                        <TableCell>{format(new Date(invoice.due_date), "PP")}</TableCell>
                        <TableCell>
                          <Select onValueChange={(v) => handleUpdateInvoiceStatus(invoice.id, v)}>
                            <SelectTrigger className="w-28 h-8">
                              <SelectValue placeholder="Status" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="unpaid">Unpaid</SelectItem>
                              <SelectItem value="paid">Paid</SelectItem>
                              <SelectItem value="cancelled">Cancelled</SelectItem>
                            </SelectContent>
                          </Select>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Payments Tab */}
          <TabsContent value="payments">
            <Card>
              <CardHeader>
                <div className="flex justify-between items-center">
                  <CardTitle>All Payments</CardTitle>
                  <Button variant="outline" size="sm" onClick={fetchData}>
                    <RefreshCw className="w-4 h-4" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Transaction ID</TableHead>
                      <TableHead>Customer</TableHead>
                      <TableHead>Invoice</TableHead>
                      <TableHead>Amount</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {payments.map((payment) => (
                      <TableRow key={payment.id}>
                        <TableCell className="font-mono text-xs">
                          {payment.transaction_id || payment.id.slice(0, 8)}
                        </TableCell>
                        <TableCell>{payment.user_email}</TableCell>
                        <TableCell className="font-mono">
                          {payment.invoice_number || "N/A"}
                        </TableCell>
                        <TableCell>
                          {payment.currency} ${payment.amount.toFixed(2)}
                        </TableCell>
                        <TableCell>
                          <Badge className={statusColors[payment.status] || "bg-gray-500/20 text-gray-500"}>
                            {payment.status}
                          </Badge>
                        </TableCell>
                        <TableCell>{format(new Date(payment.created_at), "PP p")}</TableCell>
                        <TableCell>
                          <div className="flex gap-2">
                            <Select 
                              onValueChange={(v) => handleUpdatePaymentStatus(payment.id, v)}
                              disabled={updatingPayment === payment.id}
                            >
                              <SelectTrigger className="w-32 h-8">
                                <SelectValue placeholder="Update" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="pending">Pending</SelectItem>
                                <SelectItem value="completed">
                                  <span className="flex items-center gap-1">
                                    <CheckCircle className="w-3 h-3 text-green-500" />
                                    Completed
                                  </span>
                                </SelectItem>
                                <SelectItem value="failed">
                                  <span className="flex items-center gap-1">
                                    <XCircle className="w-3 h-3 text-red-500" />
                                    Failed
                                  </span>
                                </SelectItem>
                              </SelectContent>
                            </Select>
                            {updatingPayment === payment.id && (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                    {payments.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                          No payments found
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Tickets Tab */}
          <TabsContent value="tickets">
            <Card>
              <CardHeader>
                <CardTitle>Support Tickets</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Subject</TableHead>
                      <TableHead>Customer</TableHead>
                      <TableHead>Department</TableHead>
                      <TableHead>Priority</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Updated</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {tickets.map((ticket) => (
                      <TableRow key={ticket.id}>
                        <TableCell className="max-w-[200px] truncate">{ticket.subject}</TableCell>
                        <TableCell>{ticket.user_email || "N/A"}</TableCell>
                        <TableCell className="capitalize">{ticket.department}</TableCell>
                        <TableCell className="capitalize">{ticket.priority}</TableCell>
                        <TableCell>
                          <Badge className={statusColors[ticket.status] || ""}>{ticket.status}</Badge>
                        </TableCell>
                        <TableCell>{format(new Date(ticket.updated_at), "Pp")}</TableCell>
                        <TableCell>
                          <div className="flex gap-2">
                            <Dialog>
                              <DialogTrigger asChild>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => setSelectedTicket(ticket)}
                                >
                                  <Eye className="w-4 h-4" />
                                </Button>
                              </DialogTrigger>
                              <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
                                <DialogHeader>
                                  <DialogTitle>{ticket.subject}</DialogTitle>
                                </DialogHeader>
                                <div className="space-y-4">
                                  <div className="text-sm text-muted-foreground">
                                    From: {ticket.user_email} | {ticket.department} | {ticket.priority}
                                  </div>
                                  <div className="space-y-3 max-h-[300px] overflow-y-auto">
                                    {ticket.replies?.map((reply) => (
                                      <div
                                        key={reply.id}
                                        className={`p-3 rounded-lg ${
                                          reply.is_staff ? "bg-primary/10 ml-8" : "bg-muted mr-8"
                                        }`}
                                      >
                                        <div className="text-xs text-muted-foreground mb-1">
                                          {reply.is_staff ? "Staff" : "Customer"} •{" "}
                                          {format(new Date(reply.created_at), "Pp")}
                                        </div>
                                        <p className="text-sm whitespace-pre-wrap">{reply.message}</p>
                                      </div>
                                    ))}
                                  </div>
                                  {ticket.status !== "closed" && (
                                    <div className="space-y-2">
                                      <Textarea
                                        placeholder="Type your reply..."
                                        value={replyMessage}
                                        onChange={(e) => setReplyMessage(e.target.value)}
                                      />
                                      <div className="flex gap-2">
                                        <Button onClick={handleSendReply} disabled={sendingReply} className="gap-2">
                                          {sendingReply ? (
                                            <Loader2 className="w-4 h-4 animate-spin" />
                                          ) : (
                                            <Send className="w-4 h-4" />
                                          )}
                                          Send Reply
                                        </Button>
                                        <Button
                                          variant="outline"
                                          onClick={() => handleCloseTicket(ticket.id)}
                                        >
                                          Close Ticket
                                        </Button>
                                      </div>
                                    </div>
                                  )}
                                </div>
                              </DialogContent>
                            </Dialog>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
};

export default AdminDashboard;
